import assert from 'node:assert/strict';
import test from 'node:test';

import { KookBotClient } from '../../../src/channels/kook/kook-bot-client.mjs';

function fakeApi() {
  const calls = [];
  return {
    calls,
    async createMessage(request) {
      calls.push({ kind: 'channel', request });
      return { msg_id: `msg-${calls.length}` };
    },
    async createDirectMessage(request) {
      calls.push({ kind: 'direct', request });
      return { msg_id: `msg-${calls.length}` };
    },
    async uploadAsset({ file }) {
      calls.push({ kind: 'upload', file });
      return { url: `https://img.kookapp.cn/assets/${file.fileName}` };
    },
    async updateMessage(request) {
      calls.push({ kind: 'update', request });
      return {};
    },
    async addReaction(request) {
      calls.push({ kind: 'reaction-channel', request });
      return [];
    },
    async deleteReaction(request) {
      calls.push({ kind: 'unreaction-channel', request });
      return {};
    },
    async addDirectMessageReaction(request) {
      calls.push({ kind: 'reaction-direct', request });
      return [];
    },
    async deleteDirectMessageReaction(request) {
      calls.push({ kind: 'unreaction-direct', request });
      return {};
    },
  };
}

test('KOOK bot client sends text and markdown with channel/direct routing', async () => {
  const api = fakeApi();
  const bot = new KookBotClient({ api, signal: new AbortController().signal });
  const channel = await bot.sendText({ channelId: 'channel-1', replyMessageId: 'source-1' }, 'hello');
  assert.deepEqual(channel.providerMessageIds, ['msg-1']);
  assert.equal(api.calls[0].kind, 'channel');
  assert.equal(api.calls[0].request.type, 1);
  assert.equal(api.calls[0].request.targetId, 'channel-1');
  assert.equal(api.calls[0].request.replyMsgId, 'source-1');

  const direct = await bot.sendText({ userId: 'user-1' }, 'private');
  assert.equal(api.calls[1].kind, 'direct');
  assert.equal(api.calls[1].request.targetId, 'user-1');

  await bot.sendDelivery({ channelId: 'channel-1' }, {
    kind: 'text',
    text: '**markdown**',
    format: 'markdown',
  });
  assert.equal(api.calls[2].kind, 'channel');
  assert.equal(api.calls[2].request.type, 9);
  assert.equal(api.calls[2].request.content, '**markdown**');
});

test('KOOK bot client uploads images and files before sending their asset URL', async () => {
  const api = fakeApi();
  const bot = new KookBotClient({ api, signal: new AbortController().signal });
  const image = await bot.sendImage(
    { channelId: 'channel-1' },
    { fileName: 'one.png', mediaType: 'image/png', bytes: Buffer.from('png') },
  );
  assert.equal(image.messageId, 'msg-2');
  assert.equal(api.calls[0].kind, 'upload');
  assert.equal(api.calls[0].file.fileName, 'one.png');
  assert.equal(api.calls[1].kind, 'channel');
  assert.equal(api.calls[1].request.type, 2);
  assert.equal(api.calls[1].request.content, 'https://img.kookapp.cn/assets/one.png');

  await bot.sendFile(
    { userId: 'user-1' },
    { fileName: 'report.txt', mediaType: 'text/plain', bytes: Buffer.from('report') },
  );
  assert.equal(api.calls[2].kind, 'upload');
  assert.equal(api.calls[3].kind, 'direct');
  assert.equal(api.calls[3].request.type, 4);
  assert.equal(api.calls[3].request.content, 'https://img.kookapp.cn/assets/report.txt');
});

test('KOOK bot client does not open an editable stream', () => {
  const api = fakeApi();
  const bot = new KookBotClient({ api, signal: new AbortController().signal });
  // KOOK cannot edit a message reliably; no openStream means TextHarnessBridge
  // skips the "正在处理…" placeholder and sends only the final answer.
  assert.equal(bot.openStream, undefined);
});

test('KOOK bot client adds and removes reactions on channel and direct messages', async () => {
  const api = fakeApi();
  const bot = new KookBotClient({ api, signal: new AbortController().signal });
  const channelTarget = { messageId: 'msg-1', channelType: 'GROUP' };
  const directTarget = { messageId: 'msg-2', channelType: 'PERSON' };

  assert.equal(await bot.addReaction(channelTarget, '[#128064;]'), '[#128064;]');
  assert.equal(api.calls[0].kind, 'reaction-channel');
  assert.equal(api.calls[0].request.messageId, 'msg-1');
  assert.equal(api.calls[0].request.emoji, '[#128064;]');
  assert.ok(api.calls[0].request.signal instanceof AbortSignal);
  await bot.removeReaction(channelTarget, '[#128064;]');
  assert.equal(api.calls[1].kind, 'unreaction-channel');
  assert.equal(api.calls[1].request.emoji, '[#128064;]');

  await bot.addReaction(directTarget, '[#9989;]');
  assert.equal(api.calls[2].kind, 'reaction-direct');
  assert.equal(api.calls[2].request.messageId, 'msg-2');
  await bot.removeReaction(directTarget, '[#9989;]');
  assert.equal(api.calls[3].kind, 'unreaction-direct');
});
