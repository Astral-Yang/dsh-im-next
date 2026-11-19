/**
 * 回应表情设置块：机器人在用户消息上留的三个状态标记。
 *
 * 处理中在收到消息后立即出现，成功/失败在回合结束时替换它。留空表示该状态
 * 不留标记——例如 Telegram 的成功态默认留空，避免一条早已读过的消息继续
 * 挂着回执控件。
 *
 * 每个渠道的写法不同（Unicode emoji、Slack 表情名、KOOK 表情代码），所以
 * 输入框旁的提示随渠道变化；具体取值由服务端按渠道默认值预填。
 */
import {
  kookReactionEmoji,
  kookReactionValue,
  normalizeReactionConfig,
  reactionFormatOf,
} from '../../../../src/channels/shared/reaction-config.mjs';
import { h } from '../../i18n.js';
import * as React from 'react';

const FORMAT_HINTS = Object.freeze({
  'slack-name': '输入 Slack 表情名，如 eyes、white_check_mark（不要冒号）',
  'kook-code': '输入 emoji 或 [#128064;] 代码，保存时自动换算',
  unicode: '直接输入 emoji，如 👀 ✅ ❌',
});

// 换算不了的输入（多个码点的 emoji）保留在输入框里并说明原因。
const INVALID_HINT = '无法换算：请输入单个 emoji 或 [#128064;] 这样的代码';

const STATE_LABELS = Object.freeze([
  ['processing', '处理中'],
  ['success', '成功'],
  ['error', '失败'],
]);

function hintFor(channelKey) {
  return FORMAT_HINTS[reactionFormatOf(channelKey)] ?? FORMAT_HINTS.unicode;
}

function ReactionField({
  state, label, stored, busy, saving, hint, format, fieldId, onCommit,
}) {
  const kook = format === 'kook-code';
  // KOOK 存的是 [#128064;] 这样的代码；输入框里显示原字符，用户只需认 emoji。
  const display = (code) => (kook ? kookReactionEmoji(code) ?? code ?? '' : code ?? '');
  const [value, setValue] = React.useState(display(stored));
  // 另一个标签页保存过、或重连之后，服务端存的值才是准的。
  React.useEffect(() => { setValue(display(stored)); }, [stored, kook]);
  // 提交的是存进去的写法：KOOK 换算成代码，其余渠道就是输入本身。
  const toStored = (text) => {
    if (!kook) return text.trim();
    const code = kookReactionValue(text);
    return code === null ? null : code;
  };
  const [invalid, setInvalid] = React.useState(false);
  const commit = () => {
    const next = toStored(value);
    if (next === null) {
      // 保留用户输入并说明原因，免得看起来像随手被清空。
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next === (stored ?? '')) {
      setValue(display(stored));
      return;
    }
    try {
      // 与服务端同一个规范化函数：控制字符、超长值在本地先拦下来。
      normalizeReactionConfig({ [state]: next });
    } catch {
      setValue(display(stored));
      return;
    }
    onCommit?.(next);
  };
  const note = kook && stored
    ? h('span', { className: 'dim-reactionsCode' }, stored)
    : null;
  return h('div', { className: 'dim-reactionsRow' },
    h('span', { className: 'dim-reactionsText' },
      h('label', { className: 'dim-reactionsLabel', htmlFor: fieldId }, label),
      h('span', {
        className: invalid ? 'dim-reactionsHint dim-reactionsHintError' : 'dim-reactionsHint',
      }, invalid ? INVALID_HINT : hint),
      note),
    h('span', { className: 'dim-reactionsControl' },
      h('input', {
        id: fieldId,
        type: 'text',
        className: 'dim-reactionsInput',
        value,
        placeholder: '留空表示不标记',
        maxLength: 64,
        disabled: Boolean(busy) || saving,
        onChange: (event) => { setValue(event.target.value); setInvalid(false); },
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        },
      })));
}

export function ReactionsSettings({
  account, channelKey, busy, rpcCall, endpoints, onChanged,
}) {
  const stored = account.reactions ?? { processing: '', success: '', error: '' };
  const [saving, setSaving] = React.useState(false);
  const endpoint = endpoints?.setReactions;
  const commit = async (state, value) => {
    if (typeof rpcCall !== 'function' || !endpoint) return;
    // 三个状态共用一个 RPC，所以每次提交都带上另外两个的当前值。
    const next = { ...stored, [state]: value };
    setSaving(true);
    try {
      const response = await rpcCall(endpoint, { botId: account.botId, reactions: next });
      if (response && response.ok === false) throw new Error(response.error?.message ?? '请求失败');
      await onChanged?.({ silent: true });
    } catch {
      // 服务端存的值仍然作准：界面回到它，免得显示一个没保存的表情。
      await onChanged?.({ silent: true });
    } finally {
      setSaving(false);
    }
  };
  return h('div', { className: 'dim-reactions' },
    h('h4', { className: 'dim-reactionsTitle' }, '回应表情'),
    h('p', { className: 'dim-reactionsIntro' },
      '机器人在这条消息上的状态标记；平台不接受的表情只是不留标记，不影响回复。'),
    STATE_LABELS.map(([state, label]) => h(ReactionField, {
      key: state,
      state,
      label,
      stored: stored[state] ?? '',
      busy: Boolean(busy),
      saving,
      hint: hintFor(channelKey),
      format: reactionFormatOf(channelKey),
      fieldId: `dim-reaction-${String(account.botId).replace(/[^a-zA-Z0-9_-]/g, '-')}-${state}`,
      onCommit: (value) => { void commit(state, value); },
    })));
}