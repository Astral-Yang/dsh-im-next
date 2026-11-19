import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_REACTIONS,
  kookReactionCode,
  kookReactionEmoji,
  kookReactionValue,
  normalizeReactionConfig,
  REACTION_MAX_LENGTH,
  reactionFormatOf,
  resolveChannelReactions,
  SET_REACTIONS_ENDPOINT,
} from '../../../src/channels/shared/reaction-config.mjs';
import {
  deriveKookBotIdentity,
  KookConfigStore,
} from '../../../src/channels/kook/config-store.mjs';
import { DiscordController } from '../../../src/channels/discord/discord-controller.mjs';
import { DiscordConfigStore } from '../../../src/channels/discord/config-store.mjs';
import { TextHarnessBridge } from '../../../src/channels/shared/text-harness-bridge.mjs';
import { validReactionsPayload } from '../../../plugin-src/host/channels/shared/reactions-rpc.mjs';

const quietLogger = { warn() {}, error() {}, debug() {} };

// --- A: the catalog and its normalizer ------------------------------------

test('A1: every reacting channel ships a three-state default', () => {
  for (const [key, set] of Object.entries(DEFAULT_REACTIONS)) {
    assert.deepEqual(Object.keys(set), ['processing', 'success', 'error'], key);
    for (const value of Object.values(set)) {
      assert.equal(typeof value, 'string', `${key} carries a string in every state`);
    }
    assert.ok(set.processing.length > 0, `${key} announces work`);
  }
  assert.equal(DEFAULT_REACTIONS.kook.processing, '[#128064;]');
  assert.equal(DEFAULT_REACTIONS.slack.processing, 'eyes');
  // Telegram deliberately leaves nothing behind on success.
  assert.equal(DEFAULT_REACTIONS.telegram.success, '');
});

test('A2: the format hint follows the channel notation', () => {
  assert.equal(reactionFormatOf('slack'), 'slack-name');
  assert.equal(reactionFormatOf('kook'), 'kook-code');
  assert.equal(reactionFormatOf('telegram'), 'unicode');
  assert.equal(reactionFormatOf('unknown-channel'), 'unicode');
});

test('A3: normalizeReactionConfig trims, allows empty, and fills every state', () => {
  assert.equal(normalizeReactionConfig(undefined), null);
  assert.equal(normalizeReactionConfig(null), null);
  assert.deepEqual(normalizeReactionConfig({ processing: ' 👀 ' }), { processing: '👀' });
  assert.deepEqual(normalizeReactionConfig({ success: '✅' }), { success: '✅' });
  // An explicit empty string is a value, not an omission: it switches a state off.
  assert.deepEqual(normalizeReactionConfig({ success: '' }), { success: '' });
  assert.ok(Object.isFrozen(normalizeReactionConfig({ processing: '👀' })));
});

test('A4: normalizeReactionConfig rejects what the platform call cannot carry', () => {
  for (const bad of [
    '👀',
    { processing: 1 },
    { processing: '👀\n✅' },
    { processing: '\u0007' },
    { processing: 'x'.repeat(REACTION_MAX_LENGTH + 1) },
    { reaction: '👀' },
  ]) {
    assert.throws(() => normalizeReactionConfig(bad), TypeError, JSON.stringify(bad));
  }
});

test('A5: stored values merge over the channel default, per state', () => {
  assert.deepEqual(
    resolveChannelReactions('kook', { error: '[#128545;]' }),
    { processing: '[#128064;]', success: '[#9989;]', error: '[#128545;]' },
  );
  // The whole set can be switched off.
  assert.deepEqual(
    resolveChannelReactions('telegram', { processing: '', success: '', error: '' }),
    { processing: '', success: '', error: '' },
  );
  // A channel with neither a catalog default nor a stored set has no reaction.
  assert.equal(resolveChannelReactions('email', undefined), null);
  assert.deepEqual(
    resolveChannelReactions('email', { processing: '👀' }),
    { processing: '👀', success: '', error: '' },
  );
});

