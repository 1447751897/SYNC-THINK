/** Keep release notes as inert offline data rather than executable bundle bytes. */
export const SHELL_RELEASE_HISTORY_ID = 'sync-think-release-history';

export function embedShellReleaseHistory(html, history) {
  if (typeof html !== 'string' || !/<\/head\s*>/i.test(html)) {
    throw new Error('shell.release_history.head_missing');
  }
  if (html.includes(`id="${SHELL_RELEASE_HISTORY_ID}"`)) {
    throw new Error('shell.release_history.already_embedded');
  }
  // Script data is raw text: escaping < prevents a note from closing the data
  // block and creating executable markup. JSON.parse restores the exact notes.
  const json = JSON.stringify(history).replace(/</g, '\\u003c');
  const block = `<script type="application/json" id="${SHELL_RELEASE_HISTORY_ID}">${json}</script>`;
  return html.replace(/<\/head\s*>/i, (closingHead) => `${block}\n${closingHead}`);
}
