import { KookConfigStore } from '../../../../src/channels/kook/config-store.mjs';
import { KookController } from '../../../../src/channels/kook/controller.mjs';
import { KookHarnessClient } from '../../../../src/channels/kook/harness-client.mjs';
import { KookRuntime } from '../../../../src/channels/kook/kook-runtime.mjs';
import { KookStateStore } from '../../../../src/channels/kook/state-store.mjs';
import { createTokenProductionController } from '../shared/production.mjs';

export function createProductionController(ctx, config = {}, internals = {}) {
  return createTokenProductionController(ctx, config, internals, {
    channel: 'kook',
    ConfigStore: KookConfigStore,
    StateStore: KookStateStore,
    HarnessClient: KookHarnessClient,
    Controller: KookController,
    Runtime: KookRuntime,
  });
}
