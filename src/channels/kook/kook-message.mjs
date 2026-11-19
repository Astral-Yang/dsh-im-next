import { ChannelTypes, KEventTypes } from '@kookapp/js-sdk';
import { fetchFileStream } from '../shared/file-download.mjs';
import { fetchImageBuffer } from '../shared/image-prompt.mjs';

const KOOK_MEDIA_HOSTS = Object.freeze(['.kookapp.cn', '.kaiheila.cn']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function attachmentOf(event) {
  const value = event?.extra?.attachments;
  if (Array.isArray(value)) return value.find((item) => item && typeof item === 'object') ?? null;
  return value && typeof value === 'object' ? value : null;
}

function attachmentUrl(event, attachment) {
  return cleanString(attachment?.url) ?? cleanString(event?.content);
}

function attachmentMediaType(attachment, type) {
  const declared = cleanString(attachment?.file_type) ?? cleanString(attachment?.mime_type);
  if (declared) return declared.split(';', 1)[0].trim().toLowerCase();
  if (Number(type) === KEventTypes.Image) return 'image/png';
  return undefined;
}

function attachmentName(attachment, fallback) {
  return cleanString(attachment?.name) ?? fallback;
}

function attachmentSize(attachment) {
  const size = Number(attachment?.size);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function imageSource(event, attachment, fetchImpl) {
  const url = attachmentUrl(event, attachment);
  if (!url) return null;
  const mediaType = attachmentMediaType(attachment, KEventTypes.Image);
  return {
    name: attachmentName(attachment, 'image'),
    ...(mediaType && IMAGE_TYPES.has(mediaType) ? { mediaType } : {}),
    ...(attachmentSize(attachment) === undefined ? {} : { size: attachmentSize(attachment) }),
    load: (options = {}) => fetchImageBuffer(url, {
      ...options,
      fetchImpl,
      allowedHosts: KOOK_MEDIA_HOSTS,
    }),
  };
}

function fileSource(event, attachment, fetchImpl, fallback) {
  const url = attachmentUrl(event, attachment);
  if (!url) return null;
  const mediaType = attachmentMediaType(attachment, event?.type);
  return {
    name: attachmentName(attachment, fallback),
    ...(mediaType ? { mediaType } : {}),
    ...(attachmentSize(attachment) === undefined ? {} : { size: attachmentSize(attachment) }),
    load: ({ signal } = {}) => fetchFileStream(url, {
      fetchImpl,
      signal,
      allowedHosts: KOOK_MEDIA_HOSTS,
    }),
  };
}

export function stripKookMention(value, botId) {
  if (typeof value !== 'string') return '';
  return value
    .split(`(met)${botId}(met)`).join('')
    .split(`<@${botId}>`).join('')
    .trim();
}

/**
 * Normalize one KOOK text-channel event into the shared TextHarnessBridge contract.
 * `textChannelEvent` covers both guild channels (GROUP) and private chats (PERSON);
 * the latter's `target_id` is the other user's id.
 */
export function normalizeKookEvent(event, botId, { fetchImpl = fetch } = {}) {
  if (!event || event.type === KEventTypes.System || !cleanString(event.msg_id)) return null;
  const senderId = cleanString(event.author_id) ?? cleanString(event.extra?.author?.id);
  if (!senderId) return null;
  const type = Number(event.type);
  const direct = event.channel_type === ChannelTypes.Person;
  const extra = event.extra && typeof event.extra === 'object' ? event.extra : {};
  const attachment = attachmentOf(event);
  const images = type === KEventTypes.Image
    ? [imageSource(event, attachment, fetchImpl)].filter(Boolean) : [];
  const files = [KEventTypes.File, KEventTypes.Video, KEventTypes.Audio].includes(type)
    ? [fileSource(event, attachment, fetchImpl, type === KEventTypes.Video ? 'video' : 'file')].filter(Boolean) : [];
  const text = [KEventTypes.Text, KEventTypes.KMarkdown, KEventTypes.Card].includes(type)
    ? String(event.content ?? '') : '';
  const mention = Array.isArray(extra.mention) ? extra.mention.map(String) : [];
  const addressed = direct
    || mention.includes(String(botId))
    || extra.mention_all === true
    || extra.mention_here === true;
  const targetId = direct ? senderId : cleanString(event.target_id);
  if (!targetId) return null;
  const replyTarget = direct
    ? { userId: senderId }
    : { channelId: targetId, replyMessageId: cleanString(event.msg_id) ?? undefined };
  return {
    messageId: String(event.msg_id),
    senderId,
    senderIsBot: extra.author?.bot === true || senderId === String(botId),
    kind: direct ? 'direct' : 'group',
    conversationId: direct ? senderId : targetId,
    contextSource: () => ({
      senderName: cleanString(extra.author?.nickname) ?? cleanString(extra.author?.username) ?? undefined,
      conversationTitle: cleanString(extra.channel_name) ?? undefined,
      chatId: targetId,
    }),
    content: stripKookMention(text, botId),
    plainText: images.length === 0 && files.length === 0 && type !== KEventTypes.Card,
    images,
    files,
    addressed,
    replyTarget,
    reactionTarget: {
      messageId: String(event.msg_id),
      targetId,
      channelType: direct ? ChannelTypes.Person : ChannelTypes.Group,
    },
    connectionTestTarget: replyTarget,
  };
}
