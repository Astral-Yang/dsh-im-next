import { KWSStates, WsClient } from '@kookapp/js-sdk';
import { captureContextEnhancement } from '../shared/context-enhancement.mjs';
import { captureGroupHistory, groupHistoryEntry } from '../shared/group-history.mjs';
import { createConnectionDiagnostics, extractConnectionEvidence } from '../shared/connection-error.mjs';
import { KookApi } from './kook-api.mjs';
import { createKookBridgeStatus, KookHarnessBridge } from './kook-bridge.mjs';
import { KookBotClient } from './kook-bot-client.mjs';
import { normalizeKookEvent } from './kook-message.mjs';

export function createKookRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    error: null,
    ...createKookBridgeStatus(),
  };
}

function proactiveTarget(target) {
  const route = target?.route;
  if (target?.kind === 'user' && typeof route?.userId === 'string' && route.userId.trim()) {
    return { userId: route.userId.trim() };
  }
  if (target?.kind === 'channel' && typeof route?.channelId === 'string' && route.channelId.trim()) {
    return { channelId: route.channelId.trim() };
  }
  const error = new TypeError('Invalid KOOK proactive delivery target');
  error.code = 'invalid-target';
  throw error;
}

export class KookRuntime {
  #config;
  #token;
  #harness;
  #state;
  #contextEnhancement;
  #groupHistory;
  #accessPolicy;
  #logger;
  #diagnostics;
  #replyTimeoutMs;
  #connectTimeoutMs;
  #createApi;
  #createWsClient;
  #status = createKookRuntimeStatus();
  #api = null;
  #bridge = null;
  #ws = null;
  #abortController = null;
  #stopped = true;
  #starting = null;

