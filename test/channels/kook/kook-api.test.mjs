import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KookApi,
  KookApiError,
  inspectKookToken,
  validKookToken,
} from '../../../src/channels/kook/kook-api.mjs';

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const TOKEN = 'kook-test-token-123456';

test('KOOK token validation and identity inspection use the user/me endpoint', async () => {
  assert.equal(validKookToken(TOKEN), true);
  assert.equal(validKookToken('short'), false);
  const calls = [];
  const identity = await inspectKookToken(TOKEN, {
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return jsonResponse({
        code: 0,
        message: '',
        data: { id: 'kook-bot-1', username: 'Shorekeeper' },
      });
    },
  });
  assert.deepEqual(identity, {
    platformId: 'kook-bot-1',
    name: 'Shorekeeper',
    username: 'Shorekeeper',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.kookapp.cn/api/v3/user/me');
  assert.equal(calls[0].init.headers.Authorization, `Bot ${TOKEN}`);
});

test('KOOK API sends JSON messages and maps provider rejection codes', async () => {
  const calls = [];
  const api = new KookApi({
    token: TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return jsonResponse({ code: 0, message: '', data: { msg_id: 'msg-1' } });
    },
  });
  const result = await api.createMessage({
    targetId: 'channel-1',
    type: 9,
    content: '**hello**',
    replyMsgId: 'msg-0',
  });
  assert.equal(result.msg_id, 'msg-1');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    target_id: 'channel-1',
    type: 9,
    content: '**hello**',
    reply_msg_id: 'msg-0',
  });

  const rejected = new KookApi({
    token: TOKEN,
    fetchImpl: async () => jsonResponse({ code: 40000, message: 'denied' }),
  });
  await assert.rejects(
    rejected.createMessage({ targetId: 'channel-1', type: 1, content: 'hi' }),
    (error) => error instanceof KookApiError
      && error.code === 'kook-rejected'
      && error.providerCode === 40000,
  );
});

test('KOOK API uploads assets as multipart and exposes the gateway response', async () => {
  const calls = [];
  const api = new KookApi({
    token: TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      if (url.pathname === '/api/v3/asset/create') {
        return jsonResponse({ code: 0, data: { url: 'https://img.kookapp.cn/assets/result.png' } });
      }
      return jsonResponse({ code: 0, data: { url: 'wss://gateway.kookapp.cn/ws' } });
    },
  });
  const uploaded = await api.uploadAsset({
    file: { fileName: 'result.png', mediaType: 'image/png', bytes: Buffer.from('png') },
  });
  assert.equal(uploaded.url, 'https://img.kookapp.cn/assets/result.png');
  assert.equal(calls[0].url, 'https://www.kookapp.cn/api/v3/asset/create');
  assert.equal(calls[0].init.headers.Authorization, `Bot ${TOKEN}`);
  assert.equal(calls[0].init.body instanceof FormData, true);

  const gateway = await api.openGateway({ compress: true });
  assert.equal(gateway.success, true);
  assert.equal(gateway.data.url, 'wss://gateway.kookapp.cn/ws');
  assert.match(calls[1].url, /\/api\/v3\/gateway\/index\?compress=1$/u);
});

test('KOOK API maps HTTP 401 to a token error without leaking response bodies', async () => {
  const api = new KookApi({
    token: TOKEN,
    fetchImpl: async () => jsonResponse({ code: 401, message: 'private provider detail' }, { status: 401 }),
  });
  await assert.rejects(
    api.getSelfUser(),
    (error) => error instanceof KookApiError
      && error.code === 'kook-401'
      && error.status === 401,
  );
});
