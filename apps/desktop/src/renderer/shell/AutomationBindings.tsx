import { TaskSelect } from './TaskSelect.js';
import { loadMcpCatalog } from './mcp-catalog-loader.js';
import { ProfileCreateDialog } from './ProfileCreateDialog.js';
import { useCallback, useEffect, useState } from 'react';
import { parseAutomationAcceptanceChecks, type ScheduledTaskAutomation } from '@sync-think/shared';
import type {
  BrowserProfileSummary,
  BrowserAutomationTaskSummary,
  McpServerSummary,
  McpToolSchemaSummary,
} from '@sync-think/protocol';

/** Shared wire-validated automation binding. */
export type AutomationBinding = ScheduledTaskAutomation;
type AcceptanceChecks = NonNullable<AutomationBinding['acceptanceChecks']>;
const SPREADSHEET_CHECK_KEYS = [
  'minimumRows',
  'requiredColumns',
  'dateColumn',
  'sourceUrlColumn',
] as const;
function optionalChecks(checks: AcceptanceChecks): AcceptanceChecks | undefined {
  const result = { ...checks };
  for (const key of [...SPREADSHEET_CHECK_KEYS, 'minimumSlides'] as const) {
    if (result[key] === undefined) delete result[key];
  }
  return Object.keys(result).length ? result : undefined;
}
function checkText(value: AcceptanceChecks[keyof AcceptanceChecks]): string {
  return Array.isArray(value) ? value.join(', ') : (value?.toString() ?? '');
}
/** Keep raw editing text (including an unfinished comma/count) out of the persisted contract. */
function AcceptanceCheckInput({
  label,
  value,
  numeric,
  onChange,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  onChange(text: string): string;
}) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode={numeric ? 'numeric' : undefined}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          setLastValue(onChange(text));
        }}
      />
    </label>
  );
}
export const AUTOMATION_PERMISSION_LABELS = {
  ask: '逐次确认',
  workspace: '工作区访问',
  'full-access': '完整访问',
} as const;
export function automationExecutionMode(binding: AutomationBinding | undefined) {
  return binding?.executionMode ?? 'workspace';
}

export interface AutomationResources {
  profiles: BrowserProfileSummary[];
  workflows: BrowserAutomationTaskSummary[];
  servers: McpServerSummary[];
  loading: boolean;
  errors: Partial<Record<'profiles' | 'workflows' | 'servers', string>>;
}

const EMPTY: AutomationResources = {
  profiles: [],
  workflows: [],
  servers: [],
  loading: true,
  errors: {},
};

