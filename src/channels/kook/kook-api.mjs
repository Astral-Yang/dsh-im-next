import { t } from '../shared/i18n.mjs';

const DEFAULT_BASE_URL = 'https://www.kookapp.cn';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_FILE_UPLOAD_FIELD = 'file';
const KOOK_TOKEN_PATTERN = /^[^\s]{10,4096}$/u;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveTimeout(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function preserveProviderMetadata(target, source) {
  if (source?.providerCode !== undefined) target.providerCode = source.providerCode;
  if (Number.isInteger(source?.status)) target.status = source.status;
  if (source?.retryAfter !== undefined) target.retryAfter = source.retryAfter;
  return target;
}

export class KookApiError extends Error {
  constructor(code, message, { status, providerCode, retryAfter, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KookApiError';
    this.code = code;
    this.status = status;
    this.providerCode = providerCode;
    this.retryAfter = retryAfter;
  }
}

export function validKookToken(value) {
  return typeof value === 'string' && KOOK_TOKEN_PATTERN.test(value.trim());
}

function kookNetworkError(error, signal) {
  if (signal?.aborted) return abortReason(signal);
  if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') {
    return new KookApiError('kook-timeout', t('KOOK 服务请求超时。'), { cause: error });
  }
  return new KookApiError('kook-network-error', t('暂时无法访问 KOOK 服务。'), { cause: error });
}

function getResponseHeader(response, name) {
  try {
    return response?.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) / 1000 : undefined;
}

export class KookApi {
  #token;
  #fetch;
  #baseUrl;
  #requestTimeoutMs;
  #uploadTimeoutMs;

  constructor({
    token,
    fetchImpl = fetch,
    baseUrl = DEFAULT_BASE_URL,
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    uploadTimeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
  }) {
    if (!validKookToken(token)) throw new TypeError('KOOK Bot Token is invalid');
    if (typeof fetchImpl !== 'function') throw new TypeError('KookApi requires fetch');
    this.#token = token.trim();
    this.#fetch = fetchImpl;
    this.#baseUrl = new URL(baseUrl);
    if (this.#baseUrl.protocol !== 'https:') throw new TypeError('KOOK base URL must use HTTPS');
    if (!this.#baseUrl.pathname.endsWith('/')) this.#baseUrl.pathname += '/';
    this.#requestTimeoutMs = positiveTimeout(requestTimeoutMs, 'requestTimeoutMs');
    this.#uploadTimeoutMs = positiveTimeout(uploadTimeoutMs, 'uploadTimeoutMs');
  }

  get baseUrl() {
    return this.#baseUrl.toString();
  }

  async request(path, {
    method = 'GET',
    query,
    body,
    formData = false,
    signal,
    timeoutMs = this.#requestTimeoutMs,
    authenticated = true,
  } = {}) {
    const url = new URL(path, this.#baseUrl);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const headers = { Accept: 'application/json' };
    if (authenticated) headers.Authorization = `Bot ${this.#token}`;
    let requestBody;
    if (formData) {
      requestBody = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    if (signal?.aborted) throw abortReason(signal);
    let response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        ...(requestBody === undefined ? {} : { body: requestBody }),
        signal: requestSignal(signal, timeoutMs),
        redirect: 'manual',
      });
    } catch (error) {
      throw kookNetworkError(error, signal);
    }
    if (Number.isInteger(response?.status) && response.status >= 300 && response.status < 400) {
      await response?.body?.cancel?.().catch?.(() => undefined);
      throw new KookApiError('kook-redirect-blocked', 'KOOK 服务返回了意外的重定向。', {
        status: response.status,
      });
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw kookNetworkError(error, signal);
    }
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new KookApiError('kook-invalid-response', 'KOOK 服务返回了无法解析的响应。', {
          status: response.status,
        });
      }
    }
    if (!response.ok) {
      const providerCode = parsed && parsed.code !== undefined && parsed.code !== 0
        ? parsed.code : undefined;
      throw new KookApiError(
        response.status === 401 || response.status === 403 ? 'kook-401' : 'kook-http-error',
        parsed?.message || `KOOK 服务请求失败（HTTP ${response.status || 'unknown'}）。`,
        {
          status: response.status,
          providerCode,
          retryAfter: parseRetryAfter(getResponseHeader(response, 'retry-after')),
        },
      );
    }
    if (parsed && parsed.code !== undefined && parsed.code !== 0) {
      throw new KookApiError(
        parsed.code === 401 || parsed.code === 403 ? 'kook-401' : 'kook-rejected',
        parsed.message || 'KOOK 服务拒绝了请求。',
        { providerCode: parsed.code, status: response.status },
      );
    }
    return parsed?.data;
  }

  getSelfUser({ signal } = {}) {
    return this.request('/api/v3/user/me', { signal });
  }

  async openGateway({
    compress = false,
    fromDisconnect = false,
    lastProcessedSn,
    lastSessionId,
  } = {}, { signal } = {}) {
    const data = await this.request('/api/v3/gateway/index', {
      query: {
        compress: compress ? 1 : 0,
        ...(fromDisconnect ? {
          resume: 1,
          sn: lastProcessedSn,
          session_id: lastSessionId,
        } : {}),
      },
      signal,
    });
    return { success: true, code: 0, message: '', data };
  }

  createMessage({ targetId, type, content, quote, nonce, replyMsgId, signal }) {
    const target = cleanString(targetId);
    if (!target) throw new TypeError('KOOK targetId is required');
    return this.request('/api/v3/message/create', {
      method: 'POST',
      signal,
      body: {
        target_id: target,
        type,
        content,
        ...(quote ? { quote } : {}),
        ...(nonce ? { nonce } : {}),
        ...(replyMsgId ? { reply_msg_id: replyMsgId } : {}),
      },
    });
  }

  createDirectMessage({ targetId, type, content, quote, nonce, signal }) {
    const target = cleanString(targetId);
    if (!target) throw new TypeError('KOOK targetId is required');
    return this.request('/api/v3/direct-message/create', {
      method: 'POST',
      signal,
      body: {
        target_id: target,
        type,
        content,
        ...(quote ? { quote } : {}),
        ...(nonce ? { nonce } : {}),
      },
    });
  }

  updateMessage({ messageId, content, quote, signal }) {
    const id = cleanString(messageId);
    if (!id) throw new TypeError('KOOK messageId is required');
    return this.request('/api/v3/message/update', {
      method: 'POST',
      signal,
      body: {
        msg_id: id,
        content,
        ...(quote ? { quote } : {}),
      },
    });
  }

  deleteMessage({ messageId, signal }) {
    const id = cleanString(messageId);
    if (!id) throw new TypeError('KOOK messageId is required');
    return this.request('/api/v3/message/delete', {
      method: 'POST',
      signal,
      body: { msg_id: id },
    });
  }

  addReaction({ messageId, emoji, signal }) {
    const id = cleanString(messageId);
    const value = cleanString(emoji);
    if (!id || !value) throw new TypeError('KOOK messageId and emoji are required');
    return this.request('/api/v3/message/add-reaction', {
      method: 'POST',
      signal,
      body: { msg_id: id, emoji: value },
    });
  }

  deleteReaction({ messageId, emoji, userId, signal }) {
    const id = cleanString(messageId);
    const value = cleanString(emoji);
    if (!id || !value) throw new TypeError('KOOK messageId and emoji are required');
    return this.request('/api/v3/message/delete-reaction', {
      method: 'POST',
      signal,
      body: {
        msg_id: id,
        emoji: value,
        ...(userId ? { user_id: userId } : {}),
      },
    });
  }

  addDirectMessageReaction({ messageId, emoji, signal }) {
    const id = cleanString(messageId);
    const value = cleanString(emoji);
    if (!id || !value) throw new TypeError('KOOK messageId and emoji are required');
    return this.request('/api/v3/direct-message/add-reaction', {
      method: 'POST',
      signal,
      body: { msg_id: id, emoji: value },
    });
  }

  deleteDirectMessageReaction({ messageId, emoji, userId, signal }) {
    const id = cleanString(messageId);
    const value = cleanString(emoji);
    if (!id || !value) throw new TypeError('KOOK messageId and emoji are required');
    return this.request('/api/v3/direct-message/delete-reaction', {
      method: 'POST',
      signal,
      body: {
        msg_id: id,
        emoji: value,
        ...(userId ? { user_id: userId } : {}),
      },
    });
  }

  async uploadAsset({ file, signal }) {
    if (!file || typeof file !== 'object'
      || typeof file.fileName !== 'string' || !file.fileName
      || !Buffer.isBuffer(file.bytes)) {
      throw new TypeError('A KOOK file is required');
    }
    const form = new FormData();
    form.append(
      DEFAULT_FILE_UPLOAD_FIELD,
      new Blob([file.bytes], { type: file.mediaType ?? 'application/octet-stream' }),
      file.fileName,
    );
    return this.request('/api/v3/asset/create', {
      method: 'POST',
      body: form,
      formData: true,
      signal,
      timeoutMs: this.#uploadTimeoutMs,
    });
  }
}

