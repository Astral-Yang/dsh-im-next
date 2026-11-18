import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeKookEvent, stripKookMention } from '../../../src/channels/kook/kook-message.mjs';

const BOT_ID = 'kook-bot-1';

function groupEvent(overrides = {}) {
  return {
    channel_type: 'GROUP',
    type: 1,
    target_id: 'channel-1',
    author_id: 'user-1',
    content: '(met)kook-bot-1(met) 你好',
    msg_id: 'msg-1',
    msg_timestamp: 1710000000000,
    nonce: '',
    extra: {
      type: 1,
      guild_id: 'guild-1',
      channel_name: '测试频道',
      mention: ['kook-bot-1'],
      mention_all: false,
      mention_roles: [],
      mention_here: false,
      author: {
        id: 'user-1',
        username: 'alice',
        nickname: 'Alice',
        bot: false,
      },
    },
    ...overrides,
  };
}

test('KOOK group messages preserve channel routing and mention addressing', () => {
  const normalized = normalizeKookEvent(groupEvent(), BOT_ID);
  assert.equal(normalized.messageId, 'msg-1');
  assert.equal(normalized.senderId, 'user-1');
  assert.equal(normalized.kind, 'group');
  assert.equal(normalized.conversationId, 'channel-1');
  assert.equal(normalized.addressed, true);
  assert.equal(normalized.content, '你好');
  assert.equal(normalized.plainText, true);
  assert.deepEqual(normalized.replyTarget, {
    channelId: 'channel-1',
    replyMessageId: 'msg-1',
  });
  assert.equal(normalized.contextSource().senderName, 'Alice');
  assert.equal(normalized.contextSource().conversationTitle, '测试频道');
});

test('KOOK unmentioned group messages are not addressed but stay routable', () => {
  const event = groupEvent({
    content: '普通聊天',
    extra: { ...groupEvent().extra, mention: [] },
  });
  const normalized = normalizeKookEvent(event, BOT_ID);
  assert.equal(normalized.addressed, false);
  assert.equal(normalized.content, '普通聊天');
});

test('KOOK direct messages map to the sender user route', () => {
  const normalized = normalizeKookEvent(groupEvent({
    channel_type: 'PERSON',
    target_id: 'user-1',
    extra: {
      type: 1,
      mention: [],
      author: { id: 'user-1', username: 'alice', nickname: 'Alice', bot: false },
    },
  }), BOT_ID);
  assert.equal(normalized.kind, 'direct');
  assert.equal(normalized.conversationId, 'user-1');
  assert.equal(normalized.addressed, true);
  assert.deepEqual(normalized.replyTarget, { userId: 'user-1' });
});

test('KOOK image and file events use the platform attachment URL', () => {
  const image = normalizeKookEvent(groupEvent({
    type: 2,
    content: 'https://img.kookapp.cn/assets/one.png',
    extra: {
      ...groupEvent().extra,
      type: 2,
      attachments: {
        type: 'image',
        name: 'one.png',
        url: 'https://img.kookapp.cn/assets/one.png',
        file_type: 'image/png',
        size: 123,
      },
    },
  }), BOT_ID);
  assert.equal(image.images.length, 1);
  assert.equal(image.images[0].name, 'one.png');
  assert.equal(image.images[0].mediaType, 'image/png');
  assert.equal(image.files.length, 0);
  assert.equal(image.plainText, false);

  const file = normalizeKookEvent(groupEvent({
    type: 4,
    content: 'https://img.kookapp.cn/attachments/one.txt',
    extra: {
      ...groupEvent().extra,
      type: 4,
      attachments: {
        type: 'file',
        name: 'one.txt',
        url: 'https://img.kookapp.cn/attachments/one.txt',
        file_type: 'text/plain',
        size: 321,
      },
    },
  }), BOT_ID);
  assert.equal(file.files.length, 1);
  assert.equal(file.files[0].name, 'one.txt');
  assert.equal(file.files[0].mediaType, 'text/plain');
  assert.equal(file.images.length, 0);
});

test('KOOK bot messages and system events are ignored', () => {
  assert.equal(normalizeKookEvent(groupEvent({
    author_id: BOT_ID,
    extra: { ...groupEvent().extra, author: { id: BOT_ID, bot: true } },
  }), BOT_ID).senderIsBot, true);
  assert.equal(normalizeKookEvent(groupEvent({ type: 255 }), BOT_ID), null);
  assert.equal(stripKookMention('(met)kook-bot-1(met) 你好', BOT_ID), '你好');
});
