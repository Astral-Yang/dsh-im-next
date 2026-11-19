import { TokenBotController } from '../shared/token-bot-controller.mjs';
import { deriveKookBotIdentity, maskKookBotId } from './config-store.mjs';
import { inspectKookToken } from './kook-api.mjs';
import { KOOK_DESCRIPTOR } from './kook-bridge.mjs';

export class KookController extends TokenBotController {
  constructor(options) {
    super({
      ...options,
      descriptor: KOOK_DESCRIPTOR,
      inspectToken: options.inspectToken ?? inspectKookToken,
      deriveIdentity: deriveKookBotIdentity,
      maskPlatformId: maskKookBotId,
    });
  }
}
