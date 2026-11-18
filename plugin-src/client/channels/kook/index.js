import { KookLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import {
  KOOK_ENDPOINTS,
  kookClientApi,
} from './api.js';
import { installKookStyles } from './styles.js';

const channel = createTokenChannelSettings({
  channel: 'KOOK',
  endpoints: KOOK_ENDPOINTS,
  api: kookClientApi,
  LogoGlyph: KookLogoGlyph,
  installStyles: installKookStyles,
  pageClass: 'dkc-page',
  avatarClass: 'dkc-avatar',
  connectionLabel: ' Gateway 长连接',
  tokenPlaceholder: '填写 KOOK 开发者平台的 Bot Token',
  emptyTitle: '接入 KOOK 机器人',
  emptyDescription: '先在 KOOK 开发者平台创建机器人并邀请到服务器，再在这里完成接入。',
  platformLabel: 'KOOK 开发者平台',
});

export const KookSettingsTab = channel.SettingsTab;
export const KookAccountCard = channel.AccountCard;
