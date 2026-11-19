/**
 * Status reactions: the mark a channel leaves on the user's own message while
 * the turn is running, when it succeeds and when it fails.
 *
 * Every field is a plain string in the channel's own notation — a Unicode emoji
 * for Telegram/Discord/Matrix/WhatsApp, a Slack emoji name without colons, a
 * KOOK emoji code such as `[#128064;]`. An empty string disables that state, so
 * a channel that only wants to announce work can keep success silent.
 *
 * The catalog below is the default a channel falls back to when the stored
 * config carries no `reactions` object. Storing the object makes the whole set
 * explicit; a partial object still merges over the default per state.
 */

/** Reactions carry at most this many characters (Slack names are the longest). */
export const REACTION_MAX_LENGTH = 64;

export const REACTION_STATES = Object.freeze(['processing', 'success', 'error']);

/** The one RPC both the host handler and every channel's settings panel agree on. */
export const SET_REACTIONS_ENDPOINT = 'bot.reactions.set';

const EMPTY_REACTIONS = Object.freeze({ processing: '', success: '', error: '' });

/** A set that switches every mark off — what a "reactions: off" toggle becomes. */
export const DISABLED_REACTIONS = EMPTY_REACTIONS;

function freezeReactions(processing, success, error) {
  return Object.freeze({ processing, success, error });
}

/**
 * Defaults per channel key. A channel missing here has no platform reaction at
 * all (email), or keeps its own bespoke lifecycle (DingTalk, Feishu), and its
 * bridge descriptor supplies whatever it uses.
 */
export const DEFAULT_REACTIONS = Object.freeze({
  telegram: freezeReactions('👀', '', '👎'),
  discord: freezeReactions('👀', '✅', '❌'),
  slack: freezeReactions('eyes', 'white_check_mark', 'x'),
  matrix: freezeReactions('👀', '✔', '✕'),
  kook: freezeReactions('[#128064;]', '[#9989;]', '[#10060;]'),
  whatsapp: freezeReactions('👀', '✅', '❌'),
});

/**
 * How a channel spells a reaction, for the settings panel's hint text.
 *
 * `unicode` takes an emoji literally; `slack-name` takes the name Slack gives an
 * emoji (`eyes`, not `:eyes:`); `kook-code` takes KOOK's bracketed code.
 */
export const REACTION_FORMATS = Object.freeze({
  telegram: 'unicode',
  discord: 'unicode',
  matrix: 'unicode',
  whatsapp: 'unicode',
  slack: 'slack-name',
  kook: 'kook-code',
});

export function reactionFormatOf(channelKey) {
  return REACTION_FORMATS[channelKey] ?? 'unicode';
}

/**
 * KOOK 的表情代码是 Unicode 码点的十进制写法：`[#128064;]` 就是 U+1F440 👀。
 * 面板因此可以把代码与原字符互相换算，用户只需要输入 emoji。
 */
const KOOK_CODE = /^\[#(\d{1,8});\]$/u;

/** 单个码点的 emoji → KOOK 代码；多个码点（如 ❤️）需要原样填写代码。 */
export function kookReactionCode(emoji) {
  const characters = Array.from(typeof emoji === 'string' ? emoji.trim() : '');
  if (characters.length !== 1) return null;
  return `[#${characters[0].codePointAt(0)};]`;
}

/** KOOK 代码 → 原字符；无法识别的代码（平台自定义表情）原样返回 null。 */
export function kookReactionEmoji(code) {
  const match = KOOK_CODE.exec(typeof code === 'string' ? code.trim() : '');
  if (!match) return null;
  const codePoint = Number(match[1]);
  if (!Number.isSafeInteger(codePoint) || codePoint > 0x10FFFF) return null;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}

/** 面板里的一段输入 → 可存的 KOOK 取值；无法换算时返回 null。 */
export function kookReactionValue(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  if (KOOK_CODE.test(trimmed)) return trimmed;
  return kookReactionCode(trimmed);
}

export function defaultReactionsOf(channelKey) {
  return DEFAULT_REACTIONS[channelKey] ?? null;
}

function normalizeReactionValue(state, value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    throw new TypeError(`reaction ${state} must be a string`);
  }
  // A reaction is a single token: surrounding blanks come from copy-paste, but
  // an embedded newline or control character would corrupt the platform call.
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new TypeError(`reaction ${state} must not contain control characters`);
  }
  if (trimmed.length > REACTION_MAX_LENGTH) {
    throw new TypeError(`reaction ${state} must be at most ${REACTION_MAX_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * Validate a stored or submitted `reactions` value.
 *
 * Returns a frozen object carrying the states the caller named, or `null` for
 * "nothing stored" (`undefined`/`null`). Unknown keys are rejected instead of
 * silently dropped: a typo in a hand-edited config should surface as an error,
 * not as a reaction that quietly never changes.
 */
export function normalizeReactionConfig(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('reactions must be an object');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !REACTION_STATES.includes(key)) {
      throw new TypeError(`unknown reaction state: ${String(key)}`);
    }
  }
  // Only the states the caller actually named: an omitted state keeps the
  // channel default, while an explicit empty string switches it off.
  const normalized = {};
  for (const state of REACTION_STATES) {
    if (Object.hasOwn(value, state)) {
      normalized[state] = normalizeReactionValue(state, value[state]);
    }
  }
  return Object.freeze(normalized);
}

/**
 * The set a channel should actually use: the stored override merged over the
 * channel default, or `null` when the channel has neither.
 */
export function resolveChannelReactions(channelKey, stored) {
  // A stored value written by an older or hand-edited config must never take the
  // bot down at start-up: an unusable one is treated as absent.
  let normalized = null;
  try {
    normalized = normalizeReactionConfig(stored);
  } catch {
    normalized = null;
  }
  const defaults = defaultReactionsOf(channelKey);
  if (!normalized && !defaults) return null;
  return Object.freeze({
    ...EMPTY_REACTIONS,
    ...(defaults ?? {}),
    ...(normalized ?? {}),
  });
}