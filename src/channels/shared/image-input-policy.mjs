import { DEFAULT_IMAGE_PROMPT, normalizeImagePrompt } from './image-prompt.mjs';

export const IMAGE_MEGABYTE = 1024 * 1024;

/** Numeric limits stay ordered as they appear in the settings form. */
const IMAGE_LIMIT_KEYS = Object.freeze([
  'maxDownloadMb',
  'maxImageMb',
  'maxTotalMb',
  'maxImages',
]);

export const DEFAULT_IMAGE_INPUT_SETTINGS = Object.freeze({
  maxDownloadMb: 30,
  maxImageMb: 5,
  maxTotalMb: 20,
  maxImages: 20,
  imagePrompt: DEFAULT_IMAGE_PROMPT,
});

/** Shared by the settings form and Host; reject incomplete or unsafe values. */
export function normalizeImageInputSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of IMAGE_LIMIT_KEYS) {
    const input = value[key];
    const number = typeof input === 'string' && /^\d+$/.test(input.trim())
      ? Number(input.trim()) : input;
    if (!Number.isSafeInteger(number) || number < 1
      || !Number.isSafeInteger(number * IMAGE_MEGABYTE)) return null;
    result[key] = number;
  }
  if (result.maxDownloadMb < result.maxImageMb || result.maxTotalMb < result.maxImageMb) return null;
  // Older settings documents predate this field; an omitted prompt keeps the
  // built-in default instead of invalidating the whole document.
  const imagePrompt = normalizeImagePrompt(value.imagePrompt);
  if (imagePrompt === null) return null;
  result.imagePrompt = imagePrompt;
  return Object.freeze(result);
}

export function imageInputLimits(settings = DEFAULT_IMAGE_INPUT_SETTINGS) {
  const normalized = normalizeImageInputSettings(settings);
  if (!normalized) throw new TypeError('Invalid image input settings');
  return Object.freeze({
    maxDownloadBytes: normalized.maxDownloadMb * IMAGE_MEGABYTE,
    maxImageBytes: normalized.maxImageMb * IMAGE_MEGABYTE,
    maxTotalImageBytes: normalized.maxTotalMb * IMAGE_MEGABYTE,
    maxImages: normalized.maxImages,
  });
}