// --- B: the stored config -------------------------------------------------

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-reactions-'));
  const storePath = join(directory, 'kook.json');
  try {
    return await run(new KookConfigStore(storePath), storePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function kookBot(overrides = {}) {
  const identity = deriveKookBotIdentity('platform-kook-1');
  return {
    ...identity,
    platformId: 'platform-kook-1',
    name: 'Harness KOOK',
    ...overrides,
  };
}

test('B1: reactions persist and survive a reload', async () => {
  await withStore(async (store, storePath) => {
    await store.save(kookBot({ reactions: { processing: '[#128558;]', success: '', error: '[#10060;]' } }));
    assert.deepEqual(store.list()[0].reactions, {
      processing: '[#128558;]', success: '', error: '[#10060;]',
    });
    // A fresh store over the same file sees the same set.
    const reloaded = await new KookConfigStore(storePath).load();
    assert.deepEqual(reloaded.list()[0].reactions, {
      processing: '[#128558;]', success: '', error: '[#10060;]',
    });
  });
});

test('B2: a bot that never chose reactions stores none, so the catalog applies', async () => {
  await withStore(async (store) => {
    await store.save(kookBot());
    assert.equal(Object.hasOwn(store.list()[0], 'reactions'), false);
  });
});

test('B3: an unusable stored value is refused instead of silently rewritten', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.save(kookBot({ reactions: { processing: '👀\nbroken' } })),
      /incomplete KOOK bot data|Refusing/,
    );
    await assert.rejects(
      store.save(kookBot({ reactions: '👀' })),
      /incomplete KOOK bot data|Refusing/,
    );
  });
});

// --- C: the RPC payload ---------------------------------------------------

test('C1: the endpoint name is shared by host and panel', () => {
  assert.equal(SET_REACTIONS_ENDPOINT, 'bot.reactions.set');
});

test('C2: only an exact, well-formed payload is accepted', () => {
  const botId = 'kook_0123456789abcdef01234567';
  assert.equal(validReactionsPayload({
    botId,
    reactions: { processing: '👀', success: '✅', error: '❌' },
  }), true);
  assert.equal(validReactionsPayload({
    botId,
    reactions: { processing: '👀', success: '✅', error: '❌', extra: 'x' },
  }), false);
  assert.equal(validReactionsPayload({ botId, reactions: null }), false);
  assert.equal(validReactionsPayload({ botId, reactions: { processing: 1 } }), false);
  assert.equal(validReactionsPayload({
    botId: 'not a bot id',
    reactions: { processing: '👀' },
  }), false);
  assert.equal(validReactionsPayload({
    botId,
    reactions: { processing: '👀' },
    extra: true,
  }), false);
});

// --- D: controller ------------------------------------------------------

// 明显的假值：不要写成 Discord Token 的形状，否则 GitHub 推送保护会拦截。
const DISCORD_TOKEN = 'test-discord-bot-token-not-real-0123456789';

