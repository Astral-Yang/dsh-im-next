import { deriveTokenBotIdentity, maskPlatformId, TokenBotConfigStore } from '../shared/token-config-store.mjs';
import { t } from '../shared/i18n.mjs';

const IDENTITY_OPTIONS = Object.freeze({
  botPrefix: 'kook',
  tokenRefPrefix: 'DSH_KOOK_BOT_TOKEN',
});

export function deriveKookBotIdentity(platformId) {
  return deriveTokenBotIdentity(platformId, IDENTITY_OPTIONS);
}

export function maskKookBotId(platformId) {
  return maskPlatformId(platformId, t('KOOK机器人'));
}

export class KookConfigStore extends TokenBotConfigStore {
  constructor(path) {
    super(path, {
      channel: 'KOOK',
      ...IDENTITY_OPTIONS,
    });
  }
}
