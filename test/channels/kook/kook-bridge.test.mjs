import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { KookHarnessBridge } from '../../../src/channels/kook/kook-bridge.mjs';
import { KookStateStore } from '../../../src/channels/kook/state-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kook-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = await new KookStateStore(join(root, 'state.json')).load();
  const sent = [];
  const bridge = new KookHarnessBridge({
    bot: {
      sendText: async (target, text) => {
        sent.push({ target, text });
        return { providerMessageIds: ['msg-1'] };
      },
    },
    harness: {
      ensureRunning: async () => true,
      currentBusyMessageMode: () => 'queue',
    },
    state,
    logger: { warn() {}, error() {}, info() {} },
  });
  return { bridge, sent };
}

function message(id, overrides = {}) {
  return {
    messageId: id,
    senderId: 'user-1',
    kind: 'direct',
    conversationId: 'user-1',
    content: '/sid',
    plainText: true,
    addressed: true,
    replyTarget: { userId: 'user-1' },
    reactionTarget: { messageId: id, channelType: 'PERSON' },
    ...overrides,
  };
}

test('KOOK /sid returns the sender user id without entering a model turn', async (t) => {
  const { bridge, sent } = await fixture(t);
  await bridge.accept(message('sid-direct'));
  assert.deepEqual(sent, [{
    target: { userId: 'user-1' },
    text: '当前用户 ID：user-1',
  }]);
  assert.equal(bridge.status.messagesReceived, 1);
});

test('KOOK /sid also returns the channel id in a group', async (t) => {
  const { bridge, sent } = await fixture(t);
  await bridge.accept(message('sid-group', {
    kind: 'group',
    conversationId: 'channel-1',
    replyTarget: { channelId: 'channel-1' },
    reactionTarget: { messageId: 'sid-group', channelType: 'GROUP' },
  }));
  assert.deepEqual(sent, [{
    target: { channelId: 'channel-1' },
    text: '当前用户 ID：user-1\n当前频道 ID：channel-1',
  }]);
});

test('KOOK /sid accepts trailing arguments without entering a model turn', async (t) => {
  const { bridge, sent } = await fixture(t);
  await bridge.accept(message('sid-extra', { content: '/sid extra' }));
  assert.deepEqual(sent, [{
    target: { userId: 'user-1' },
    text: '当前用户 ID：user-1',
  }]);
});
