import { VISUALIZATION_CHANNELS } from '../../../visualization/design-system.js';
/** The exhibition is a normal browser, not Electron. Adapt only the authored
 * visualization guest to a sandboxed iframe. No remote URL or native code runs. */
export function installVisualizationGuestPreview() {
  const mounted = new WeakMap<Element, HTMLIFrameElement>();
  const update = () => {
    for (const guest of document.querySelectorAll<HTMLElement>(
      'webview[data-testid="inline-visualization-webview"]',
    )) {
      const source = guest.getAttribute('src');
      if (!source || !/^(data:text\/html|blob:)/.test(source)) continue;
      let frame = mounted.get(guest);
      if (!frame) {
        frame = document.createElement('iframe');
        frame.title = '离线可视化内容';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
        frame.onload = () => {
          guest.dispatchEvent(new Event('dom-ready'));
          guest.dispatchEvent(
            Object.assign(new Event('ipc-message'), {
              channel: VISUALIZATION_CHANNELS.ready,
              args: [],
            }),
          );
          guest.dispatchEvent(
            Object.assign(new Event('ipc-message'), {
              channel: VISUALIZATION_CHANNELS.height,
              args: [{ height: 340 }],
            }),
          );
        };
        guest.appendChild(frame);
        mounted.set(guest, frame);
      }
      if (frame.getAttribute('src') !== source) frame.src = source;
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  update();
  return () => observer.disconnect();
}
