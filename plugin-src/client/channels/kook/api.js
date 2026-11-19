import { TOKEN_BOT_ENDPOINTS, createTokenChannelApi } from '../shared/token-api.js';

export const KOOK_RPC_CHANNEL = '/kook';
export const KOOK_ENDPOINTS = TOKEN_BOT_ENDPOINTS;

const api = createTokenChannelApi('KOOK', ' Gateway 长连接');

export const unwrapRpcResult = api.unwrapRpcResult;
export const normalizeSnapshot = api.normalizeSnapshot;
export const presentError = api.presentError;
export { api as kookClientApi };
