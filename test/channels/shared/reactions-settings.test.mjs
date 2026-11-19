import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

import { ReactionsSettings } from '../../../plugin-src/client/channels/shared/reactions-settings.js';

function render(channelKey, reactions) {
  return renderToStaticMarkup(React.createElement(ReactionsSettings, {
    account: { botId: 'kook_0123456789abcdef01234567', reactions },
    channelKey,
    busy: false,
    rpcCall: async () => ({ ok: true }),
    endpoints: { setReactions: 'bot.reactions.set' },
    onChanged: async () => {},
  }));
}

test('KOOK fields show the emoji, not the bracketed code', () => {
  const markup = render('kook', {
    processing: '[#128064;]',
    success: '[#9989;]',
    error: '[#10060;]',
  });

  assert.match(markup, /value="👀"/u);
  assert.match(markup, /value="✅"/u);
  assert.match(markup, /value="❌"/u);
  // The stored code stays visible underneath so the value is auditable.
  assert.match(markup, /\[#128064;\]/u);
});

test('KOOK decodes a stored code to its emoji', () => {
  const markup = render('kook', { processing: '[#9999;]', success: '', error: '' });

  // 9999 is U+270F ✏: any code point decodes, not only the defaults.
  assert.match(markup, /value="✏"/u);
  assert.match(markup, /\[#9999;\]/u);
});

test('an unparseable KOOK code stays visible instead of vanishing', () => {
  const markup = render('kook', { processing: '[#2000000;]', success: '', error: '' });

  assert.match(markup, /value="\[#2000000;\]"/u);
});

test('other channels keep the stored value as their input', () => {
  const markup = render('telegram', { processing: '👀', success: '', error: '👎' });

  assert.match(markup, /value="👀"/u);
  assert.doesNotMatch(markup, /<button/u, 'the panel is input-only, with no picker');
});