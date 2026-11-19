export const KOOK_STYLE_ID = 'xmanrui-dsh-im-kook-settings';

const CSS = String.raw`
.dkc-page { --ddt-accent: #00a1e9; --ddt-accent-deep: #007bb5; --ddt-accent-wash: #e8f7fe; }
.dkc-avatar { color: #fff; background: #87EB00; }
.dim-panel .dim-botAvatar.dkc-avatar { background: #87EB00; }
.dkc-avatar svg { display: block; }
.dim-panel .dim-botAvatar.dkc-avatar svg { width: 30px; height: 30px; }
`;

export function installKookStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${KOOK_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = KOOK_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}
