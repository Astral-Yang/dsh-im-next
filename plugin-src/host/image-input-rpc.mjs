import {
  DEFAULT_IMAGE_INPUT_SETTINGS,
  normalizeImageInputSettings,
} from '../../src/channels/shared/image-input-policy.mjs';

export const IMAGE_INPUT_ENDPOINTS = Object.freeze({
  get: 'settings.image-input.get',
  set: 'settings.image-input.set',
});

const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_IMAGE_INPUT_SETTINGS));

export function createImageInputRpcHandler(store) {
  return async (endpoint, payload, signal) => {
    const object = payload && typeof payload === 'object' && !Array.isArray(payload);
    const valid = object && (endpoint === IMAGE_INPUT_ENDPOINTS.get
      ? Object.keys(payload).length === 0
      : endpoint === IMAGE_INPUT_ENDPOINTS.set
        && Object.keys(payload).every((key) => SETTING_KEYS.includes(key))
        && normalizeImageInputSettings(payload));
    if (!valid) return { ok: false, error: { code: 'bad-request', message: '图片设置无效：图片上限需为正整数，提示词最多 1000 个字符。' } };
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'Request cancelled.' } };
    try {
      const value = endpoint === IMAGE_INPUT_ENDPOINTS.get ? await store.get() : await store.set(payload);
      return { ok: true, value };
    } catch {
      return { ok: false, error: { code: 'image-input-settings-unavailable', message: '无法读取或保存图片设置，请稍后重试。' } };
    }
  };
}
