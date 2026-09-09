// Mermaid source pre-processing, ported verbatim from NewMax's shipped renderer
// bundle (`sanitizeMermaidSource` / `repairMermaidLabels`).
//
// sanitizeMermaidSource: drops AI-authored style/classDef/linkStyle colour lines
// so a diagram never fights the design-system palette baked into themeVariables.
//
// repairMermaidLabels: flowchart/graph only. When a node id is immediately
// followed by a bracket whose inner label contains brackets/parens/braces,
// mermaid's parser fails. NewMax re-quotes those labels (`A[foo (bar)]` →
// `A["foo (bar)"]`) before falling back to a hard parse error.

export function sanitizeMermaidSource(source: string): string {
  if (!source) return source;
  const COLOR_LINE = /^\s*(style|classDef|linkStyle)\s+\S+.*\b(fill|stroke|color|background)\b/;
  return source
    .split('\n')
    .filter((line) => !COLOR_LINE.test(line))
    .join('\n');
}

export function repairMermaidLabels(source: string): string {
  if (!source) return source;
  const firstNonEmpty =
    source
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  if (!/^(flowchart|graph)\b/i.test(firstNonEmpty)) return source;

  const SPECIAL = /[[\](){}]/;
  const SIMPLE: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
  const EXOTIC_NEXT: Record<string, string> = {
    '[': '[(/\\',
    // [[ [( [/ [\
    '(': '([',
    //    (( ([
    '{': '{',
    //     {{
  };
  const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c);

  const repairLine = (line: string): string => {
    if (line.trim().startsWith('%%')) return line;
    let out = '';
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (isIdChar(c)) {
        let j = i;
        while (j < n && isIdChar(line[j])) j++;
        const id = line.slice(i, j);
        const open = line[j];
        const close = open ? SIMPLE[open] : undefined;
        if (close) {
          const next = line[j + 1] || '';
          const exotic = EXOTIC_NEXT[open].includes(next);
          if (!exotic) {
            let depth = 1;
            let k = j + 1;
            while (k < n) {
              if (line[k] === open) depth++;
              else if (line[k] === close) {
                depth--;
                if (depth === 0) break;
              }
              k++;
            }
            if (depth === 0) {
              const inner = line.slice(j + 1, k);
              const trimmed = inner.trim();
              const alreadyQuoted =
                trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
              if (!alreadyQuoted && SPECIAL.test(inner)) {
                out += id + open + '"' + inner.replace(/"/g, '#quot;') + '"' + close;
              } else {
                out += line.slice(i, k + 1);
              }
              i = k + 1;
              continue;
            }
          }
        }
        out += id;
        i = j;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  };

  return source.split('\n').map(repairLine).join('\n');
}
