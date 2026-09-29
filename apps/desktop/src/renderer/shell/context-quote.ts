/** Quoting only updates the current draft; it never sends a model request. */
export function appendContextQuote(draft: string, text: string, label: string): string {
  if (!text.trim()) return draft;
  const quote = text.replace(/\r\n/g, '\n').trim().split('\n').map(line => '> ' + line).join('\n');
  const prefix = draft.trimEnd();
  return prefix + (prefix ? '\n\n' : '') + label + '：\n' + quote + '\n\n';
}