test('D1: the bot snapshot carries the effective set, defaults included', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-reactions-rpc-'));
  try {
    const configStore = new DiscordConfigStore(join(directory, 'discord.json'));
    const runtimes = [];
    const controller = new DiscordController({
      credentials: {
        async resolve() { return { value: DISCORD_TOKEN, source: 'test' }; },
        async set() {},
        async unset() {},
      },
      configStore,
      inspectToken: async () => ({ platformId: '123456789012345678', name: 'Harness Discord' }),
      inspectOwner: async () => null,
      createRuntime: async ({ botId, config }) => {
        runtimes.push({ botId, config: structuredClone(config) });
        return {
          status: { ready: true, connectionState: 'connected', harnessReachable: true },
          async start() {},
          async stop() {},
        };
      },
      logger: quietLogger,
    });
    const bound = await controller.bindCredentials({ token: DISCORD_TOKEN });
    const botId = bound.bots[0].botId;
    assert.deepEqual(bound.bots[0].reactions, DEFAULT_REACTIONS.discord);

    const updated = await controller.setReactions(botId, {
      processing: '⏳', success: '🎉', error: '💥',
    });
    assert.deepEqual(updated.bots[0].reactions, {
      processing: '⏳', success: '🎉', error: '💥',
    });
    assert.deepEqual(configStore.get(botId).reactions, {
      processing: '⏳', success: '🎉', error: '💥',
    });
    assert.deepEqual(runtimes.at(-1).config.reactions, {
      processing: '⏳', success: '🎉', error: '💥',
    }, 'the runtime restarts with the new marks');

    await assert.rejects(controller.setReactions(botId, { processing: 'a\u0001b' }), TypeError);
    await assert.rejects(controller.setReactions(botId, null), TypeError);
    await controller.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// --- E: the bridge honors the stored set ----------------------------------

function bridgeFixture({ key, reactions }) {
  const sessions = new Map();
  const seen = new Set();
  const calls = [];
  const bridge = new TextHarnessBridge({
    descriptor: { key, label: key, reactions: { processing: 'default', success: 'default', error: 'default' } },
    ...(reactions === undefined ? {} : { reactions }),
    state: {
      sessionFor: (sessionKey) => sessions.get(sessionKey) ?? null,
      async setSession(sessionKey, value) { sessions.set(sessionKey, value); },
      async clearSession(sessionKey) { sessions.delete(sessionKey); },
      hasSeen: (id) => seen.has(id),
      async markSeen(id) { seen.add(id); },
      async unmarkSeen(id) { return seen.delete(id); },
    },
    bot: {
      async addReaction(target, emoji) { calls.push(['add', emoji]); return `key:${emoji}`; },
      async removeReaction(target, key) { calls.push(['remove', key]); },
      async sendText() {},
    },
    harness: {
      async sessionExists() { return false; },
      async createSession() { return `session-${key}`; },
      async ask() { return '完成'; },
    },
    logger: quietLogger,
  });
  return { bridge, calls };
}

function directMessage(messageId) {
  return {
    messageId,
    senderId: 'actor-a',
    senderIsBot: false,
    kind: 'direct',
    conversationId: 'chat-a',
    content: '执行',
    addressed: true,
    replyTarget: { id: `target-${messageId}` },
    reactionTarget: { id: `reaction-${messageId}` },
  };
}

async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never settled');
}

test('E1: the stored set replaces the channel default', async () => {
  const { bridge, calls } = bridgeFixture({
    key: 'kook',
    reactions: { processing: '[#128558;]', success: '', error: '' },
  });
  await bridge.accept(directMessage('configured'));
  await eventually(() => calls.length === 2);
  assert.deepEqual(calls, [['add', '[#128558;]'], ['remove', 'key:[#128558;]']]);
});

test('E2: no stored set falls back to the catalog', async () => {
  const { bridge, calls } = bridgeFixture({ key: 'kook' });
  await bridge.accept(directMessage('default'));
  await eventually(() => calls.length === 3);
  assert.deepEqual(calls, [
    ['add', '[#128064;]'],
    ['remove', 'key:[#128064;]'],
    ['add', '[#9989;]'],
  ]);
});

test('E3: a channel with no catalog entry keeps its descriptor set', async () => {
  const { bridge, calls } = bridgeFixture({ key: 'legacy' });
  await bridge.accept(directMessage('legacy'));
  await eventually(() => calls.length === 3);
  assert.deepEqual(calls[0], ['add', 'default']);
});
// --- F: the KOOK code <-> emoji mapping -----------------------------------

test('F1: a KOOK code is the decimal code point, so every default round-trips', () => {
  assert.equal(kookReactionCode('👀'), '[#128064;]');
  assert.equal(kookReactionCode('✅'), '[#9989;]');
  assert.equal(kookReactionCode('❌'), '[#10060;]');

  const { processing, success, error } = DEFAULT_REACTIONS.kook;
  for (const code of [processing, success, error]) {
    assert.equal(kookReactionCode(kookReactionEmoji(code)), code);
    assert.match(code, /^\[#\d+;\]$/u);
  }
});

test('F3: input the panel cannot convert is rejected, codes pass through', () => {
  assert.equal(kookReactionValue(''), '');
  assert.equal(kookReactionValue('  '), '');
  assert.equal(kookReactionValue(' 👀 '), '[#128064;]');
  assert.equal(kookReactionValue('[#9999;]'), '[#9999;]');
  assert.equal(kookReactionValue('eyes'), null);
  assert.equal(kookReactionValue('❤️'), null, 'multi-codepoint emoji needs a manual code');
  assert.equal(kookReactionEmoji('[#2000000;]'), null, 'beyond the Unicode range');
  assert.equal(kookReactionEmoji('eyes'), null);
});