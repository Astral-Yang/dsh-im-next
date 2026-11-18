import { createProductionController } from './production.mjs';
import { createKookRpcHandler, installKookRpc, KOOK_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-kook-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installKookRpc(ctx, config.controller, config.rpcAuthority);
  }
  return installProductionChannel(ctx, config, {
    channel: 'kook',
    rpcChannel: KOOK_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createKookRpcHandler(controller),
  });
}

export function createKookHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  KOOK_ENDPOINTS,
  KOOK_RPC_CHANNEL,
  KOOK_RPC_ENDPOINTS,
  createKookRpcHandler,
  installKookRpc,
} from './rpc.mjs';
export { KookController } from '../../../../src/channels/kook/controller.mjs';
export { KookRuntime } from '../../../../src/channels/kook/kook-runtime.mjs';
