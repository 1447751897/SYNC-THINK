import { useId, useMemo, useState } from 'react';
import { Check, ChevronDown, CircleAlert, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { ToolApprovalScope } from '@sync-think/protocol';
import type { PendingToolApproval } from './tool-approval-types.js';
export type { PendingToolApproval } from './tool-approval-types.js';
import { persistentComputerUseAppOf } from './tool-approval.js';
import { approvalPresentation } from './tool-approval-presentation.js';
import { skillApprovalTools } from './skill-approval-tools.js';
import { CodeBlock } from './CodeBlock.js';
import { LineDiffView, UnifiedDiffPreview } from './ExecutionProcessBlock.js';
import { languageFromPath } from './code-highlight.js';

export interface ToolApprovalSubmission {
  decision: 'approve' | 'deny';
  scope: ToolApprovalScope;
}

function ApprovalDetails({ preview }: { preview: ReturnType<typeof approvalPresentation> }) {
  return (
    <>
      {preview.command ? (
        <CodeBlock
          code={preview.command.code}
          language={preview.command.language}
          showStatus={false}
          copyLabel="复制命令"
          wrapControl
          maxHeight={200}
          collapsible={false}
        />
      ) : null}
      {preview.changes.map((change, index) => (
        <div className="shell-beui-approval__change" key={change.path + index}>
          <div className="shell-beui-approval__path">
            <span>
              {change.kind === 'delete'
                ? '拟删除文件'
                : change.kind === 'add'
                  ? '拟创建文件'
                  : '拟编辑文件'}
            </span>
            <code>{change.path}</code>
          </div>
          {change.diff ? (
            <div className="shell-beui-approval__diff">
              <UnifiedDiffPreview text={change.diff} path={change.path} />
            </div>
          ) : change.content ? (
            <CodeBlock
              code={change.content}
              language={languageFromPath(change.path)}
              showStatus={false}
              maxHeight={200}
              wrapControl
            />
          ) : (
            <p className="shell-beui-approval__empty">此请求未附带文件差异。</p>
          )}
        </div>
      ))}
      {preview.diff ? (
        <div className="shell-beui-approval__diff">
          <UnifiedDiffPreview text={preview.diff} path={preview.path} />
        </div>
      ) : preview.replacement ? (
        <div className="shell-beui-approval__replacement">
          <span className="shell-beui-approval__caption">拟替换片段</span>
          <LineDiffView
            oldText={preview.before}
            newText={preview.after}
            path={preview.path}
            wrapLines
            showLineNumbers={false}
          />
        </div>
      ) : preview.content && !preview.command ? (
        <CodeBlock
          code={preview.content}
          language={languageFromPath(preview.path ?? '')}
          showStatus={false}
          copyLabel="复制拟写入内容"
          wrapControl
          maxHeight={200}
        />
      ) : null}
      {preview.parameters.length ? (
        <dl className="shell-beui-approval__parameters">
          {preview.parameters.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

/** Be UI Tool Approval, adapted to Runtime-owned scopes and decision acknowledgements. */
export function ToolApprovalCard({
  approval,
  busy,
  submission,
  error,
  pendingCount = 1,
  onApprove,
  onDeny,
}: {
  approval: PendingToolApproval;
  busy?: boolean;
  submission?: ToolApprovalSubmission;
  error?: string;
  pendingCount?: number;
  onApprove(scope: ToolApprovalScope, excludedSkillTools?: string[]): void;
  onDeny(): void;
}) {
  // Key the stateful surface by request so details from one approval cannot leak to the next.
  return (
    <ApprovalSurface
      key={approval.approvalId}
      approval={approval}
      busy={busy}
      submission={submission}
      error={error}
      pendingCount={pendingCount}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}

function ApprovalSurface({
  approval,
  busy,
  submission,
  error,
  pendingCount,
  onApprove,
  onDeny,
}: Parameters<typeof ToolApprovalCard>[0]) {
  const [excludedSkillTools, setExcludedSkillTools] = useState<string[]>([]);
  const declaredTools = useMemo(() => skillApprovalTools(approval), [approval]);
  const preview = useMemo(() => approvalPresentation(declaredTools ? {
    ...approval, detail: approval.detail.replace(/工具声明：[\s\S]*?(?= · |$)/, '').replace(/ ·\s* · /g, ' · '),
  } : approval), [approval, declaredTools]);
  const [open, setOpen] = useState(false);
  const [mountedDetails, setMountedDetails] = useState(false);
  const detailsId = useId();
  const titleId = useId();
  const errorId = useId();
  const persistentApp = persistentComputerUseAppOf(approval.toolName, approval.arguments);
  const scopes = declaredTools !== undefined ? ['once' as ToolApprovalScope] :
    approval.allowedScopes ?? (persistentApp ? ['once', 'always-app'] : ['once', 'session']);
  const decided = approval.decided;
  const pending = !decided;
  const state = busy
    ? 'submitting'
    : decided === 'approve'
      ? 'approved'
      : decided === 'deny'
        ? 'denied'
        : error
          ? 'error'
          : 'pending';
  const Icon = busy
    ? LoaderCircle
    : decided === 'approve'
      ? Check
      : decided === 'deny'
        ? X
        : error
          ? CircleAlert
          : ShieldCheck;
  const status = busy
    ? submission?.decision === 'deny'
      ? '正在提交拒绝'
      : '正在提交批准'
    : decided === 'approve'
      ? '已批准'
      : decided === 'deny'
        ? '已拒绝'
        : error
          ? '提交失败'
          : '等待批准';
  return (
    <section
      className="shell-composer-tool-approval shell-beui-approval"
      aria-labelledby={titleId}
      aria-busy={Boolean(busy)}
      data-testid={'tool-approval-' + approval.approvalId}
      data-tool={approval.toolName}
      data-state={state}
      data-persistent-app={persistentApp?.value}
    >
      <div className="shell-beui-approval__body">
        <div className="shell-beui-approval__header">
          <span className="shell-beui-approval__icon" aria-hidden="true">
            <Icon size={17} className={busy ? 'shell-beui-approval__spinner' : undefined} />
          </span>
          <div className="shell-beui-approval__copy">
            <div className="shell-beui-approval__heading">
              <h3 id={titleId}>{preview.title}</h3>
              <span className="shell-beui-approval__status" role="status" aria-live="polite">
                {status}
              </span>
            </div>
            {preview.toolLabel || (pendingCount && pendingCount > 1) ? (
              <div className="shell-beui-approval__tool">
                {preview.toolLabel ? <span>{preview.toolLabel}</span> : null}
                {pendingCount && pendingCount > 1 ? (
                  <span>另有 {pendingCount - 1} 项待处理</span>
                ) : null}
              </div>
            ) : null}
            {preview.description ? (
              <p className="shell-beui-approval__description">{preview.description}</p>
            ) : null}
            {declaredTools !== undefined && <div className="shell-beui-approval__declarations" aria-label="Skill 工具声明">
              <span className="shell-beui-approval__caption">工具声明</span>
              <div className="shell-beui-approval__tool-chips">{declaredTools.filter(name => !excludedSkillTools.includes(name)).map(name => <span className="shell-beui-approval__tool-chip" key={name}><code>{name}</code><button type="button" aria-label={'移除工具声明 ' + name} title={'移除 ' + name} disabled={busy || !pending} onClick={() => setExcludedSkillTools(items => [...items, name])}><X size={11} aria-hidden="true" /></button></span>)}
                {declaredTools.every(name => excludedSkillTools.includes(name)) && <span className="shell-beui-approval__empty">未声明工具</span>}
              </div>
              {excludedSkillTools.length > 0 && <small>批准后按剩余声明登记；应用权限保持不变。<button type="button" className="shell-beui-approval__reset-tools" disabled={busy || !pending} onClick={() => setExcludedSkillTools([])}>恢复声明</button></small>}
            </div>}
            {preview.targets.length || preview.reason ? (
              <dl className="shell-beui-approval__summary">
                {preview.targets.map(({ label, value }) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                {preview.reason ? (
                  <div>
                    <dt>申请原因</dt>
                    <dd>{preview.reason}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
        </div>
        <div
          id={detailsId}
          className="shell-beui-approval__disclosure-body"
          data-open={open}
          aria-hidden={!open}
          {...(!open ? { inert: '' } : {})}
        >
          <div>
            {mountedDetails ? (
              <div className="shell-beui-approval__details">
                <ApprovalDetails preview={preview} />
              </div>
            ) : null}
          </div>
        </div>
        {error && pending ? (
          <p id={errorId} className="shell-beui-approval__error" role="alert">
            <CircleAlert size={13} aria-hidden="true" />
            <span>{error} 请重试。</span>
          </p>
        ) : null}
      </div>
      {preview.hasDetails || pending ? (
        <footer className="shell-beui-approval__footer">
          {preview.hasDetails ? (
            <button
              type="button"
              className="shell-beui-approval__disclosure"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => {
                setMountedDetails(true);
                setOpen(!open);
              }}
            >
              {open ? '收起' : '查看'}
              {preview.detailLabel}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          ) : null}
          {pending ? (
            <div
              className="shell-beui-approval__actions"
              aria-describedby={error ? errorId : undefined}
            >
              <button
                type="button"
                className="shell-beui-approval__button is-deny"
                disabled={busy}
                onClick={onDeny}
              >
                {busy && submission?.decision === 'deny' ? '提交中…' : '拒绝'}
              </button>
              {scopes.includes('session') && !persistentApp ? (
                <button
                  title="当前会话后续使用同一种工具时沿用此授权"
                  type="button"
                  className="shell-beui-approval__button"
                  disabled={busy}
                  onClick={() => onApprove('session')}
                >
                  {busy && submission?.decision === 'approve' && submission.scope === 'session'
                    ? '提交中…'
                    : '本会话允许此工具'}
                </button>
              ) : null}
              {scopes.includes('always-app') && persistentApp ? (
                <button
                  type="button"
                  className="shell-beui-approval__button"
                  disabled={busy}
                  onClick={() => onApprove('always-app')}
                >
                  {busy && submission?.decision === 'approve' && submission.scope === 'always-app'
                    ? '提交中…'
                    : '始终允许此应用'}
                </button>
              ) : null}
              {scopes.includes('once') ? (
                <button
                  type="button"
                  className="shell-beui-approval__button is-primary"
                  disabled={busy}
                  onClick={() => excludedSkillTools.length ? onApprove('once', excludedSkillTools) : onApprove('once')}
                >
                  {busy && submission?.decision === 'approve' && submission.scope === 'once'
                    ? '提交中…'
                    : '仅本次允许'}
                </button>
              ) : null}
            </div>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