  constructor({
    config,
    token,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    connectTimeoutMs = 20_000,
    createApi = (options) => new KookApi(options),
    createWsClient = (options) => new WsClient(options),
  }) {
    if (!config || !token || !harness || !state) {
      throw new TypeError('KookRuntime requires config, token, Harness, and state');
    }
    if (typeof createApi !== 'function' || typeof createWsClient !== 'function') {
      throw new TypeError('KookRuntime requires API and WebSocket factories');
    }
    this.#config = config;
    this.#token = token;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger;
    this.#diagnostics = createConnectionDiagnostics({ channel: 'kook', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#createApi = createApi;
    this.#createWsClient = createWsClient;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#bridge) {
      const error = new Error('KOOK bot is not connected');
      error.code = 'test-target-unavailable';
      throw error;
    }
    return this.#bridge.sendConnectionTest(text);
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const route = target?.route;
    const actor = target?.kind === 'user' && typeof route?.userId === 'string'
      ? route.userId.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key,
      actor,
      validate: options.validate,
      send: (text) => this.sendProactiveText(target, text, options),
    }, options);
  }

  async sendProactiveText(target, text, options = {}) {
    if (!this.#status.ready || !this.#bridge) {
      const error = new Error('KOOK bot is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    return this.#bridge.sendProactiveText(proactiveTarget(target), text, options);
  }

  async start() {
    if (this.#status.ready && this.#ws) return this.status;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    await this.stop();
    this.#stopped = false;
    this.#status.startedAt = new Date().toISOString();
    this.#status.connectionState = 'connecting';
    this.#status.lastError = null;
    this.#status.error = null;
    this.#diagnostics.clear();
    await this.#harness.ensureRunning();
    this.#status.harnessReachable = true;
    const controller = new AbortController();
    this.#abortController = controller;
    const api = this.#createApi({
      token: this.#token,
      ...(this.#config.baseUrl ? { baseUrl: this.#config.baseUrl } : {}),
    });
    this.#api = api;
    try {
      const me = await api.getSelfUser({ signal: controller.signal });
      if (String(me?.id ?? '') !== String(this.#config.platformId)) {
        throw Object.assign(new Error('KOOK token identity does not match the saved bot'), {
          code: 'kook-identity-mismatch',
        });
      }
      const bot = new KookBotClient({ api, signal: controller.signal, logger: this.#logger });
      this.#bridge = new KookHarnessBridge({
        bot,
        harness: this.#harness,
        state: this.#state,
        contextEnhancement: this.#contextEnhancement,
        accessPolicy: this.#accessPolicy,
        status: this.#status,
        logger: this.#logger,
        replyTimeoutMs: this.#replyTimeoutMs,
        signal: controller.signal,
      });
      const ws = this.#createWsClient({
        restClient: api,
        compression: true,
        autoReconnect: true,
        logger: this.#logger,
      });
      this.#ws = ws;
      this.#attachWebSocket(ws, controller.signal);
      ws.connect();
      await ws.waitUntilConnected(this.#connectTimeoutMs);
      this.#markConnected();
      return this.status;
    } catch (error) {
      this.#status.ready = false;
      this.#status.connectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, {
        operation: 'connection.restore',
        reuse: true,
        botId: this.#config?.botId,
        automatic: true,
      }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.stop();
      throw error;
    }
  }

  #attachWebSocket(ws, signal) {
    ws.on('textChannelEvent', (event) => {
      if (this.#stopped || signal.aborted) return;
      void this.#acceptEvent(event).catch((error) => {
        if (this.#stopped || signal.aborted) return;
        this.#logger.error?.(
          `[dsh-im:kook] bot ${this.#config.botId} message handling failed:`,
          extractConnectionEvidence(error).details,
        );
      });
    });
    ws.on('stateChange', (newState) => {
      if (this.#stopped) return;
      if (newState === KWSStates.Connected) {
        this.#markConnected();
      } else if (newState === KWSStates.Failed) {
        this.#status.ready = false;
        this.#status.connectionState = 'failed';
        this.#status.lastError = this.#status.error?.message ?? 'KOOK Gateway failed';
      } else if (newState !== KWSStates.Idle) {
        this.#status.ready = false;
        this.#status.connectionState = 'connecting';
      }
    });
    ws.on('error', (error) => {
      if (this.#stopped) return;
      this.#status.error = this.#diagnostics.report(error, {
        operation: 'connection.monitor',
        botId: this.#config?.botId,
        automatic: true,
      }).publicError;
      this.#status.lastError = this.#status.error.message;
    });
    ws.on('reconnecting', (reason) => {
      if (this.#stopped) return;
      this.#status.ready = false;
      this.#status.connectionState = 'connecting';
      this.#status.lastError = String(reason ?? 'KOOK Gateway reconnecting');
    });
    ws.on('reset', () => {
      if (this.#stopped) return;
      this.#status.ready = false;
      this.#status.connectionState = 'connecting';
    });
  }

  #markConnected() {
    const now = Date.now();
    this.#status.ready = true;
    this.#status.connectionState = 'connected';
    this.#status.lastCheckedAt = now;
    this.#status.lastConnectedAt = now;
    this.#status.lastError = null;
    this.#status.error = null;
    this.#diagnostics.clear();
  }

  async #acceptEvent(event) {
    const normalized = normalizeKookEvent(event, this.#config.platformId);
    if (!normalized || normalized.senderIsBot) return;
    if (normalized.kind === 'group' && this.#groupHistory) {
      await captureGroupHistory(this.#groupHistory, normalized, groupHistoryEntry('kook', event, normalized, {
        scope: String(event?.extra?.guild_id ?? ''),
        groupName: event?.extra?.channel_name,
      }), { logger: this.#logger });
    }
    await this.#bridge.accept(normalized, {
      contextSnapshot: captureContextEnhancement(this.#contextEnhancement, normalized.kind),
      busyMessageMode: this.#harness.currentBusyMessageMode?.() ?? 'queue',
    });
  }

  async stop() {
    this.#stopped = true;
    this.#abortController?.abort();
    this.#abortController = null;
    const ws = this.#ws;
    const bridge = this.#bridge;
    this.#ws = null;
    this.#bridge = null;
    this.#api = null;
    try {
      ws?.disconnect?.();
    } catch (error) {
      this.#logger.warn?.('[dsh-im:kook] failed to disconnect Gateway:', error?.message ?? error);
    }
    await Promise.race([
      bridge?.waitForIdle?.() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.#status.ready = false;
    this.#status.connectionState = 'idle';
    return this.status;
  }
}
