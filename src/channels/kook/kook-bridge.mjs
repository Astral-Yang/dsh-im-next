import { TextHarnessBridge, createTextBridgeStatus } from '../shared/text-harness-bridge.mjs';

export const KOOK_DESCRIPTOR = Object.freeze({
  key: 'kook',
  label: 'KOOK',
  connectionLabel: ' Gateway 长连接',
  supportsSid: true,
  reactions: Object.freeze({
    processing: '[#128064;]',
    success: '[#9989;]',
    error: '[#10060;]',
  }),
});

export class KookHarnessBridge extends TextHarnessBridge {
  constructor(options) {
    super({ descriptor: KOOK_DESCRIPTOR, ...options });
  }
}

export { createTextBridgeStatus as createKookBridgeStatus };
