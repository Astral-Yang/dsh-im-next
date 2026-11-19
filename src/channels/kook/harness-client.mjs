import { HarnessClient } from '../shared/harness-client.mjs';

export class KookHarnessClient extends HarnessClient {
  constructor(options) {
    super({
      ...options,
      rpcIdPrefix: 'kook',
      logPrefix: 'dsh-kook',
    });
  }
}