/** Registry data is configuration evidence, never proof of login or successful execution. */
export function useAutomationResources() {
  const [resources, setResources] = useState<AutomationResources>(EMPTY);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    const api = window.syncThink?.runtime;
    setResources(EMPTY);
    void Promise.allSettled([
      api?.listBrowserProfiles
        ? api.listBrowserProfiles({})
        : Promise.reject(new Error('Profile 服务待连接')),
      api?.browserWorkflow?.list
        ? api.browserWorkflow.list({})
        : Promise.reject(new Error('浏览器流程服务待连接')),
      api?.listMcpServers ? loadMcpCatalog(api, { refresh: true }) : Promise.reject(new Error('MCP 服务待连接')),
    ]).then(([profiles, workflows, servers]) => {
      if (cancelled) return;
      const errors: AutomationResources['errors'] = {};
      const message = (reason: unknown) =>
        reason instanceof Error ? reason.message : String(reason);
      if (profiles.status === 'rejected') errors.profiles = message(profiles.reason);
      if (workflows.status === 'rejected') errors.workflows = message(workflows.reason);
      if (servers.status === 'rejected') errors.servers = message(servers.reason);
      setResources({
        profiles: profiles.status === 'fulfilled' ? profiles.value.profiles : [],
        workflows: workflows.status === 'fulfilled' ? workflows.value.tasks : [],
        servers: servers.status === 'fulfilled' ? servers.value.servers : [],
        loading: false,
        errors,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return { resources, reload };
}

export function isGmailServer(server: McpServerSummary): boolean {
  return /gmail/i.test(
    [
      server.name,
      server.endpoint,
      ...server.tools.map((tool) => `${tool.name} ${tool.description}`),
    ].join(' '),
  );
}

const DIRECT_RECIPIENT_KEYS = ['to', 'recipient', 'recipients', 'to_email', 'toEmail'] as const;
const CONNECTOR_HINT = '请先配置支持直属收件人 payload 的适用 connector。';
function schemaRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Configuration-only check of the same top-level recipient fields bound by the host. */
export function gmailToolFormatIssue(tool: McpToolSchemaSummary): string | null {
  if (tool.readOnly) return '该工具声明为只读；' + CONNECTOR_HINT;
  let schema: unknown;
  try {
    schema = JSON.parse(tool.inputSchemaJson ?? '');
  } catch {
    return '发件工具参数格式尚未验证；' + CONNECTOR_HINT;
  }
  if (
    !schemaRecord(schema) ||
    !schemaRecord(schema.properties) ||
    (schema.type !== undefined && schema.type !== 'object')
  ) {
    return '发件工具参数格式不是直属收件人 payload；' + CONNECTOR_HINT;
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((key) => typeof key === 'string' && /^(draft_?id|raw|cc|bcc)$/i.test(key))) {
    return '发件工具需要 draftId、raw 或额外收件参数；' + CONNECTOR_HINT;
  }
  const properties = schema.properties;
  const recipientFields = DIRECT_RECIPIENT_KEYS.filter((key) => Object.hasOwn(properties, key));
  if (!recipientFields.length) {
    const draftOnly = Object.keys(schema.properties).some((key) => /^draft_?id$/i.test(key));
    return (
      (draftOnly
        ? '发件工具仅接受 draftId，而非直属收件人 payload；'
        : '发件工具参数格式没有直属收件字段；') + CONNECTOR_HINT
    );
  }
  if (
    !recipientFields.every((key) => {
      const field = properties[key];
      return (
        schemaRecord(field) &&
        (field.type === 'string' ||
          (field.type === 'array' && schemaRecord(field.items) && field.items.type === 'string'))
      );
    })
  )
    return '发件工具收件字段格式需要适配；' + CONNECTOR_HINT;
  return null;
}

/** Only real registered tools are offered; names/descriptions are hints, not send receipts. */
export function gmailSendTools(server: McpServerSummary): McpToolSchemaSummary[] {
  return server.tools.filter(
    (tool) =>
      /send|发送|发信/i.test(tool.name + ' ' + tool.description) ||
      (!tool.readOnly && gmailToolFormatIssue(tool) === null),
  );
}

export function gmailToolBindingIssue(
  server: McpServerSummary | undefined,
  toolName?: string,
): string | null {
  if (!toolName?.trim()) return 'Gmail 发件工具待明确选择';
  if (!server) return 'Gmail 连接器待配置';
  const tool = gmailSendTools(server).find((item) => item.name === toolName);
  if (!tool) return 'Gmail 已选发件工具未在该服务的真实工具列表中；' + CONNECTOR_HINT;
  const formatIssue = gmailToolFormatIssue(tool);
  return formatIssue ? 'Gmail ' + formatIssue : null;
}

export function automationIssues(
  binding: ScheduledTaskAutomation | undefined,
  resources: AutomationResources,
  workspaceId?: string,
): string[] {
  if (!binding) return [];
  const issues: string[] = [];
  if (binding.browser) {
    const profile = resources.profiles.find((item) => item.id === binding.browser?.profileId);
    const workflow = resources.workflows.find(
      (item) => item.id === binding.browser?.workflowTaskId,
    );
    if (!profile) issues.push('浏览器 Profile 待配置');
    if (binding.browser.workflowTaskId && !workflow?.publishedVersionId)
      issues.push('已发布浏览器流程待配置');
    else if (binding.browser.workflowTaskId && workflow) {
      if (workflow.status !== 'enabled') issues.push('浏览器流程待启用');
      if (workflow.profileId !== binding.browser.profileId) issues.push('流程与 Profile 不匹配');
      if (workflow.workspaceId && workflow.workspaceId !== workspaceId)
        issues.push('流程工作区与任务不匹配');
    }
  }
  const ids = new Set(binding.requiredMcpServerIds ?? []);
  if (binding.delivery) ids.add(binding.delivery.mcpServerId);
  for (const id of ids) {
    const server = resources.servers.find((item) => item.mcpServerId === id);
    if (!server) issues.push(`MCP ${id} 待配置`);
    else if (!server.enabled || !server.trusted) issues.push(`MCP ${server.name} 待启用或信任`);
    else if (!server.tools.length) issues.push(`MCP ${server.name} 工具待发现`);
  }
  if (binding.delivery) {
    const server = resources.servers.find(
      (item) => item.mcpServerId === binding.delivery?.mcpServerId,
    );
    const toolIssue = gmailToolBindingIssue(server, binding.delivery.toolName);
    if (toolIssue) issues.push(toolIssue);
    if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(binding.delivery.recipient.trim()))
      issues.push('Gmail 收件人待配置');
  }
  return issues;
}

export function automationFormError(
  binding: AutomationBinding | undefined,
  resources?: AutomationResources,
): string | null {
  const checks = binding?.acceptanceChecks;
  if (checks) {
    if (
      SPREADSHEET_CHECK_KEYS.some((key) => checks[key] !== undefined) &&
      !binding.outputs?.includes('spreadsheet')
    ) {
      return '表格检查须启用表格输出，或清除结构化验收';
    }
    if (checks.minimumSlides !== undefined && !binding.outputs?.includes('presentation')) {
      return 'PPT 检查须启用演示文稿输出，或清除结构化验收';
    }
    if (
      checks.requiredColumns &&
      (!checks.requiredColumns.length || checks.requiredColumns.some((column) => !column.trim()))
    ) {
      return '必需列须填写非空列名，以逗号分隔，或清空该项';
    }
    for (const [key, label] of [
      ['minimumRows', '表格最少数据行数'],
      ['minimumSlides', 'PPT 最少页数'],
    ] as const) {
      const count = checks[key];
      if (count !== undefined && (!Number.isSafeInteger(count) || count <= 0)) {
        return label + '须为正整数，或清空该项';
      }
    }
    if (!parseAutomationAcceptanceChecks(checks))
      return '结构化验收格式待修正：行数 1–10000、页数 1–100，列名须非空且不重复（最多 128 列）；也可清除检查';
  }
  const variables = binding?.browser?.variables;
  if (
    variables &&
    (Object.keys(variables).length > 50 ||
      Object.entries(variables).some(
        ([key, value]) =>
          !key.trim() || /password|cookie|token|secret/i.test(key) || value.length > 4000,
      ))
  ) {
    return '流程变量最多 50 项；键名应为非敏感输入，每项内容最多 4000 字符';
  }
  if (
    binding?.delivery &&
    (!binding.delivery.mcpServerId ||
      !binding.delivery.toolName?.trim() ||
      !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(binding.delivery.recipient.trim()))
  ) {
    return '请为 Gmail 交付选择 MCP、明确发件工具并填写有效收件人，或取消 Gmail 交付后保存草稿';
  }
  if (binding?.delivery && resources) {
    if (resources.loading) return 'Gmail 工具配置加载中，请加载完成后保存';
    const server = resources.servers.find(
      (item) => item.mcpServerId === binding.delivery?.mcpServerId,
    );
    const issue = gmailToolBindingIssue(server, binding.delivery.toolName);
    if (issue) return issue;
  }
  return null;
}

function toggle<T>(values: readonly T[] | undefined, value: T): T[] {
  return values?.includes(value)
    ? values.filter((item) => item !== value)
    : [...(values ?? []), value];
}

export function AutomationBindings({
  value,
  onChange,
  resources,
  onReload,
  workspaceId,
  disabled,
  page = 'all',
}: {
  value: AutomationBinding | undefined;
  onChange(value: AutomationBinding): void;
  resources: AutomationResources;
  onReload(): void;
  workspaceId?: string;
  disabled?: boolean;
  page?: 'all' | 'capabilities' | 'review' | 'hidden';
}) {
  const binding: AutomationBinding = value ?? {};
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [createdProfile, setCreatedProfile] = useState<BrowserProfileSummary>();
  const profiles =
    createdProfile && !resources.profiles.some((profile) => profile.id === createdProfile.id)
      ? [...resources.profiles, createdProfile]
      : resources.profiles;
  function setCheck<K extends keyof AcceptanceChecks>(key: K, value: AcceptanceChecks[K]) {
    onChange({
      ...binding,
      acceptanceChecks: optionalChecks({ ...binding.acceptanceChecks, [key]: value }),
    });
    return checkText(value);
  }
  const countCheck = (key: 'minimumRows' | 'minimumSlides', text: string) =>
    setCheck(
      key,
      text.trim() ? (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN) : undefined,
    );
  const workflows = resources.workflows.filter(
    (item) =>
      item.publishedVersionId &&
      item.status === 'enabled' &&
      item.profileId === binding.browser?.profileId &&
      (!item.workspaceId || item.workspaceId === workspaceId),
  );
  const gmailServers = resources.servers.filter(isGmailServer);
  const deliveryServer = gmailServers.find(
    (server) => server.mcpServerId === binding.delivery?.mcpServerId,
  );
  const deliveryTools = deliveryServer ? gmailSendTools(deliveryServer) : [];
  const selectedDeliveryTool = deliveryTools.find(
    (tool) => tool.name === binding.delivery?.toolName,
  );
  const variableRows = Object.entries(binding.browser?.variables ?? {});
  const issues = automationIssues(value, resources, workspaceId);
  return (
    <section
      className="automation-bindings"
      hidden={page === 'hidden'}
      aria-labelledby="automation-bindings-title"
    >
      <header>
        <h3 id="automation-bindings-title">{page === 'review' ? '验收与权限' : '自动化能力绑定'}</h3>
        <button type="button" onClick={onReload} disabled={resources.loading || disabled}>
          刷新配置
        </button>
      </header>
      <p>执行者根据目标动态使用所需能力。网页操作流程可选，步骤回放不等于任务验收通过。</p>
      {resources.loading ? <p role="status">正在加载 Profile、已发布流程与 MCP…</p> : null}
      {Object.entries(resources.errors).map(([key, error]) => (
        <p role="alert" key={key}>
          {error} · 待配置
        </p>
      ))}
      <fieldset hidden={page === 'capabilities'} disabled={disabled}>
        <legend>本任务执行权限</legend>
        <label>
          执行权限
          <TaskSelect
            aria-label="执行权限"
            value={automationExecutionMode(binding)}
            aria-describedby="automation-permission-hint"
            onChange={(event) => {
              const mode = event.target.value;
              if (mode === 'ask' || mode === 'workspace' || mode === 'full-access')
                onChange({ ...binding, executionMode: mode });
            }}
          >
            <option value="ask">逐次确认</option>
            <option value="workspace">工作区访问（默认）</option>
            <option value="full-access">完整访问</option>
          </TaskSelect>
        </label>
        <small id="automation-permission-hint">
          {automationExecutionMode(binding) === 'ask'
            ? '需要审批的操作逐次确认；无人值守执行可能停在待审批状态。'
            : automationExecutionMode(binding) === 'full-access'
              ? '完整访问仅指用户对本任务放行的文件和网页；网站审批仅限流程已声明站点，不是全局放开。'
              : '默认在绑定工作区内执行；额外文件与网站访问仍遵循本任务审批范围。'}{' '}
          权限仅用于本任务，不修改智能体或全局设置。
          {binding.delivery ? ' Gmail 仍仅使用指定连接器、向指定收件人交付。' : null}
        </small>
      </fieldset>
      <fieldset hidden={page === 'review'} disabled={disabled || resources.loading}>
        <legend>采集 · 浏览器</legend>
        <label>
          浏览器 Profile
          <TaskSelect
            aria-label="浏览器 Profile"
            value={binding.browser?.profileId ?? ''}
            onChange={(event) =>
              onChange({
                ...binding,
                browser: event.target.value ? { profileId: event.target.value } : undefined,
              })
            }
          >
            <option value="">不绑定浏览器</option>
            {binding.browser && !profiles.some((item) => item.id === binding.browser?.profileId) ? (
              <option value={binding.browser.profileId}>
                {binding.browser.profileId} · 待配置
              </option>
            ) : null}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </TaskSelect>
        </label>
        <button
          type="button"
          className="task-experience-inline"
          onClick={() => setCreatingProfile(true)}
        >
          ＋ 新建 Profile
        </button>
        <label>
          已发布浏览器流程
          <TaskSelect
            disabled={!binding.browser}
            aria-label="已发布浏览器流程"
            value={binding.browser?.workflowTaskId ?? ''}
            onChange={(event) => {
              if (binding.browser)
                onChange({
                  ...binding,
                  browser: {
                    profileId: binding.browser.profileId,
                    workflowTaskId: event.target.value || undefined,
                  },
                });
            }}
          >
            <option value="">不绑定，按目标动态执行</option>
            {binding.browser?.workflowTaskId &&
            !workflows.some((item) => item.id === binding.browser?.workflowTaskId) ? (
              <option value={binding.browser.workflowTaskId}>
                {binding.browser.workflowTaskId} · 待配置
              </option>
            ) : null}
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </TaskSelect>
        </label>
        <small>
          录制、审核、发布流程仍在浏览器工作台完成；这里仅绑定已有发布版本。Profile
          登录状态以实际执行为准。
        </small>
        {binding.browser?.workflowTaskId ? (
          <div className="automation-bindings__variables">
            <span>流程变量（仅非敏感输入）</span>
            {variableRows.map(([key, text], index) => (
              <div className="automation-bindings__variable" key={index}>
                <input
                  aria-label={`变量 ${index + 1} 名称`}
                  value={key}
                  onChange={(event) => {
                    if (!binding.browser) return;
                    const entries = [...variableRows];
                    entries[index] = [event.target.value, text];
                    onChange({
                      ...binding,
                      browser: { ...binding.browser, variables: Object.fromEntries(entries) },
                    });
                  }}
                />
                <input
                  aria-label={`变量 ${index + 1} 值`}
                  value={text}
                  onChange={(event) => {
                    if (binding.browser)
                      onChange({
                        ...binding,
                        browser: {
                          ...binding.browser,
                          variables: { ...binding.browser.variables, [key]: event.target.value },
                        },
                      });
                  }}
                />
                <button
                  type="button"
                  aria-label={`删除变量 ${index + 1}`}
                  onClick={() => {
                    if (binding.browser)
                      onChange({
                        ...binding,
                        browser: {
                          ...binding.browser,
                          variables: Object.fromEntries(
                            variableRows.filter((_, row) => row !== index),
                          ),
                        },
                      });
                  }}
                >
                  移除
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                if (!binding.browser) return;
                let index = variableRows.length + 1;
                while (binding.browser.variables?.[`input${index}`] !== undefined) index++;
                onChange({
                  ...binding,
                  browser: {
                    ...binding.browser,
                    variables: { ...binding.browser.variables, [`input${index}`]: '' },
                  },
                });
              }}
            >
              添加流程变量
            </button>
          </div>
        ) : null}
      </fieldset>
      <fieldset hidden={page === 'review'} disabled={disabled || resources.loading}>
        <legend>整理 · MCP 能力</legend>
        {!resources.servers.length ? (
          <small>MCP 列表为空或尚未连接，请在能力设置中配置。</small>
        ) : null}
        {resources.servers.map((server) => (
          <label className="automation-bindings__check" key={server.mcpServerId}>
            <input
              type="checkbox"
              checked={binding.requiredMcpServerIds?.includes(server.mcpServerId) ?? false}
              onChange={() =>
                onChange({
                  ...binding,
                  requiredMcpServerIds: toggle(binding.requiredMcpServerIds, server.mcpServerId),
                })
              }
            />
            {server.name}
            <small>
              {server.enabled && server.trusted && server.tools.length ? '已登记工具' : '待配置'}
            </small>
          </label>
        ))}
        {(binding.requiredMcpServerIds ?? [])
          .filter((id) => !resources.servers.some((server) => server.mcpServerId === id))
          .map((id) => (
            <label className="automation-bindings__check" key={id}>
              <input
                type="checkbox"
                checked
                onChange={() =>
                  onChange({
                    ...binding,
                    requiredMcpServerIds: toggle(binding.requiredMcpServerIds, id),
                  })
                }
              />
              {id} · 待配置
            </label>
          ))}
      </fieldset>
      <fieldset hidden={page === 'review'} disabled={disabled}>
        <legend>产物 · 可选格式要求</legend>
        {(['spreadsheet', 'presentation'] as const).map((output) => (
          <label className="automation-bindings__check" key={output}>
            <input
              type="checkbox"
              checked={binding.outputs?.includes(output) ?? false}
              onChange={() => {
                const outputs = toggle(binding.outputs, output);
                const checks = { ...binding.acceptanceChecks };
                if (!outputs.includes('spreadsheet')) {
                  for (const key of SPREADSHEET_CHECK_KEYS) delete checks[key];
                }
                if (!outputs.includes('presentation')) delete checks.minimumSlides;
                onChange({ ...binding, outputs, acceptanceChecks: optionalChecks(checks) });
              }}
            />
            {output === 'spreadsheet' ? '表格' : '演示文稿 / PPT'}
          </label>
        ))}
        <small>结果形式默认由任务目标决定。仅在本任务确实需要时选择指定格式；未勾选不会限制产物类型。</small>
      </fieldset>
      <div className="automation-bindings__acceptance" hidden={page === 'capabilities'}>
        <label>
          执行验收说明
          <textarea
            rows={4}
            value={binding.acceptance ?? ''}
            placeholder="描述任务做到什么程度才算完成；结果形式和交付方式按实际需要填写"
            disabled={disabled}
            onChange={(event) => onChange({ ...binding, acceptance: event.target.value })}
          />
        </label>
        <small>验收以任务目标为准，不限定文件格式，也不要求外部发送。</small>
        <small>自然语言说明不属于结构化硬检查；实际产物与交付结果以执行记录为准。</small>
      </div>
      <fieldset
        hidden={page === 'capabilities' || (!binding.outputs?.length && !binding.acceptanceChecks)}
        disabled={disabled}
      >
        <legend>可选 · 文件格式与数据检查</legend>
        {!binding.outputs?.length && (
          <small>仅为已选产物格式配置额外检查；通用验收无需选择表格或 PPT。</small>
        )}
        {binding.outputs?.length ? <p>结构化验收 · 可选，留空不设检查</p> : null}
        {binding.acceptanceChecks ? (
          <button
            type="button"
            onClick={() => onChange({ ...binding, acceptanceChecks: undefined })}
          >
            清除结构化验收
          </button>
        ) : null}
        {binding.outputs?.includes('spreadsheet') ? (
          <div className="automation-bindings__variables">
            <div className="automation-bindings__variable">
              <AcceptanceCheckInput
                label="表格最少数据行数"
                numeric
                value={checkText(binding.acceptanceChecks?.minimumRows)}
                onChange={(text) => countCheck('minimumRows', text)}
              />
              <AcceptanceCheckInput
                label="必需列（逗号分隔）"
                value={checkText(binding.acceptanceChecks?.requiredColumns)}
                onChange={(text) =>
                  setCheck(
                    'requiredColumns',
                    text.trim() ? text.split(/[,，]/).map((column) => column.trim()) : undefined,
                  )
                }
              />
            </div>
            <div className="automation-bindings__variable">
              <AcceptanceCheckInput
                label="日期列（按本轮本地日期核对）"
                value={checkText(binding.acceptanceChecks?.dateColumn)}
                onChange={(text) => setCheck('dateColumn', text.trim() || undefined)}
              />
              <AcceptanceCheckInput
                label="来源 URL 列"
                value={checkText(binding.acceptanceChecks?.sourceUrlColumn)}
                onChange={(text) => setCheck('sourceUrlColumn', text.trim() || undefined)}
              />
            </div>
            <small>
              日期列填列名，核对本轮运行的本地日期，不固定为保存配置当天；来源 URL
              列填列名，不填示例数据。
            </small>
          </div>
        ) : null}
        {binding.outputs?.includes('presentation') ? (
          <AcceptanceCheckInput
            label="PPT 最少页数"
            numeric
            value={checkText(binding.acceptanceChecks?.minimumSlides)}
            onChange={(text) => countCheck('minimumSlides', text)}
          />
        ) : null}
      </fieldset>
      <fieldset hidden={page === 'review'} disabled={disabled}>
        <legend>外部交付 · 可选</legend>
        <small>默认在任务会话查看结果；只有明确需要发邮件时才配置 Gmail。</small>
        <label className="automation-bindings__check">
          <input
            type="checkbox"
            checked={Boolean(binding.delivery)}
            onChange={(event) =>
              onChange({
                ...binding,
                delivery: event.target.checked
                  ? { kind: 'gmail', mcpServerId: '', recipient: '' }
                  : undefined,
              })
            }
          />
          通过 Gmail 交付
        </label>
        {binding.delivery ? (
          <>
            <label>
              Gmail MCP
              <TaskSelect
                disabled={resources.loading}
                value={binding.delivery.mcpServerId}
                onChange={(event) => {
                  if (binding.delivery)
                    onChange({
                      ...binding,
                      delivery: {
                        ...binding.delivery,
                        mcpServerId: event.target.value,
                        toolName: undefined,
                      },
                    });
                }}
              >
                <option value="">请选择 Gmail MCP</option>
                {binding.delivery.mcpServerId &&
                !gmailServers.some(
                  (server) => server.mcpServerId === binding.delivery?.mcpServerId,
                ) ? (
                  <option value={binding.delivery.mcpServerId}>
                    {binding.delivery.mcpServerId} · 待配置
                  </option>
                ) : null}
                {gmailServers.map((server) => (
                  <option key={server.mcpServerId} value={server.mcpServerId}>
                    {server.name}
                  </option>
                ))}
              </TaskSelect>
            </label>
            <label>
              Gmail 发件工具
              <TaskSelect
                value={binding.delivery.toolName ?? ''}
                disabled={resources.loading || !deliveryServer}
                aria-describedby="automation-gmail-tool-hint"
                onChange={(event) => {
                  if (binding.delivery)
                    onChange({
                      ...binding,
                      delivery: { ...binding.delivery, toolName: event.target.value || undefined },
                    });
                }}
              >
                <option value="">请选择真实发件工具</option>
                {binding.delivery.toolName &&
                !deliveryTools.some((tool) => tool.name === binding.delivery?.toolName) ? (
                  <option value={binding.delivery.toolName} disabled>
                    {binding.delivery.toolName} · 待配置
                  </option>
                ) : null}
                {deliveryTools.map((tool) => (
                  <option
                    key={tool.name}
                    value={tool.name}
                    disabled={Boolean(gmailToolFormatIssue(tool))}
                  >
                    {tool.name}
                    {gmailToolFormatIssue(tool) ? ' · 需适用 connector' : ''}
                  </option>
                ))}
              </TaskSelect>
            </label>
            <small id="automation-gmail-tool-hint">
              明确选择本服务的真实发件工具与收件人，用于 host
              本轮受控绑定；这里不验证连接、授权或发送结果。仅接受直属收件人 payload，不通过
              draftId、raw 或嵌套格式推断收件人。
            </small>
            {deliveryServer && !deliveryTools.length ? (
              <small role="status">当前服务没有已登记发件工具。{CONNECTOR_HINT}</small>
            ) : null}
            {deliveryTools
              .filter((tool) => gmailToolFormatIssue(tool))
              .map((tool) => (
                <small role="status" key={tool.name}>
                  {tool.name} · {gmailToolFormatIssue(tool)}
                </small>
              ))}
            {selectedDeliveryTool?.description ? (
              <small>{selectedDeliveryTool.description}</small>
            ) : null}
            <label>
              收件人
              <input
                type="email"
                value={binding.delivery.recipient}
                placeholder="name@example.com"
                onChange={(event) => {
                  if (binding.delivery)
                    onChange({
                      ...binding,
                      delivery: { ...binding.delivery, recipient: event.target.value },
                    });
                }}
              />
            </label>
            <small>已登记 MCP 不代表邮箱已登录。授权与发送结果以实际工具执行为准。</small>
          </>
        ) : null}
      </fieldset>

      {!resources.loading && issues.length ? (
        <div className="automation-bindings__issues" role="status">
          {issues.join('；')}。可保存草稿，完成配置后测试与发布。
        </div>
      ) : null}
      {creatingProfile && (
        <ProfileCreateDialog
          onClose={() => setCreatingProfile(false)}
          onCreated={(profile) => {
            setCreatedProfile(profile);
            onChange({ ...binding, browser: { profileId: profile.id } });
            setCreatingProfile(false);
            onReload();
          }}
        />
      )}
    </section>
  );
}
