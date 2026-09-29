/** Shared Be UI-style line surface; syntax is escaped by code-highlight.ts. */
export function CodeBlockSource({
  lines,
  highlighted,
  language,
  focusedLines,
}: {
  lines: readonly string[];
  highlighted?: readonly string[];
  language: string;
  focusedLines?: ReadonlySet<number>;
}) {
  return (
    <pre className="shell-agent-code__source">
      <code className={'hljs language-' + language}>
        {lines.map((line, index) => (
          <span
            className="shell-agent-code__line"
            data-code-line={index + 1}
            data-line={index + 1}
            data-highlighted={focusedLines?.has(index + 1) ? 'true' : undefined}
            key={index}
          >
            <span className="shell-agent-code__number" aria-hidden="true">
              {index + 1}
            </span>
            {highlighted ? (
              <span
                className="shell-agent-code__text"
                dangerouslySetInnerHTML={{ __html: highlighted[index] || ' ' }}
              />
            ) : (
              <span className="shell-agent-code__text">{line || ' '}</span>
            )}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}
