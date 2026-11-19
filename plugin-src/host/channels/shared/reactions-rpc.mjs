import { normalizeReactionConfig, SET_REACTIONS_ENDPOINT } from '../../../../src/channels/shared/reaction-config.mjs';

export { SET_REACTIONS_ENDPOINT };

/**
 * Validate the `reactions` half of the payload with the same normalizer the
 * config store will apply, so a value the panel accepts can never be rejected
 * later by the store — and a value the store would reject never reaches it.
 */
export function validReactionsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 2
    || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'reactions')
    || typeof payload.botId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)) return false;
  try {
    return normalizeReactionConfig(payload.reactions) !== null;
  } catch {
    return false;
  }
}