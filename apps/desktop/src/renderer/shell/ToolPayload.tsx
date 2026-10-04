import { normalizeToolName, parseDeferredContent } from '@sync-think/shared';
import { CodeBlock } from './CodeBlock.js';
import { CopyTextButton } from './CopyTextButton.js';
import { DeferredToolContent } from './DeferredToolContent.js';

function structuredFields(text: string): ReadonlyArray<readonly [string, unknown]> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries;
  } catch {
    return undefined;
  }
}

function structuredValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 卡内顶条的说明文字。详情区左侧已经有「参数/输出」标签，这里再写一遍语言名是噪声，
 * 换成「类型 · 规模」，让这一行提供块外没有的信息。
 */
function describePayload(text: string, language: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
  return `${language === 'json' ? 'JSON' : '文本'} · ${lines} 行`;
}

const SEARCH_PARAMETER_HINTS: Readonly<Record<string, string>> = {
  caseInsensitive: '是否忽略大小写：false 区分大小写，true 不区分大小写。',
  contextLines: '每条匹配行前后各展示的上下文行数（0–5）。',
  globExclude: '排除的文件路径模式；未设置表示没有额外排除规则。',
  globInclude: '只搜索匹配此路径模式的文件；package.json 匹配搜索目录根部，**/package.json 匹配各级目录。',
  maxResults: '最多返回的匹配行数，并非文件数。',
  path: '相对项目的搜索目录；未设置表示项目根目录。',
  pattern: '要在文件内容中匹配的 JavaScript 正则表达式。',
};

interface ToolPayloadProps {
  text: string;
  toolName?: string;
  testId?: string;
  failed?: boolean;
  streaming?: boolean;
  label?: string;
  deferred?: import('@sync-think/shared').DeferredContent;
}

export function ToolPayload(props: ToolPayloadProps) {
  const contentReference = parseDeferredContent(props.deferred);
  if (contentReference) {
    return (
      <DeferredToolContent
        deferred={contentReference}
        preview={props.text}
        label={props.label ?? '输出'}
        streaming={props.streaming}
        failed={props.failed}
        testId={props.testId}
        wrapControl
        renderContent={text => <ToolPayloadContent {...props} text={text} testId={undefined} />}
      />
    );
  }
  return <ToolPayloadContent {...props} />;
}

/** Every tool uses the same full parameter view, including deferred command arguments. */
function ToolPayloadContent({
  text,
  testId,
  failed = false,
  streaming = false,
  label = '输出',
  toolName,
}: ToolPayloadProps) {
  const fields = structuredFields(text);
  if (!fields) {
    const language = ['{', '['].includes(text.trimStart().charAt(0)) ? 'json' : 'text';
    return (
      <div className={`shell-tool-result${failed ? ' is-failed' : ''}`} data-testid={testId}>
        <CodeBlock
          code={text}
          language={language}
          streaming={streaming}
          copyLabel={`复制${label}`}
          collapsible={false}
          maxHeight={240}
          showStatus={false}
          wrapControl
          identity={
            <span className="shell-tool-result__label">{describePayload(text, language)}</span>
          }
        />
      </div>
    );
  }
  return (
    <div className={`shell-tool-result${failed ? ' is-failed' : ''}`} data-testid={testId}>
      <div className="shell-tool-result__bar">
        <span className="shell-tool-result__label">
          {fields.length === 0 ? (label === '参数' ? '无参数（空 JSON 对象）' : '空 JSON 对象') : `JSON 对象 · ${fields.length} 个字段`}
        </span>
        <CopyTextButton text={text} label={`复制${label}`} />
      </div>
      {fields.length > 0 ? <dl className={`shell-inline-process__structured${failed ? ' is-failed' : ''}`}>
        {fields.map(([key, value]) => {
          const nested = value !== null && typeof value === 'object';
          const hint = normalizeToolName(toolName ?? '') === 'search_files' ? SEARCH_PARAMETER_HINTS[key] : undefined;
          return (
            <div className="shell-inline-process__structured-row" key={key}>
              <dt title={hint}>{key}</dt>
              <dd className={nested ? 'is-nested' : undefined}>
                {hint && value === '' ? '（未设置）' : structuredValueText(value)}
              </dd>
            </div>
          );
        })}
      </dl> : null}
    </div>
  );
}

