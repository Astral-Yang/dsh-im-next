import {
  TOKEN_BOT_ENDPOINTS,
  createTokenBotRpcHandler,
  installTokenBotRpc,
} from '../shared/rpc.mjs';

export const KOOK_RPC_CHANNEL = '/kook';
export const KOOK_ENDPOINTS = TOKEN_BOT_ENDPOINTS;
export const KOOK_RPC_ENDPOINTS = Object.freeze(Object.values(KOOK_ENDPOINTS));

export function createKookRpcHandler(controller) {
  return createTokenBotRpcHandler(controller, { channel: 'KOOK' });
}

export function installKookRpc(ctx, controller, authority) {
  return installTokenBotRpc(ctx, controller, {
    channel: 'KOOK',
    rpcChannel: KOOK_RPC_CHANNEL,
    authority,
  });
}
