import { KEventTypes } from '@kookapp/js-sdk';
import { splitMessageText } from '../shared/editable-message-stream.mjs';
import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';
import { createTextDeliveryBlock } from '../shared/semantic/delivery.mjs';
import { kookArtifactError } from './kook-api.mjs';

const KOOK_TEXT_LIMIT = 4_000;
const KOOK_MARKDOWN_LIMIT = 4_000;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTarget(target) {
  const userId = cleanString(target?.userId);
  if (userId) return { direct: true, id: userId, replyMsgId: undefined };
  const channelId = cleanString(target?.channelId);
  if (!channelId) throw new TypeError('A KOOK reply target requires userId or channelId');
  return {
    direct: false,
    id: channelId,
    replyMsgId: cleanString(target?.replyMessageId) ?? undefined,
  };
}

export class KookBotClient {
  #api;
  #signal;
  #logger;

  constructor({ api, signal, logger }) {
    if (!api || typeof api.createMessage !== 'function'
      || typeof api.createDirectMessage !== 'function') {
      throw new TypeError('KookBotClient requires the KOOK API');
    }
    this.#api = api;
    this.#signal = signal;
    this.#logger = logger;
  }

  #create(target, type, content, { reply = true } = {}) {
    const route = normalizeTarget(target);
    const body = {
      targetId: route.id,
      type,
      content,
      signal: this.#signal,
    };
    if (route.direct) return this.#api.createDirectMessage(body);
    return this.#api.createMessage({
      ...body,
      replyMsgId: reply ? route.replyMsgId : undefined,
    });
  }

  async #sendChunks(target, text, type, limit) {
    const chunks = splitMessageText(text, limit);
    const providerMessageIds = [];
    for (const [index, chunk] of chunks.entries()) {
      const result = await this.#create(target, type, chunk, {
        reply: index === 0,
      });
      const messageId = cleanString(result?.msg_id);
      if (messageId) providerMessageIds.push(messageId);
    }
    return { providerMessageIds };
  }

  sendText(target, text) {
    return this.#sendChunks(target, text, KEventTypes.Text, KOOK_TEXT_LIMIT);
  }

  sendDelivery(target, value) {
    const block = createTextDeliveryBlock(value);
    if (block.format === 'plain') return this.sendText(target, block.text);
    const parts = chunkMarkdownParts(block.text, KOOK_MARKDOWN_LIMIT);
    if (parts.length === 0) return this.sendText(target, block.text);
    return (async () => {
      const providerMessageIds = [];
      for (const [index, part] of parts.entries()) {
        this.#signal?.throwIfAborted();
        const result = await this.#create(target, KEventTypes.KMarkdown, part.markdown, {
          reply: index === 0,
        });
        const messageId = cleanString(result?.msg_id);
        if (messageId) providerMessageIds.push(messageId);
      }
      return { providerMessageIds };
    })();
  }

  addReaction(target, emoji, { signal } = {}) {
    const messageId = cleanString(target?.messageId);
    const value = cleanString(emoji);
    if (!messageId || !value) throw new TypeError('A KOOK reaction target requires messageId and emoji');
    const request = {
      messageId,
      emoji: value,
      signal: signal ?? this.#signal,
    };
    if (target?.channelType === 'PERSON') {
      return this.#api.addDirectMessageReaction(request).then(() => value);
    }
    return this.#api.addReaction(request).then(() => value);
  }

  removeReaction(target, reactionKey, { signal } = {}) {
    const messageId = cleanString(target?.messageId);
    const value = cleanString(reactionKey);
    if (!messageId || !value) throw new TypeError('A KOOK reaction target requires messageId and emoji');
    const request = {
      messageId,
      emoji: value,
      signal: signal ?? this.#signal,
    };
    return target?.channelType === 'PERSON'
      ? this.#api.deleteDirectMessageReaction(request)
      : this.#api.deleteReaction(request);
  }

  sendImage(target, file) {
    return this.#sendArtifact(target, file, KEventTypes.Image);
  }

  sendVideo(target, file) {
    return this.#sendArtifact(target, file, KEventTypes.Video);
  }

  sendFile(target, file) {
    return this.#sendArtifact(target, file, KEventTypes.File);
  }

  async #sendArtifact(target, file, type) {
    let asset;
    try {
      this.#signal?.throwIfAborted();
      asset = await this.#api.uploadAsset({ file, signal: this.#signal });
    } catch (error) {
      if (this.#signal?.aborted) throw this.#signal.reason ?? error;
      throw kookArtifactError(error, { stage: 'upload' });
    }
    const url = cleanString(asset?.url);
    if (!url) {
      throw kookArtifactError(new Error('KOOK asset upload returned no URL'), { stage: 'upload' });
    }
    this.#signal?.throwIfAborted();
    try {
      const result = await this.#create(target, type, url);
      return { messageId: cleanString(result?.msg_id) ?? undefined };
    } catch (error) {
      if (this.#signal?.aborted) throw this.#signal.reason ?? error;
      throw kookArtifactError(error, { stage: 'send' });
    }
  }


}