export async function inspectKookToken(token, { fetchImpl = fetch, baseUrl } = {}) {
  if (!validKookToken(token)) {
    const error = new Error(t('KOOK Bot Token 无效，请重新填写。'));
    error.code = 'kook-401';
    throw error;
  }
  const api = new KookApi({ token, fetchImpl, ...(baseUrl ? { baseUrl } : {}) });
  let me;
  try {
    me = await api.getSelfUser();
  } catch (error) {
    if (error?.code === 'kook-401' || error?.status === 401 || error?.status === 403
      || String(error?.providerCode) === '401' || String(error?.providerCode) === '403') {
      const denied = new Error(t('KOOK Bot Token 无效，请重新填写。'));
      denied.code = 'kook-401';
      denied.cause = error;
      throw denied;
    }
    throw error;
  }
  const id = cleanString(me?.id);
  const name = cleanString(me?.username) ?? cleanString(me?.nickname) ?? (id ? `KOOK ${id}` : null);
  if (!id || !name) throw new Error('KOOK returned an invalid bot identity');
  return {
    platformId: id,
    name,
    username: cleanString(me?.username) ?? null,
  };
}

export function kookArtifactError(cause, { stage = 'send' } = {}) {
  if (cause?.code?.startsWith?.('artifact-')) return cause;
  const status = Number(cause?.status);
  const providerCode = String(cause?.providerCode ?? '');
  const message = String(cause?.message ?? '');
  let code = 'artifact-provider-rejected';
  let summary = 'KOOK rejected the attachment.';
  if (status === 401 || status === 403 || providerCode === '401' || providerCode === '403'
    || /(?:permission|forbidden|unauthor|access.?denied)/iu.test(message)) {
    code = 'artifact-permission-required';
    summary = 'KOOK denied permission to send the attachment.';
  } else if (status === 413 || providerCode === '413'
    || /(?:too.?large|size.?limit)/iu.test(message)) {
    code = 'artifact-too-large';
    summary = 'The attachment exceeds KOOK size limits.';
  } else if (status === 429 || providerCode === '429' || cause?.retryAfter !== undefined) {
    code = 'artifact-rate-limited';
    summary = 'KOOK rate-limited attachment delivery.';
  } else if (cause?.code === 'kook-timeout' && stage === 'upload') {
    code = 'artifact-upload-timeout';
    summary = 'KOOK attachment upload timed out before the message was sent.';
  } else if (stage === 'send' && (cause?.code === 'kook-network-error'
    || cause?.code === 'kook-timeout' || cause?.code === 'kook-invalid-response'
    || (status >= 500 && status < 600))) {
    code = 'artifact-delivery-uncertain';
    summary = 'KOOK attachment delivery result is uncertain.';
  } else if (stage === 'upload' && (cause?.code === 'kook-network-error'
    || status >= 500 && status < 600)) {
    code = 'artifact-provider-failed';
    summary = 'KOOK could not upload the attachment.';
  }
  const error = new Error(summary, { cause });
  error.code = code;
  return preserveProviderMetadata(error, cause);
}
