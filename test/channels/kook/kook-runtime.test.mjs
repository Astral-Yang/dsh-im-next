import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { KookRuntime } from '../../../src/channels/kook/kook-runtime.mjs';
import { KookStateStore } from '../../../src/channels/kook/state-store.mjs';

function fakeWebSocket() {
  const listeners = new Map();
  return {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return this;
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    connect() {},
    async waitUntilConnected() {},
    disconnect() {
      this.emit('stateChange', 'IDLE', 'CONNECTED');
    },
  };
}

test('KookRuntime starts with a KOOK identity and sends proactive text to channel and user routes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kook-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = await new KookStateStore(join(root, 'state.json')).load();
  const ws = fakeWebSocket();
  const calls = [];
  const api = {
    async getSelfUser() { return { id: 'kook-bot-1', username: 'Shorekeeper' }; },
    async createMessage(request) {
      calls.push({ kind: 'channel', request });
      return { msg_id: `msg-${calls.length}` };
    },
    async createDirectMessage(request) {
      calls.push({ kind: 'direct', request });
      return { msg_id: `msg-${calls.length}` };
    },
    async uploadAsset() { return { url: 'https://img.kookapp.cn/assets/file' }; },
    async updateMessage() { return {}; },
  };
  const runtime = new KookRuntime({
    config: { botId: 'kook_bot', platformId: 'kook-bot-1' },
    token: 'kook-token-123456',
    harness: { ensureRunning: async () => true, currentBusyMessageMode: () => 'queue' },
    state,
    logger: { error() {}, warn() {}, info() {}, debug() {} },
    createApi: () => api,
    createWsClient: () => ws,
  });

  await runtime.start();
  assert.equal(runtime.status.ready, true);
  assert.equal(runtime.status.connectionState, 'connected');
  assert.equal(runtime.status.harnessReachable, true);

  await runtime.sendProactiveText({ kind: 'channel', route: { channelId: 'channel-1' } }, 'hello');
  assert.equal(calls[0].kind, 'channel');
  assert.equal(calls[0].request.targetId, 'channel-1');
  assert.equal(calls[0].request.content, 'hello');
  assert.equal(calls[0].request.type, 1);

  await runtime.sendProactiveText({ kind: 'user', route: { userId: 'user-1' } }, 'hi');
  assert.equal(calls[1].kind, 'direct');
  assert.equal(calls[1].request.targetId, 'user-1');
  assert.equal(calls[1].request.content, 'hi');

  await runtime.stop();
  assert.equal(runtime.status.ready, false);
  assert.equal(runtime.status.connectionState, 'idle');
});
