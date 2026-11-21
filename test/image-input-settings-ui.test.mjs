import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { ImageInputSettings } from '../plugin-src/client/global-settings.js';
import { DEFAULT_IMAGE_INPUT_SETTINGS } from '../src/channels/shared/image-input-policy.mjs';

test('image settings load, validate, save limits and prompt, and retain input after RPC failure', async () => {
  const calls = [];
  let reject = false;
  let renderer;
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (reject) return { ok: false, error: { message: '写入失败' } };
    return { ok: true, value: endpoint.endsWith('.get') ? DEFAULT_IMAGE_INPUT_SETTINGS : payload };
  };
  await act(async () => { renderer = create(React.createElement(ImageInputSettings, { rpcCall })); });
  const inputs = () => renderer.root.findAllByType('input');
  const prompt = () => renderer.root.findByType('textarea');
  const submit = () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(inputs().map((input) => input.props.value), [30, 5, 20, 20]);
  assert.equal(prompt().props.value, DEFAULT_IMAGE_INPUT_SETTINGS.imagePrompt);
  await act(async () => inputs()[1].props.onChange({ target: { value: '31' } }));
  await act(submit);
  assert.equal(calls.length, 1);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /正整数/);
  await act(async () => prompt().props.onChange({ target: { value: '请描述这张截图。' } }));
  await act(async () => inputs()[1].props.onChange({ target: { value: '6' } }));
  await act(submit);
  assert.deepEqual(calls.at(-1).payload, {
    ...DEFAULT_IMAGE_INPUT_SETTINGS, maxImageMb: 6, imagePrompt: '请描述这张截图。',
  });
  assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), '已保存');
  await act(async () => prompt().props.onChange({ target: { value: 'x'.repeat(1001) } }));
  await act(submit);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /1000/);
  await act(async () => prompt().props.onChange({ target: { value: DEFAULT_IMAGE_INPUT_SETTINGS.imagePrompt } }));
  reject = true;
  await act(async () => inputs()[0].props.onChange({ target: { value: '40' } }));
  await act(submit);
  assert.equal(inputs()[0].props.value, '40');
  assert.equal(inputs()[0].props.disabled, false);
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), '写入失败');
  act(() => renderer.unmount());
});
