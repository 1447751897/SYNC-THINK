import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  Code2,
  Copy,
  CloudDownload,
  Edit3,
  FileCode2,
  Folder,
  Globe2,
  KeyRound,
  Layers3,
  Link2,
  Loader2,
  PackageOpen,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDialog } from '../Dialog.js';
import type {
  CapabilityGovernanceListResponse,
  CapabilityOrganizeReportSummary,
  CapabilityUsageSummary,
  GovernedMcpServerSummary,
  GovernedSkillSummary,
  ImportSkillResponse,
  McpServerSummary,
  SkillPublishDraftSummary,
  SkillVersionSummary,
  WorkspaceSummary,
} from '@sync-think/protocol';
import {
  MCP_CATEGORIES,
  MCP_MARKET,
  SKILL_CATEGORIES,
  SKILL_MARKET,
  type McpMarketItem,
  type SkillMarketItem,
} from './capability-market.js';
import {
  formatDate,
  formatRelativeDate,
  formatTokens,
  groupSkillVersions,
  marketMcpInstalled,
  marketSkillInstalled,
  newSkillTemplate,
  nextPatchVersion,
  replaceSkillFrontmatter,
  skillOriginLabel,
  type SkillFamily,
} from './capability-utils.js';

const MAX_SKILL_MD_CHARS = 512_000;
const CONTEXT_BUDGET_TOKENS = 15_000;

type AbilitySection = 'skills' | 'mcp';
type CatalogTab = 'market' | 'mine';
type StatusFilter = 'all' | 'active' | 'enabled' | 'inactive' | 'unused' | 'problem';
type SourceFilter = 'all' | 'market' | 'local' | 'derived';

type SkillEditorState = {
  mode: 'create' | 'edit';
  skill?: SkillVersionSummary;
  source: string;
};

type McpRegistrationPreset = McpMarketItem | McpServerSummary;

function runtimeBridge() {
  return window.syncThink?.runtime;
}

function skillImportMessage(result: ImportSkillResponse): string {
  return result.deduped
    ? `已存在相同内容：${result.skill.name} v${result.skill.version}`
    : `已保存：${result.skill.name} v${result.skill.version}`;
}

function capabilityErrorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '').trim();
  const cleaned = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^RuntimeResponseError:\s*/i, '')
    .trim();
  return cleaned || fallback;
}

function defaultUsage(
  capabilityType: 'skill' | 'mcp',
  capabilityId: string,
): CapabilityUsageSummary {
  return {
    capabilityType,
    capabilityId,
    callCount: 0,
    successCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    problemCount: 0,
    contextTokens: 0,
  };
}

function fallbackSkillRows(skills: readonly SkillVersionSummary[]): GovernedSkillSummary[] {
  return skills.map((skill) => ({
    skill,
    workspaceActive: false,
    usage: defaultUsage('skill', skill.skillVersionId),
  }));
}

function fallbackMcpRows(servers: readonly McpServerSummary[]): GovernedMcpServerSummary[] {
  return servers.map((server) => ({
    server,
    workspaceActive: false,
    usage: defaultUsage('mcp', server.mcpServerId),
  }));
}

export function AbilitiesPage(props: {
  activeWorkspaceId?: string;
  workspaces?: WorkspaceSummary[];
  onGoToAgents(): void;
  onCatalogChanged?(): void;
}): JSX.Element {
  const dialog = useDialog();
  const workspaces = props.workspaces ?? [];
  const fallbackWorkspaceId =
    props.activeWorkspaceId ?? workspaces[0]?.workspaceId ?? 'default-workspace';
  const [section, setSection] = useState<AbilitySection>('skills');
  const [tab, setTab] = useState<CatalogTab>('market');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(fallbackWorkspaceId);
  const [skills, setSkills] = useState<SkillVersionSummary[]>([]);
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [governance, setGovernance] = useState<CapabilityGovernanceListResponse>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [skillCategory, setSkillCategory] = useState<(typeof SKILL_CATEGORIES)[number]>('全部');
  const [mcpCategory, setMcpCategory] = useState<(typeof MCP_CATEGORIES)[number]>('全部');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [detailSkillVersionId, setDetailSkillVersionId] = useState<string>();
  const [detailMcpServerId, setDetailMcpServerId] = useState<string>();
  const [detailMarketSkillId, setDetailMarketSkillId] = useState<string>();
  const [detailMarketMcpId, setDetailMarketMcpId] = useState<string>();
  const [skillEditor, setSkillEditor] = useState<SkillEditorState>();
  const [remoteSkillImportOpen, setRemoteSkillImportOpen] = useState(false);
  const [registerMcpItem, setRegisterMcpItem] = useState<McpRegistrationPreset | null>();
  const [sourceSkill, setSourceSkill] = useState<SkillVersionSummary>();
  const [publishSkillVersionId, setPublishSkillVersionId] = useState<string>();
  const [organizeReport, setOrganizeReport] = useState<CapabilityOrganizeReportSummary>();
  const [busyId, setBusyId] = useState<string>();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    if (props.activeWorkspaceId) setSelectedWorkspaceId(props.activeWorkspaceId);
  }, [props.activeWorkspaceId]);

  const loadCatalog = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const api = runtimeBridge();
    if (!api?.listSkills || !api.listMcpServers) {
      setLoadError('Runtime bridge 不可用');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      const [skillsResponse, mcpResponse, governanceResponse] = await Promise.all([
        api.listSkills({ limit: 500 }),
        api.listMcpServers({ limit: 100 }),
        api.listCapabilityGovernance
          ? api.listCapabilityGovernance({ workspaceId: selectedWorkspaceId })
          : Promise.resolve(undefined),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setSkills(skillsResponse.skills);
      setServers(mcpResponse.servers);
      setGovernance(governanceResponse);
    } catch (cause) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(capabilityErrorMessage(cause, '能力库加载失败'));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [selectedWorkspaceId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const families = useMemo(() => groupSkillVersions(skills), [skills]);
  const skillGovernanceRows = governance?.skills ?? fallbackSkillRows(skills);
  const mcpGovernanceRows = governance?.mcpServers ?? fallbackMcpRows(servers);
  const skillGovernanceMap = useMemo(
    () => new Map(skillGovernanceRows.map((row) => [row.skill.skillVersionId, row])),
    [skillGovernanceRows],
  );
  const mcpGovernanceMap = useMemo(
    () => new Map(mcpGovernanceRows.map((row) => [row.server.mcpServerId, row])),
    [mcpGovernanceRows],
  );
  const workspaceName =
    workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId)?.name ??
    '当前工作区';

  const selectedSkill = skills.find((skill) => skill.skillVersionId === detailSkillVersionId);
  const selectedServer = servers.find((server) => server.mcpServerId === detailMcpServerId);
  const selectedMarketSkill = SKILL_MARKET.find((item) => item.id === detailMarketSkillId);
  const selectedMarketMcp = MCP_MARKET.find((item) => item.id === detailMarketMcpId);

  const notifyCatalogChanged = useCallback(() => {
    props.onCatalogChanged?.();
  }, [props]);

  const refreshAfterMutation = useCallback(async () => {
    await loadCatalog();
    notifyCatalogChanged();
  }, [loadCatalog, notifyCatalogChanged]);

  const installMarketSkill = useCallback(
    async (item: SkillMarketItem) => {
      const api = runtimeBridge();
      if (!api?.importSkill || busyId) return;
      setBusyId(`market-skill:${item.id}`);
      setError(undefined);
      try {
        const result = item.sourceUrl
          ? await api.importRemoteSkill({
              url: item.sourceUrl,
              originRef: `market://skills/${item.id}`,
            })
          : await api.importSkill({
              skillMd: item.source,
              originType: 'market',
              originRef: `market://skills/${item.id}`,
            });
        setMessage(skillImportMessage(result));
        setDetailMarketSkillId(undefined);
        setDetailSkillVersionId(result.skill.skillVersionId);
        setTab('mine');
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '安装 Skill 失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation],
  );

  const saveSkillEditor = useCallback(
    async (source: string) => {
      const api = runtimeBridge();
      if (!api?.importSkill || !skillEditor || busyId) return;
      if (!source.trim()) {
        setError('请填写 SKILL.md 内容');
        return;
      }
      if (source.length > MAX_SKILL_MD_CHARS) {
        setError('SKILL.md 超过 512,000 字符限制');
        return;
      }
      setBusyId('skill-editor');
      setError(undefined);
      try {
        const original = skillEditor.skill;
        const payload =
          skillEditor.mode === 'edit' && original
            ? original.originType === 'market' || original.originType === 'derived'
              ? {
                  skillMd: source,
                  originType: 'derived' as const,
                  originRef: original.originRef,
                  derivedFromSkillVersionId:
                    original.derivedFromSkillVersionId ?? original.skillVersionId,
                  skillId: original.skillId,
                }
              : {
                  skillMd: source,
                  originType: 'local' as const,
                  skillId: original.skillId,
                }
            : { skillMd: source };
        const result = await api.importSkill(payload);
        setMessage(
          original?.originType === 'market'
            ? `已创建本地派生版本：${result.skill.name} v${result.skill.version}`
            : skillImportMessage(result),
        );
        setSkillEditor(undefined);
        setDetailSkillVersionId(result.skill.skillVersionId);
        setTab('mine');
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '保存 Skill 失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation, skillEditor],
  );

  const importRemoteSkill = useCallback(
    async (url: string) => {
      const api = runtimeBridge();
      if (!api || (!api.importRemoteSkill && (!api.importSkill || !api.fetchSkillMd)) || busyId) {
        return;
      }
      const normalizedUrl = url.trim();
      if (!normalizedUrl) return;
      setBusyId('skill-remote-import');
      setError(undefined);
      try {
        let result: ImportSkillResponse;
        if (api.importRemoteSkill) {
          result = await api.importRemoteSkill({ url: normalizedUrl });
        } else {
          const fetched = await api.fetchSkillMd!({ url: normalizedUrl });
          result = await api.importSkill!({
            skillMd: fetched.skillMd,
            originType: 'market',
            originRef: fetched.url,
          });
        }
        setRemoteSkillImportOpen(false);
        setMessage(
          result.deduped
            ? `远端 Skill 已存在：${result.skill.name} v${result.skill.version}`
            : `已导入远端 Skill：${result.skill.name} v${result.skill.version}`,
        );
        setDetailSkillVersionId(result.skill.skillVersionId);
        setTab('mine');
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '远端 Skill 导入失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation],
  );

  const openSkillEditor = useCallback(async (skill?: SkillVersionSummary) => {
    if (!skill) {
      setSkillEditor({ mode: 'create', source: newSkillTemplate() });
      setCreateMenuOpen(false);
      return;
    }
    const api = runtimeBridge();
    if (!api?.getSkill) return;
    setBusyId(`read:${skill.skillVersionId}`);
    setError(undefined);
    try {
      const result = await api.getSkill({ skillVersionId: skill.skillVersionId });
      const nextSource = replaceSkillFrontmatter(result.sourceMd, {
        name: result.skill.name,
        description: result.skill.description,
        version: nextPatchVersion(result.skill.version),
      });
      setSkillEditor({ mode: 'edit', skill: result.skill, source: nextSource });
    } catch (cause) {
      setError(capabilityErrorMessage(cause, '读取 Skill 失败'));
    } finally {
      setBusyId(undefined);
    }
  }, []);

  const deleteSkill = useCallback(
    async (skill: SkillVersionSummary) => {
      const api = runtimeBridge();
      if (!api?.deleteSkill || busyId) return;
      const confirmed = await dialog.confirm({
        title: '删除 Skill',
        message: `确定删除“${skill.name}”v${skill.version} 吗？\n\n删除后该 Skill 将从所有工作区移除：包含它的 Agent 绑定会被清除，且不可恢复（需重新创建/导入）。`,
        confirmText: '删除',
        danger: true,
      });
      if (!confirmed) return;
      setBusyId(`delete:${skill.skillVersionId}`);
      setError(undefined);
      try {
        await api.deleteSkill({ skillVersionId: skill.skillVersionId });
        setDetailSkillVersionId(undefined);
        setMessage(`已删除：${skill.name} v${skill.version}`);
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '删除 Skill 失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, dialog, refreshAfterMutation],
  );

  const setSkillGlobalEnabled = useCallback(
    async (skill: SkillVersionSummary, enabled: boolean) => {
      const api = runtimeBridge();
      if (!api?.setSkillEnabled || busyId) return;
      setBusyId(`skill-global:${skill.skillVersionId}`);
      setError(undefined);
      try {
        await api.setSkillEnabled({ skillVersionId: skill.skillVersionId, enabled });
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '更新 Skill 全局状态失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation],
  );

  const setMcpGlobalEnabled = useCallback(
    async (server: McpServerSummary, enabled: boolean) => {
      const api = runtimeBridge();
      if (!api?.setMcpServerEnabled || busyId) return;
      setBusyId(`mcp-global:${server.mcpServerId}`);
      setError(undefined);
      try {
        await api.setMcpServerEnabled({ mcpServerId: server.mcpServerId, enabled });
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '更新 MCP 全局状态失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation],
  );

  const deleteMcpServer = useCallback(
    async (server: McpServerSummary) => {
      const api = runtimeBridge();
      if (!api?.deleteMcpServer || busyId) return;
      const confirmed = await dialog.confirm({
        title: '删除 MCP',
        message: `确定删除“${server.name}”吗？\n\n该 MCP 将从所有工作区移除，包含它的智能体绑定会被清除，且不可恢复（需重新注册）。`,
        confirmText: '删除',
        danger: true,
      });
      if (!confirmed) return;
      setBusyId(`mcp-delete:${server.mcpServerId}`);
      setError(undefined);
      try {
        await api.deleteMcpServer({ mcpServerId: server.mcpServerId });
        setDetailMcpServerId(undefined);
        setDetailMarketMcpId(undefined);
        setMessage(`已删除 MCP：${server.name}`);
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '删除 MCP 失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, dialog, refreshAfterMutation],
  );

  const setWorkspaceActive = useCallback(
    async (capabilityType: 'skill' | 'mcp', capabilityId: string, active: boolean) => {
      const api = runtimeBridge();
      if (!api?.setCapabilityWorkspaceActive || busyId) return;
      setBusyId(`workspace:${capabilityType}:${capabilityId}`);
      setError(undefined);
      try {
        await api.setCapabilityWorkspaceActive({
          workspaceId: selectedWorkspaceId,
          capabilityType,
          capabilityId,
          active,
        });
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '更新工作区激活状态失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation, selectedWorkspaceId],
  );

  const registerMcp = useCallback(
    async (payload: {
      name: string;
      transport: 'local-stdio' | 'remote-http';
      endpoint: string;
      notes: string;
      trusted: boolean;
      apiKey?: string;
      authScheme?: 'api-key' | 'bearer';
      discoverTools?: boolean;
    }) => {
      const api = runtimeBridge();
      if (!api?.registerMcpServer || busyId) return;
      setBusyId('mcp-register');
      setError(undefined);
      try {
        const result =
          payload.transport === 'remote-http' && api.registerRemoteMcpServer
            ? await api.registerRemoteMcpServer(payload)
            : await api.registerMcpServer(payload);
        setRegisterMcpItem(undefined);
        const discoveryError =
          'discoveryError' in result && typeof result.discoveryError === 'string'
            ? result.discoveryError
            : undefined;
        if (discoveryError) {
          setMessage(undefined);
          setError(
            `${result.updated ? 'MCP 配置已更新' : 'MCP 已注册'}，但工具发现失败：${discoveryError}`,
          );
        } else {
          setMessage(
            result.updated
              ? `已更新 MCP：${result.server.name}`
              : `已注册 MCP：${result.server.name}`,
          );
        }
        setDetailMcpServerId(result.server.mcpServerId);
        setTab('mine');
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '注册 MCP 失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation],
  );

  const refreshMcpTools = useCallback(
    async (server: McpServerSummary) => {
      const api = runtimeBridge();
      if (!api?.refreshMcpTools || busyId) return;
      setBusyId(`mcp-refresh:${server.mcpServerId}`);
      setError(undefined);
      try {
        const result = await api.refreshMcpTools({ mcpServerId: server.mcpServerId });
        if (result.ok === false) {
          setMessage(undefined);
          setError(
            `刷新 MCP 工具失败：${result.refuseReason || result.auditNote || '远端服务未返回有效工具目录'}`,
          );
          await refreshAfterMutation();
          return;
        }
        setMessage(`已发现 ${result.toolCount} 个 MCP 工具`);
        await refreshAfterMutation();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '刷新 MCP 工具失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, refreshAfterMutation],
  );

  const previewOrganize = useCallback(async () => {
    const api = runtimeBridge();
    if (!api?.previewCapabilityOrganize || busyId) return;
    setBusyId('organize');
    setError(undefined);
    try {
      const response = await api.previewCapabilityOrganize({
        workspaceId: selectedWorkspaceId,
        contextBudgetTokens: CONTEXT_BUDGET_TOKENS,
      });
      setOrganizeReport(response.report);
    } catch (cause) {
      setError(capabilityErrorMessage(cause, '生成整理报告失败'));
    } finally {
      setBusyId(undefined);
    }
  }, [busyId, selectedWorkspaceId]);

  const closeNotices = () => {
    setMessage(undefined);
    setError(undefined);
  };

  return (
    <main className="capability-center" data-testid="abilities-page">
      <header className="capability-center__header">
        <div className="capability-center__heading">
          <span className="capability-center__heading-icon">
            {section === 'skills' ? <Sparkles size={16} /> : <Plug size={16} />}
          </span>
          <div>
            <h1>{section === 'skills' ? 'Skill 管理' : 'MCP 管理'}</h1>
            <p>
              {section === 'skills'
                ? '管理可复用指令、工作区激活和智能体装备'
                : '管理全局外部工具服务，注册后启用即生效'}
            </p>
          </div>
        </div>

        <div className="capability-center__section-switch" role="tablist" aria-label="能力类型">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'skills'}
            className={section === 'skills' ? 'is-active' : undefined}
            onClick={() => setSection('skills')}
          >
            <Sparkles size={13} />
            Skill
          </button>
          <button
            type="button"
            role="tab"
            data-testid="abilities-section-mcp"
            aria-selected={section === 'mcp'}
            className={section === 'mcp' ? 'is-active' : undefined}
            onClick={() => setSection('mcp')}
          >
            <Plug size={13} />
            MCP
          </button>
        </div>

        <HeaderActions
          section={section}
          createMenuOpen={createMenuOpen}
          hasSkills={families.length > 0}
          onActivationCode={() => {
            setMessage('Skill 激活码渠道筹备中');
            setError(undefined);
          }}
          onToggleCreateMenu={() => setCreateMenuOpen((open) => !open)}
          onCreateSkill={() => void openSkillEditor()}
          onImportRemoteSkill={() => {
            setCreateMenuOpen(false);
            setRemoteSkillImportOpen(true);
          }}
          onPublishSkill={() => {
            setPublishSkillVersionId(families[0]?.latest.skillVersionId);
            setCreateMenuOpen(false);
          }}
          onRegisterMcp={() => setRegisterMcpItem(null)}
        />
      </header>

      <section className="capability-center__toolbar">
        <div className="capability-center__catalog-tabs" role="tablist" aria-label="能力目录">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'market'}
            className={tab === 'market' ? 'is-active' : undefined}
            onClick={() => setTab('market')}
          >
            {section === 'skills' ? 'Skill 市场' : 'MCP 市场'}
            <span>{section === 'skills' ? SKILL_MARKET.length : MCP_MARKET.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            data-testid={section === 'skills' ? 'skill-tab-mine' : 'mcp-tab-mine'}
            aria-selected={tab === 'mine'}
            className={tab === 'mine' ? 'is-active' : undefined}
            onClick={() => setTab('mine')}
          >
            {section === 'skills' ? '我的 Skill' : '我的 MCP'}
            <span>{section === 'skills' ? families.length : servers.length}</span>
          </button>
        </div>
        <label className="capability-center__search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`搜索 ${section === 'skills' ? 'Skill' : 'MCP'}...`}
            aria-label={`搜索 ${section === 'skills' ? 'Skill' : 'MCP'}`}
          />
          {query ? (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          ) : null}
        </label>
      </section>

      {loadError ? (
        <StatusBanner kind="error" title="能力库加载失败" detail={loadError}>
          <button type="button" onClick={() => void loadCatalog()}>
            重新加载
          </button>
        </StatusBanner>
      ) : message ? (
        <StatusBanner kind="success" title={message} onClose={closeNotices} />
      ) : error ? (
        <StatusBanner kind="error" title={error} onClose={closeNotices} />
      ) : null}

      {section === 'skills' ? (
        <SkillSurface
          tab={tab}
          query={query}
          category={skillCategory}
          statusFilter={statusFilter}
          sourceFilter={sourceFilter}
          families={families}
          governanceMap={skillGovernanceMap}
          loading={loading}
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          workspaceName={workspaceName}
          busyId={busyId}
          onCategoryChange={setSkillCategory}
          onStatusFilterChange={setStatusFilter}
          onSourceFilterChange={setSourceFilter}
          onWorkspaceChange={setSelectedWorkspaceId}
          onOpenMarket={setDetailMarketSkillId}
          onOpenSkill={setDetailSkillVersionId}
          onInstallMarket={(item) => void installMarketSkill(item)}
          onCreate={() => void openSkillEditor()}
          onGlobalEnabled={(skill, enabled) => void setSkillGlobalEnabled(skill, enabled)}
          onWorkspaceActive={(skill, active) =>
            void setWorkspaceActive('skill', skill.skillVersionId, active)
          }
          onDelete={(skill) => void deleteSkill(skill)}
          onOrganize={() => void previewOrganize()}
        />
      ) : (
        <McpSurface
          tab={tab}
          query={query}
          category={mcpCategory}
          statusFilter={statusFilter}
          servers={servers}
          governanceMap={mcpGovernanceMap}
          loading={loading}
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          workspaceName={workspaceName}
          busyId={busyId}
          onCategoryChange={setMcpCategory}
          onStatusFilterChange={setStatusFilter}
          onWorkspaceChange={setSelectedWorkspaceId}
          onOpenMarket={setDetailMarketMcpId}
          onOpenServer={setDetailMcpServerId}
          onRegister={setRegisterMcpItem}
          onGlobalEnabled={(server, enabled) => void setMcpGlobalEnabled(server, enabled)}
          onRefresh={(server) => void refreshMcpTools(server)}
          onOrganize={() => void previewOrganize()}
        />
      )}

      <SkillDetailDrawer
        skill={selectedSkill}
        marketItem={selectedMarketSkill}
        governance={
          selectedSkill ? skillGovernanceMap.get(selectedSkill.skillVersionId) : undefined
        }
        workspaceName={workspaceName}
        open={Boolean(selectedSkill || selectedMarketSkill)}
        busy={Boolean(busyId)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSkillVersionId(undefined);
            setDetailMarketSkillId(undefined);
          }
        }}
        onInstall={(item) => void installMarketSkill(item)}
        onEdit={(skill) => void openSkillEditor(skill)}
        onViewSource={setSourceSkill}
        onPublish={(skill) => setPublishSkillVersionId(skill.skillVersionId)}
        onDelete={(skill) => void deleteSkill(skill)}
        onGoToAgents={props.onGoToAgents}
      />

      <McpDetailDrawer
        server={selectedServer}
        marketItem={selectedMarketMcp}
        governance={selectedServer ? mcpGovernanceMap.get(selectedServer.mcpServerId) : undefined}
        error={selectedServer ? error : undefined}
        workspaceName={workspaceName}
        open={Boolean(selectedServer || selectedMarketMcp)}
        busy={Boolean(busyId)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailMcpServerId(undefined);
            setDetailMarketMcpId(undefined);
          }
        }}
        onRegister={setRegisterMcpItem}
        onConfigureAuth={(server) => {
          setDetailMcpServerId(undefined);
          setRegisterMcpItem(server);
        }}
        onRefresh={(server) => void refreshMcpTools(server)}
        onDeleteMcp={(server) => void deleteMcpServer(server)}
      />

      <SkillEditorDialog
        state={skillEditor}
        saving={busyId === 'skill-editor'}
        error={skillEditor ? error : undefined}
        onOpenChange={(open) => {
          if (!open) setSkillEditor(undefined);
        }}
        onSubmit={(source) => void saveSkillEditor(source)}
      />

      <SkillRemoteImportDialog
        open={remoteSkillImportOpen}
        loading={busyId === 'skill-remote-import'}
        error={remoteSkillImportOpen ? error : undefined}
        onOpenChange={(open) => {
          if (!open && busyId !== 'skill-remote-import') {
            setRemoteSkillImportOpen(false);
            setError(undefined);
          }
        }}
        onSubmit={(url) => void importRemoteSkill(url)}
      />

      <SkillSourceDialog
        skill={sourceSkill}
        onOpenChange={(open) => {
          if (!open) setSourceSkill(undefined);
        }}
      />

      <SkillPublishDialog
        open={publishSkillVersionId !== undefined}
        skillVersionId={publishSkillVersionId}
        families={families}
        onSkillVersionChange={setPublishSkillVersionId}
        onOpenChange={(open) => {
          if (!open) setPublishSkillVersionId(undefined);
        }}
        onMessage={(value) => {
          setMessage(value);
          setError(undefined);
        }}
        onError={(value) => {
          setError(value);
          setMessage(undefined);
        }}
      />

      <McpRegisterDialog
        item={registerMcpItem}
        open={registerMcpItem !== undefined}
        saving={busyId === 'mcp-register'}
        error={registerMcpItem !== undefined ? error : undefined}
        onOpenChange={(open) => {
          if (!open) setRegisterMcpItem(undefined);
        }}
        onSubmit={(payload) => void registerMcp(payload)}
      />

      <OrganizeReportDialog
        report={organizeReport}
        capabilityNames={
          new Map([
            ...skills.map((skill) => [skill.skillVersionId, skill.name] as const),
            ...servers.map((server) => [server.mcpServerId, server.name] as const),
          ])
        }
        onOpenChange={(open) => {
          if (!open) setOrganizeReport(undefined);
        }}
      />
    </main>
  );
}

function HeaderActions(props: {
  section: AbilitySection;
  createMenuOpen: boolean;
  hasSkills: boolean;
  onActivationCode(): void;
  onToggleCreateMenu(): void;
  onCreateSkill(): void;
  onImportRemoteSkill(): void;
  onPublishSkill(): void;
  onRegisterMcp(): void;
}): JSX.Element {
  if (props.section === 'mcp') {
    return (
      <div className="capability-center__header-actions">
        <button
          type="button"
          data-testid="mcp-register-open"
          className="capability-button capability-button--primary"
          onClick={props.onRegisterMcp}
        >
          <Plus size={14} />
          注册 MCP
        </button>
      </div>
    );
  }

  return (
    <div className="capability-center__header-actions">
      <button
        type="button"
        className="capability-button capability-button--outline"
        onClick={props.onActivationCode}
      >
        <KeyRound size={13} />
        Skill 激活码
      </button>
      <div className="capability-create-menu">
        <button
          type="button"
          data-testid="open-skill-import"
          className="capability-button capability-button--primary"
          aria-expanded={props.createMenuOpen}
          onClick={props.onToggleCreateMenu}
        >
          <Plus size={14} />
          创建 Skill
          <ChevronDown size={12} />
        </button>
        {props.createMenuOpen ? (
          <div className="capability-create-menu__popover">
            <button type="button" onClick={props.onCreateSkill}>
              <FileCode2 size={15} />
              <span>
                <strong>本地创建</strong>
                <small>新建或导入 SKILL.md</small>
              </span>
            </button>
            <button type="button" onClick={props.onImportRemoteSkill}>
              <CloudDownload size={15} />
              <span>
                <strong>远端导入</strong>
                <small>从 URL 获取并保存到本地能力库</small>
              </span>
            </button>
            <button type="button" disabled={!props.hasSkills} onClick={props.onPublishSkill}>
              <Send size={15} />
              <span>
                <strong>发布到市场</strong>
                <small>{props.hasSkills ? '保存本地发布草稿' : '请先创建一个 Skill'}</small>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SkillSurface(props: {
  tab: CatalogTab;
  query: string;
  category: (typeof SKILL_CATEGORIES)[number];
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  families: SkillFamily[];
  governanceMap: Map<string, GovernedSkillSummary>;
  loading: boolean;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string;
  workspaceName: string;
  busyId?: string;
  onCategoryChange(value: (typeof SKILL_CATEGORIES)[number]): void;
  onStatusFilterChange(value: StatusFilter): void;
  onSourceFilterChange(value: SourceFilter): void;
  onWorkspaceChange(value: string): void;
  onOpenMarket(id: string): void;
  onOpenSkill(id: string): void;
  onInstallMarket(item: SkillMarketItem): void;
  onCreate(): void;
  onGlobalEnabled(skill: SkillVersionSummary, enabled: boolean): void;
  onWorkspaceActive(skill: SkillVersionSummary, active: boolean): void;
  onDelete(skill: SkillVersionSummary): void;
  onOrganize(): void;
}): JSX.Element {
  const needle = props.query.trim().toLocaleLowerCase();
  const marketItems = SKILL_MARKET.filter((item) => {
    const categoryMatches = props.category === '全部' || item.category === props.category;
    const searchMatches =
      !needle ||
      [item.name, item.slug, item.category, item.description]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    return categoryMatches && searchMatches;
  });

  const visibleFamilies = props.families.filter((family) => {
    const skill = family.latest;
    const row = props.governanceMap.get(skill.skillVersionId);
    const usage = row?.usage ?? defaultUsage('skill', skill.skillVersionId);
    const workspaceActive = row?.workspaceActive ?? false;
    const enabled = skill.enabled !== false;
    const searchMatches =
      !needle ||
      [skill.name, skill.description, skill.skillId, skill.version]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    const origin = skill.originType ?? 'local';
    const sourceMatches = props.sourceFilter === 'all' || origin === props.sourceFilter;
    const statusMatches =
      props.statusFilter === 'all' ||
      (props.statusFilter === 'active' && usage.callCount > 0) ||
      (props.statusFilter === 'enabled' && enabled && workspaceActive) ||
      (props.statusFilter === 'inactive' && !workspaceActive) ||
      (props.statusFilter === 'unused' && usage.callCount === 0) ||
      (props.statusFilter === 'problem' &&
        (usage.problemCount > 0 || skill.hasScripts || skill.warnings.length > 0));
    return searchMatches && sourceMatches && statusMatches;
  });

  if (props.tab === 'market') {
    return (
      <section className="capability-center__content">
        <CategoryRail
          items={SKILL_CATEGORIES}
          value={props.category}
          onChange={props.onCategoryChange}
        />
        <div className="capability-market-grid">
          {marketItems.map((item) => {
            const installed = marketSkillInstalled(item, props.families);
            const busy = props.busyId === `market-skill:${item.id}`;
            return (
              <article key={item.id} className="capability-market-card">
                <button
                  type="button"
                  className="capability-market-card__body"
                  onClick={() =>
                    installed
                      ? props.onOpenSkill(installed.skillVersionId)
                      : props.onOpenMarket(item.id)
                  }
                >
                  <span className="capability-market-card__icon">
                    <PackageOpen size={20} />
                  </span>
                  <span className="capability-market-card__copy">
                    <span>
                      <strong>{item.name}</strong>
                      {installed ? <em>已安装</em> : null}
                    </span>
                    <small>{item.description}</small>
                  </span>
                </button>
                <footer>
                  <span>{item.category}</span>
                  {installed ? (
                    <button
                      type="button"
                      className="capability-link-button"
                      onClick={() => props.onOpenSkill(installed.skillVersionId)}
                    >
                      管理
                      <ArrowRight size={12} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="capability-install-button"
                      disabled={Boolean(props.busyId)}
                      onClick={() => props.onInstallMarket(item)}
                    >
                      {busy ? <Loader2 className="animate-spin" size={12} /> : <Plus size={12} />}
                      {busy ? '安装中' : '安装'}
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
        {marketItems.length === 0 ? <EmptyState title="没有匹配的 Skill" compact /> : null}
      </section>
    );
  }

  const rows = props.families.map((family) => {
    const governance = props.governanceMap.get(family.latest.skillVersionId);
    return {
      family,
      usage: governance?.usage ?? defaultUsage('skill', family.latest.skillVersionId),
      workspaceActive: governance?.workspaceActive ?? false,
    };
  });
  const recentCount = rows.filter((row) => row.usage.callCount > 0).length;
  const unusedCount = rows.filter((row) => row.usage.callCount === 0).length;
  const problemCount = rows.filter(
    (row) =>
      row.usage.problemCount > 0 ||
      row.family.latest.hasScripts ||
      row.family.latest.warnings.length > 0,
  ).length;
  const contextTokens = rows.reduce((sum, row) => sum + row.usage.contextTokens, 0);

  return (
    <section className="capability-center__content capability-center__content--mine">
      <CapabilityStats
        total={props.families.length}
        recent={recentCount}
        unused={unusedCount}
        problems={problemCount}
        contextTokens={contextTokens}
      />
      <GovernanceFilters
        workspaces={props.workspaces}
        selectedWorkspaceId={props.selectedWorkspaceId}
        workspaceName={props.workspaceName}
        statusFilter={props.statusFilter}
        sourceFilter={props.sourceFilter}
        showSource
        organizing={props.busyId === 'organize'}
        onWorkspaceChange={props.onWorkspaceChange}
        onStatusFilterChange={props.onStatusFilterChange}
        onSourceFilterChange={props.onSourceFilterChange}
        onOrganize={props.onOrganize}
      />
      <GovernanceRuleNote />
      <div className="capability-list-shell">
        {props.loading ? (
          <LoadingState label="正在读取 Skill..." />
        ) : props.families.length === 0 ? (
          <EmptyState
            title="能力库还是空的"
            description="创建或导入一份 SKILL.md，把固定工作流程变成可复用能力。"
            actionLabel="创建 Skill"
            onAction={props.onCreate}
          />
        ) : visibleFamilies.length === 0 ? (
          <EmptyState title="没有匹配的已安装 Skill" compact />
        ) : (
          <div className="capability-governance-list" role="table" aria-label="Skill 治理列表">
            <div className="capability-governance-list__header" role="row">
              <span>Skill</span>
              <span>来源</span>
              <span>工作区激活</span>
              <span>45 天触发</span>
              <span>最后触发</span>
              <span>操作</span>
              <span>全局启用</span>
            </div>
            {visibleFamilies.map((family) => {
              const skill = family.latest;
              const governance = props.governanceMap.get(skill.skillVersionId);
              const usage = governance?.usage ?? defaultUsage('skill', skill.skillVersionId);
              const workspaceActive = governance?.workspaceActive ?? false;
              const issue = usage.problemCount > 0 || skill.hasScripts || skill.warnings.length > 0;
              return (
                <article key={family.skillId} className="capability-governance-row" role="row">
                  <button
                    type="button"
                    className="capability-governance-row__identity"
                    onClick={() => props.onOpenSkill(skill.skillVersionId)}
                  >
                    <span className="capability-row-icon">
                      <Sparkles size={15} />
                    </span>
                    <span className="ability-installed-row__copy">
                      <span>
                        <strong>{skill.name}</strong>
                        <em className={issue ? 'is-warning' : undefined}>
                          {issue ? `${usage.problemCount || skill.warnings.length} 个问题` : '正常'}
                        </em>
                      </span>
                      <small>{skill.description || '未提供说明'}</small>
                    </span>
                  </button>
                  <span className="capability-origin">
                    {skillOriginLabel(skill)}
                    <small>v{skill.version}</small>
                  </span>
                  <WorkspaceActivationControl
                    active={workspaceActive}
                    workspaceName={props.workspaceName}
                    testId={`skill-workspace-activation-${skill.skillVersionId}`}
                    busy={props.busyId === `workspace:skill:${skill.skillVersionId}`}
                    disabled={Boolean(props.busyId) || skill.enabled === false}
                    onChange={(active) => props.onWorkspaceActive(skill, active)}
                  />
                  <strong className="capability-governance-row__metric">
                    {usage.callCount.toLocaleString('zh-CN')}
                  </strong>
                  <span>{formatRelativeDate(usage.lastUsedAt)}</span>
                  <div className="capability-row-actions">
                    <button
                      type="button"
                      title="查看详情"
                      onClick={() => props.onOpenSkill(skill.skillVersionId)}
                    >
                      <BookOpen size={13} />
                    </button>
                    {skill.originType !== 'market' ? (
                      <button
                        type="button"
                        title="删除 Skill"
                        className="capability-row-actions__danger"
                        disabled={Boolean(props.busyId)}
                        onClick={() => props.onDelete(skill)}
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </div>
                  <ToggleSwitch
                    label={`${skill.enabled === false ? '启用' : '停用'} ${skill.name}`}
                    checked={skill.enabled !== false}
                    disabled={Boolean(props.busyId)}
                    onChange={(enabled) => props.onGlobalEnabled(skill, enabled)}
                  />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function McpSurface(props: {
  tab: CatalogTab;
  query: string;
  category: (typeof MCP_CATEGORIES)[number];
  statusFilter: StatusFilter;
  servers: McpServerSummary[];
  governanceMap: Map<string, GovernedMcpServerSummary>;
  loading: boolean;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string;
  workspaceName: string;
  busyId?: string;
  onCategoryChange(value: (typeof MCP_CATEGORIES)[number]): void;
  onStatusFilterChange(value: StatusFilter): void;
  onWorkspaceChange(value: string): void;
  onOpenMarket(id: string): void;
  onOpenServer(id: string): void;
  onRegister(item: McpMarketItem | null): void;
  onGlobalEnabled(server: McpServerSummary, enabled: boolean): void;
  onRefresh(server: McpServerSummary): void;
  onOrganize(): void;
}): JSX.Element {
  const needle = props.query.trim().toLocaleLowerCase();
  const marketItems = MCP_MARKET.filter((item) => {
    const categoryMatches = props.category === '全部' || item.category === props.category;
    const searchMatches =
      !needle ||
      [item.name, item.category, item.description, item.endpoint]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    return categoryMatches && searchMatches;
  });
  const visibleServers = props.servers.filter((server) => {
    const row = props.governanceMap.get(server.mcpServerId);
    const usage = row?.usage ?? defaultUsage('mcp', server.mcpServerId);
    const searchMatches =
      !needle ||
      [server.name, server.endpoint, server.notes, ...server.tools.map((tool) => tool.name)]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    // MCP is global: enablement is the only gate (no workspace activation).
    const statusMatches =
      props.statusFilter === 'all' ||
      (props.statusFilter === 'active' && usage.callCount > 0) ||
      (props.statusFilter === 'enabled' && server.enabled !== false) ||
      (props.statusFilter === 'inactive' && server.enabled === false) ||
      (props.statusFilter === 'unused' && usage.callCount === 0) ||
      (props.statusFilter === 'problem' &&
        (usage.problemCount > 0 || !server.trusted || server.tools.length === 0));
    return searchMatches && statusMatches;
  });

  if (props.tab === 'market') {
    return (
      <section className="capability-center__content">
        <CategoryRail
          items={MCP_CATEGORIES}
          value={props.category}
          onChange={props.onCategoryChange}
        />
        <div className="capability-market-grid">
          {marketItems.map((item) => {
            const installed = marketMcpInstalled(item, props.servers);
            return (
              <article key={item.id} className="capability-market-card">
                <button
                  type="button"
                  className="capability-market-card__body"
                  onClick={() =>
                    installed
                      ? props.onOpenServer(installed.mcpServerId)
                      : props.onOpenMarket(item.id)
                  }
                >
                  <span className="capability-market-card__icon is-mcp">
                    <Plug size={20} />
                  </span>
                  <span className="capability-market-card__copy">
                    <span>
                      <strong>{item.name}</strong>
                      {installed ? <em>已注册</em> : null}
                    </span>
                    <small>{item.description}</small>
                  </span>
                </button>
                <footer>
                  <span>{item.transport === 'local-stdio' ? '本地 stdio' : '远程 HTTP'}</span>
                  {installed ? (
                    <button
                      type="button"
                      className="capability-link-button"
                      onClick={() => props.onOpenServer(installed.mcpServerId)}
                    >
                      管理
                      <ArrowRight size={12} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="capability-install-button"
                      onClick={() => props.onRegister(item)}
                    >
                      <Plus size={12} />
                      注册
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  const rows = props.servers.map((server) => {
    const governance = props.governanceMap.get(server.mcpServerId);
    return {
      server,
      usage: governance?.usage ?? defaultUsage('mcp', server.mcpServerId),
    };
  });
  const recentCount = rows.filter((row) => row.usage.callCount > 0).length;
  const unusedCount = rows.filter((row) => row.usage.callCount === 0).length;
  const problemCount = rows.filter(
    (row) => row.usage.problemCount > 0 || !row.server.trusted || row.server.tools.length === 0,
  ).length;
  const contextTokens = rows.reduce((sum, row) => sum + row.usage.contextTokens, 0);

  return (
    <section className="capability-center__content capability-center__content--mine">
      <CapabilityStats
        total={props.servers.length}
        recent={recentCount}
        unused={unusedCount}
        problems={problemCount}
        contextTokens={contextTokens}
      />
      <GovernanceFilters
        workspaces={props.workspaces}
        selectedWorkspaceId={props.selectedWorkspaceId}
        workspaceName={props.workspaceName}
        statusFilter={props.statusFilter}
        sourceFilter="all"
        organizing={props.busyId === 'organize'}
        onWorkspaceChange={props.onWorkspaceChange}
        onStatusFilterChange={props.onStatusFilterChange}
        onSourceFilterChange={() => undefined}
        onOrganize={props.onOrganize}
      />
      <div className="capability-list-shell">
        {props.loading ? (
          <LoadingState label="正在读取 MCP..." />
        ) : props.servers.length === 0 ? (
          <EmptyState
            title="还没有注册 MCP"
            description="从市场选择模板，或手动填写本地命令与远程 Endpoint。"
            actionLabel="注册 MCP"
            onAction={() => props.onRegister(null)}
          />
        ) : visibleServers.length === 0 ? (
          <EmptyState title="没有匹配的 MCP" compact />
        ) : (
          <div
            className="capability-governance-list capability-governance-list--mcp"
            role="table"
            aria-label="MCP 治理列表"
          >
            <div className="capability-governance-list__header" role="row">
              <span>MCP 服务</span>
              <span>连接</span>
              <span>45 天调用</span>
              <span>最后调用</span>
              <span>操作</span>
              <span>启用</span>
            </div>
            {visibleServers.map((server) => {
              const governance = props.governanceMap.get(server.mcpServerId);
              const usage = governance?.usage ?? defaultUsage('mcp', server.mcpServerId);
              const issue = usage.problemCount > 0 || !server.trusted || server.tools.length === 0;
              return (
                <article key={server.mcpServerId} className="capability-governance-row" role="row">
                  <button
                    type="button"
                    className="capability-governance-row__identity"
                    onClick={() => props.onOpenServer(server.mcpServerId)}
                  >
                    <span className="capability-row-icon is-mcp">
                      <Server size={15} />
                    </span>
                    <span className="ability-installed-row__copy">
                      <span>
                        <strong>{server.name}</strong>
                        <em className={issue ? 'is-warning' : undefined}>
                          {issue ? '需要检查' : `${server.tools.length} 个工具`}
                        </em>
                      </span>
                      <small>{server.notes || server.endpoint || '未填写连接说明'}</small>
                    </span>
                  </button>
                  <span className="capability-origin">
                    {server.transport === 'remote-http' ? '远程 HTTP' : '本地 stdio'}
                    <small>{server.trusted ? '可信来源' : '未标记可信'}</small>
                  </span>
                  <strong className="capability-governance-row__metric">
                    {usage.callCount.toLocaleString('zh-CN')}
                  </strong>
                  <span>{formatRelativeDate(usage.lastUsedAt)}</span>
                  <div className="capability-row-actions">
                    <button
                      type="button"
                      data-testid={`mcp-row-refresh-${server.mcpServerId}`}
                      title="刷新工具"
                      disabled={Boolean(props.busyId)}
                      onClick={() => props.onRefresh(server)}
                    >
                      <RefreshCw
                        size={13}
                        className={
                          props.busyId === `mcp-refresh:${server.mcpServerId}`
                            ? 'animate-spin'
                            : undefined
                        }
                      />
                    </button>
                    <button
                      type="button"
                      title="查看详情"
                      onClick={() => props.onOpenServer(server.mcpServerId)}
                    >
                      <BookOpen size={13} />
                    </button>
                  </div>
                  <ToggleSwitch
                    label={`${server.enabled === false ? '启用' : '停用'} ${server.name}`}
                    checked={server.enabled !== false}
                    disabled={Boolean(props.busyId)}
                    onChange={(enabled) => props.onGlobalEnabled(server, enabled)}
                  />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryRail<T extends string>(props: {
  items: readonly T[];
  value: T;
  onChange(value: T): void;
}): JSX.Element {
  return (
    <div className="capability-category-rail" aria-label="分类筛选">
      {props.items.map((item) => (
        <button
          key={item}
          type="button"
          className={props.value === item ? 'is-active' : undefined}
          onClick={() => props.onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function CapabilityStats(props: {
  total: number;
  recent: number;
  unused: number;
  problems: number;
  contextTokens: number;
}): JSX.Element {
  const contextPercent = Math.min(
    100,
    Math.round((props.contextTokens / CONTEXT_BUDGET_TOKENS) * 100),
  );
  return (
    <div className="capability-stats">
      <StatCard
        value={props.total}
        label="全部"
        detail="当前目录中的能力"
        icon={<Layers3 size={13} />}
      />
      <StatCard
        value={props.recent}
        label="近期活跃"
        detail="45 天内有触发记录"
        icon={<CircleGauge size={13} />}
      />
      <StatCard
        value={props.unused}
        label="在吃灰"
        detail="45 天内没有触发"
        icon={<Boxes size={13} />}
      />
      <StatCard
        value={props.problems}
        label="有问题"
        detail="失败、告警或待发现"
        tone={props.problems > 0 ? 'warning' : 'normal'}
        icon={<AlertTriangle size={13} />}
      />
      <article
        className={
          contextPercent >= 100
            ? 'capability-stat capability-stat--context is-warning'
            : 'capability-stat capability-stat--context'
        }
      >
        <div>
          <span>常驻上下文占用</span>
          <strong>
            {contextPercent >= 100
              ? `≈ 超限 ${(props.contextTokens / CONTEXT_BUDGET_TOKENS).toFixed(1)}x`
              : `${contextPercent}%`}
          </strong>
        </div>
        <div className="capability-context-meter">
          <span style={{ width: `${contextPercent}%` }} />
        </div>
        <p>
          {formatTokens(props.contextTokens)} tokens / 建议上限{' '}
          {formatTokens(CONTEXT_BUDGET_TOKENS)}
        </p>
      </article>
    </div>
  );
}

function GovernanceFilters(props: {
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string;
  workspaceName: string;
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  showSource?: boolean;
  organizing: boolean;
  onWorkspaceChange(value: string): void;
  onStatusFilterChange(value: StatusFilter): void;
  onSourceFilterChange(value: SourceFilter): void;
  onOrganize(): void;
}): JSX.Element {
  const statusItems: Array<[StatusFilter, string]> = [
    ['all', '全部状态'],
    ['active', '活跃'],
    ['enabled', '已生效'],
    ['inactive', '未激活'],
    ['unused', '未触发'],
    ['problem', '有问题'],
  ];
  const sourceItems: Array<[SourceFilter, string]> = [
    ['all', '全部来源'],
    ['market', '市场安装'],
    ['local', '本地创建'],
    ['derived', '本地派生'],
  ];

  return (
    <div className="capability-governance-toolbar">
      <div className="capability-workspace-filter">
        <Folder size={13} />
        {props.workspaces.length > 0 ? (
          <select
            value={props.selectedWorkspaceId}
            aria-label="选择治理工作区"
            onChange={(event) => props.onWorkspaceChange(event.target.value)}
          >
            {props.workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.name}
              </option>
            ))}
          </select>
        ) : (
          <span>{props.workspaceName}</span>
        )}
      </div>
      <div className="capability-filter-group" role="group" aria-label="状态筛选">
        {statusItems.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={props.statusFilter === value ? 'is-active' : undefined}
            onClick={() => props.onStatusFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {props.showSource ? (
        <label className="capability-source-select">
          <span>来源</span>
          <select
            value={props.sourceFilter}
            onChange={(event) => props.onSourceFilterChange(event.target.value as SourceFilter)}
          >
            {sourceItems.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        className="capability-organize-button"
        disabled={props.organizing}
        onClick={props.onOrganize}
      >
        {props.organizing ? (
          <Loader2 className="animate-spin" size={13} />
        ) : (
          <WandSparkles size={13} />
        )}
        一键整理
      </button>
    </div>
  );
}

function GovernanceRuleNote(): JSX.Element {
  return (
    <div className="capability-governance-rule">
      <ShieldCheck size={13} />
      <div className="capability-governance-rule__copy">
        <strong>Skill 有两条生效路径</strong>
        <span>
          <b>Compose</b>
          <i>全局启用</i>
          <ArrowRight size={11} />
          <i>当前工作区激活</i>
          <ArrowRight size={11} />
          <i>进入本轮选择</i>
        </span>
        <span>
          <b>Agent / Team</b>
          <i>全局启用</i>
          <ArrowRight size={11} />
          <i>Agent 自身绑定</i>
          <ArrowRight size={11} />
          <i>默认注入上下文</i>
          <em>工作区激活不参与此路径</em>
        </span>
      </div>
    </div>
  );
}

function WorkspaceActivationControl(props: {
  active: boolean;
  workspaceName: string;
  testId?: string;
  busy?: boolean;
  disabled?: boolean;
  onChange(active: boolean): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={
        props.active && !props.busy
          ? 'capability-workspace-activation is-active'
          : props.busy
            ? 'capability-workspace-activation is-busy'
            : 'capability-workspace-activation'
      }
      data-testid={props.testId}
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      title={`${props.workspaceName}：${props.active ? '已激活' : '未激活'}`}
      onClick={() => props.onChange(!props.active)}
    >
      <span>
        {props.busy ? (
          <Loader2 className="animate-spin" size={10} />
        ) : props.active ? (
          <Check size={10} />
        ) : null}
      </span>
      {props.busy ? '更新中' : props.active ? '已激活' : '未激活'}
    </button>
  );
}

function ToggleSwitch(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      className="capability-toggle"
      data-enabled={props.checked ? '1' : '0'}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span />
    </button>
  );
}

function StatCard(props: {
  value: number;
  label: string;
  detail: string;
  tone?: 'normal' | 'warning';
  icon: ReactNode;
}): JSX.Element {
  return (
    <article
      className={props.tone === 'warning' ? 'capability-stat is-warning' : 'capability-stat'}
    >
      <div>
        <strong>{props.value}</strong>
        <span>
          {props.icon}
          {props.label}
        </span>
      </div>
      <p>{props.detail}</p>
    </article>
  );
}

function StatusBanner(props: {
  kind: 'success' | 'error';
  title: string;
  detail?: string;
  children?: ReactNode;
  onClose?(): void;
}): JSX.Element {
  return (
    <div
      className={
        props.kind === 'success'
          ? 'capability-status-banner is-success'
          : 'capability-status-banner is-error'
      }
      role={props.kind === 'error' ? 'alert' : 'status'}
    >
      {props.kind === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      <div>
        <strong>{props.title}</strong>
        {props.detail ? <span>{props.detail}</span> : null}
      </div>
      {props.children}
      {props.onClose ? (
        <button type="button" aria-label="关闭提示" onClick={props.onClose}>
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function LoadingState(props: { label: string }): JSX.Element {
  return (
    <div className="capability-loading-state">
      <Loader2 className="animate-spin" size={17} />
      <span>{props.label}</span>
    </div>
  );
}

function EmptyState(props: {
  title: string;
  description?: string;
  actionLabel?: string;
  compact?: boolean;
  onAction?(): void;
}): JSX.Element {
  return (
    <div className={props.compact ? 'capability-empty-state is-compact' : 'capability-empty-state'}>
      <span>
        <Boxes size={22} />
      </span>
      <strong>{props.title}</strong>
      {props.description ? <p>{props.description}</p> : null}
      {props.actionLabel && props.onAction ? (
        <button type="button" onClick={props.onAction}>
          <Plus size={13} />
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SkillDetailDrawer(props: {
  skill?: SkillVersionSummary;
  marketItem?: SkillMarketItem;
  governance?: GovernedSkillSummary;
  workspaceName: string;
  open: boolean;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onInstall(item: SkillMarketItem): void;
  onEdit(skill: SkillVersionSummary): void;
  onViewSource(skill: SkillVersionSummary): void;
  onPublish(skill: SkillVersionSummary): void;
  onDelete(skill: SkillVersionSummary): void;
  onGoToAgents(): void;
}): JSX.Element {
  const skill = props.skill;
  const marketItem = props.marketItem;
  const name = skill?.name ?? marketItem?.name ?? '';
  const description = skill?.description ?? marketItem?.description ?? '';
  const usage = props.governance?.usage;
  const issue = Boolean(
    skill && ((usage?.problemCount ?? 0) > 0 || skill.hasScripts || skill.warnings.length > 0),
  );

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-drawer">
          <header className="capability-drawer__header">
            <div className="capability-drawer__identity">
              <span className="capability-drawer__icon">
                <PackageOpen size={20} />
              </span>
              <div>
                <Dialog.Title>{name}</Dialog.Title>
                <Dialog.Description>
                  {skill ? `${skillOriginLabel(skill)} · v${skill.version}` : marketItem?.category}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="capability-icon-button" aria-label="关闭 Skill 详情">
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>

          <div className="capability-drawer__scroll">
            <p className="capability-drawer__description">{description}</p>
            {skill ? (
              <>
                <div className="capability-detail-status-grid">
                  <DetailMetric
                    label="全局状态"
                    value={skill.enabled === false ? '已停用' : '已启用'}
                    tone={skill.enabled === false ? 'muted' : 'success'}
                  />
                  <DetailMetric
                    label={props.workspaceName}
                    value={props.governance?.workspaceActive ? '已激活' : '未激活'}
                    tone={props.governance?.workspaceActive ? 'success' : 'muted'}
                  />
                  <DetailMetric
                    label="45 天触发"
                    value={(usage?.callCount ?? 0).toLocaleString('zh-CN')}
                  />
                  <DetailMetric
                    label="上下文"
                    value={`${formatTokens(usage?.contextTokens ?? 0)} tokens`}
                  />
                </div>
                <section className="capability-detail-section">
                  <h3>生效路径</h3>
                  <div className="capability-effect-chain">
                    <div className="capability-effect-chain__path">
                      <strong>Compose</strong>
                      <span className={skill.enabled === false ? undefined : 'is-done'}>
                        <Check size={11} />
                        全局启用
                      </span>
                      <ArrowRight size={12} />
                      <span className={props.governance?.workspaceActive ? 'is-done' : undefined}>
                        <Check size={11} />
                        工作区激活
                      </span>
                      <ArrowRight size={12} />
                      <span
                        className={
                          skill.enabled !== false && props.governance?.workspaceActive
                            ? 'is-done'
                            : undefined
                        }
                      >
                        <Sparkles size={11} />
                        本轮可选
                      </span>
                    </div>
                    <div className="capability-effect-chain__path">
                      <strong>Agent / Team</strong>
                      <span className={skill.enabled === false ? undefined : 'is-done'}>
                        <Check size={11} />
                        全局启用
                      </span>
                      <ArrowRight size={12} />
                      <span>
                        <Layers3 size={11} />
                        Agent 自身绑定
                      </span>
                      <ArrowRight size={12} />
                      <span className={skill.enabled === false ? undefined : 'is-done'}>
                        <Sparkles size={11} />
                        默认注入
                      </span>
                    </div>
                  </div>
                  <p className="capability-effect-chain__note">
                    Compose 需工作区激活；Agent / Team 按自身绑定注入；全局停用会阻断两条路径。
                  </p>
                </section>
                <section className="capability-detail-section">
                  <div className="capability-detail-section__heading">
                    <h3>工具声明</h3>
                    <span>{skill.allowedTools.length}</span>
                  </div>
                  {skill.allowedTools.length > 0 ? (
                    <div className="capability-tool-list">
                      {skill.allowedTools.map((tool) => (
                        <span key={tool}>{tool}</span>
                      ))}
                    </div>
                  ) : (
                    <p>该版本没有声明额外工具。</p>
                  )}
                </section>
                <section className="capability-detail-section">
                  <h3>检查结果</h3>
                  <div
                    className={
                      issue
                        ? 'capability-inspection is-warning'
                        : 'capability-inspection is-success'
                    }
                  >
                    {issue ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
                    <div>
                      <strong>{issue ? '需要检查' : '状态正常'}</strong>
                      <span>
                        {issue
                          ? '存在脚本声明、解析告警或近期调用问题。'
                          : '没有发现脚本声明或解析告警。'}
                      </span>
                    </div>
                  </div>
                  {skill.warnings.length > 0 ? (
                    <ul className="capability-warning-list">
                      {skill.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
                <section className="capability-detail-section">
                  <h3>版本信息</h3>
                  <dl className="capability-detail-list">
                    <div>
                      <dt>Skill ID</dt>
                      <dd>{skill.skillId}</dd>
                    </div>
                    <div>
                      <dt>版本 ID</dt>
                      <dd>{skill.skillVersionId}</dd>
                    </div>
                    <div>
                      <dt>创建时间</dt>
                      <dd>{formatDate(skill.createdAt)}</dd>
                    </div>
                    {skill.derivedFromSkillVersionId ? (
                      <div>
                        <dt>派生自</dt>
                        <dd>{skill.derivedFromSkillVersionId}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              </>
            ) : (
              <section className="capability-detail-section">
                <h3>安装说明</h3>
                <div className="capability-inspection is-success">
                  <BadgeCheck size={15} />
                  <div>
                    <strong>市场原版保持只读</strong>
                    <span>安装后可以启用、激活和绑定；编辑时会创建本地派生版本。</span>
                  </div>
                </div>
              </section>
            )}
          </div>

          <footer className="capability-drawer__footer">
            {skill ? (
              <>
                <button
                  type="button"
                  className="capability-button is-quiet"
                  onClick={props.onGoToAgents}
                >
                  前往 Agent
                </button>
                <button
                  type="button"
                  data-testid="skill-view-source"
                  className="capability-button is-secondary"
                  onClick={() => props.onViewSource(skill)}
                >
                  <Code2 size={13} />
                  源码
                </button>
                {skill.originType !== 'market' ? (
                  <button
                    type="button"
                    className="capability-button is-secondary"
                    disabled={props.busy}
                    onClick={() => props.onEdit(skill)}
                  >
                    <Edit3 size={13} />
                    编辑
                  </button>
                ) : null}
                <button
                  type="button"
                  className="capability-button is-secondary"
                  onClick={() => props.onPublish(skill)}
                >
                  <Send size={13} />
                  发布
                </button>
                {skill.originType !== 'market' ? (
                  <button
                    type="button"
                    className="capability-button is-danger"
                    disabled={props.busy}
                    onClick={() => props.onDelete(skill)}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </>
            ) : marketItem ? (
              <button
                type="button"
                className="capability-button capability-button--primary"
                disabled={props.busy}
                onClick={() => props.onInstall(marketItem)}
              >
                {props.busy ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
                安装 Skill
              </button>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * One discovered MCP tool row: name + chevron header, collapsible description.
 * Collapsed by default, single-line with ellipsis; clicking the row expands or
 * collapses the description with a smooth height transition.
 */
function McpToolItem({ name, description }: { name: string; description: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      className={`capability-mcp-tool-item${expanded ? ' is-expanded' : ''}`}
      onClick={() => setExpanded((value) => !value)}
    >
      <button type="button" className="capability-mcp-tool-item__head" aria-expanded={expanded}>
        <strong>{name}</strong>
        <ChevronDown size={13} className="capability-mcp-tool-item__chevron" />
      </button>
      <p className="capability-mcp-tool-item__desc" data-expanded={expanded ? '1' : '0'}>
        {description}
      </p>
    </article>
  );
}

function McpDetailDrawer(props: {
  server?: McpServerSummary;
  marketItem?: McpMarketItem;
  governance?: GovernedMcpServerSummary;
  error?: string;
  workspaceName: string;
  open: boolean;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onRegister(item: McpMarketItem | null): void;
  onConfigureAuth(server: McpServerSummary): void;
  onRefresh(server: McpServerSummary): void;
  onDeleteMcp(server: McpServerSummary): void;
}): JSX.Element {
  const server = props.server;
  const marketItem = props.marketItem;
  const name = server?.name ?? marketItem?.name ?? '';
  const description =
    marketItem?.description ?? server?.notes ?? '已注册的 MCP 服务，可刷新并发现工具。';
  const usage = props.governance?.usage;

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-drawer">
          <header className="capability-drawer__header">
            <div className="capability-drawer__identity">
              <span className="capability-drawer__icon is-mcp">
                <Plug size={20} />
              </span>
              <div>
                <Dialog.Title>{name}</Dialog.Title>
                <Dialog.Description>
                  {server?.transport === 'remote-http' || marketItem?.transport === 'remote-http'
                    ? '远程 HTTP'
                    : '本地 stdio'}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="capability-icon-button" aria-label="关闭 MCP 详情">
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>

          <div className="capability-drawer__scroll">
            <p className="capability-drawer__description">{description}</p>
            {props.error ? (
              <div className="capability-inline-error" role="alert">
                <AlertTriangle size={14} />
                {props.error}
              </div>
            ) : null}
            {server ? (
              <>
                <div className="capability-detail-status-grid">
                  <DetailMetric
                    label="全局状态"
                    value={server.enabled === false ? '已停用' : '已启用'}
                    tone={server.enabled === false ? 'muted' : 'success'}
                  />
                  <DetailMetric
                    label="45 天调用"
                    value={(usage?.callCount ?? 0).toLocaleString('zh-CN')}
                  />
                  <DetailMetric
                    label="上下文"
                    value={`${formatTokens(usage?.contextTokens ?? 0)} tokens`}
                  />
                  <DetailMetric label="归属" value="全局" tone="muted" />
                </div>
                <section className="capability-detail-section">
                  <h3>连接信息</h3>
                  <dl className="capability-detail-list capability-detail-list--grid">
                    <div className="capability-detail-card">
                      <dt>Endpoint</dt>
                      <dd className="is-endpoint">{server.endpoint || '未设置'}</dd>
                    </div>
                    {server.transport === 'remote-http' ? (
                      <div className="capability-detail-card">
                        <dt>鉴权状态</dt>
                        <dd>
                          <span
                            className={
                              server.authConfigured
                                ? 'capability-status-chip is-ok'
                                : 'capability-status-chip is-warn'
                            }
                          >
                            {server.authConfigured
                              ? `已配置${server.authScheme === 'api-key' ? ' API Key' : ' Bearer Token'}`
                              : '未配置'}
                          </span>
                        </dd>
                      </div>
                    ) : null}
                    <div className="capability-detail-card">
                      <dt>传输方式</dt>
                      <dd>{server.transport === 'remote-http' ? '远程 HTTP' : '本地 stdio'}</dd>
                    </div>
                    <div className="capability-detail-card">
                      <dt>可信状态</dt>
                      <dd>
                        <span
                          className={
                            server.trusted
                              ? 'capability-status-chip is-ok'
                              : 'capability-status-chip is-warn'
                          }
                        >
                          {server.trusted ? '可信来源' : '未标记可信'}
                        </span>
                      </dd>
                    </div>
                    <div className="capability-detail-card">
                      <dt>超时</dt>
                      <dd>{server.timeoutMs.toLocaleString('zh-CN')} ms</dd>
                    </div>
                    <div className="capability-detail-card">
                      <dt>输出上限</dt>
                      <dd>{formatTokens(server.maxOutputBytes)} bytes</dd>
                    </div>
                  </dl>
                </section>
                <section className="capability-detail-section">
                  <div className="capability-detail-section__heading">
                    <h3>已发现工具</h3>
                    <span>{server.tools.length}</span>
                  </div>
                  {server.tools.length > 0 ? (
                    <div className="capability-mcp-tool-list">
                      {server.tools.map((tool) => (
                        <McpToolItem
                          key={tool.name}
                          name={tool.name}
                          description={tool.description || '未提供工具说明'}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="capability-inspection is-warning">
                      <AlertTriangle size={15} />
                      <div>
                        <strong>尚未发现工具</strong>
                        <span>刷新服务连接后，工具才会进入 MCP 发现目录。</span>
                      </div>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <section className="capability-detail-section">
                <h3>模板配置</h3>
                <dl className="capability-detail-list">
                  <div>
                    <dt>Endpoint</dt>
                    <dd>{marketItem?.endpoint}</dd>
                  </div>
                  <div>
                    <dt>类别</dt>
                    <dd>{marketItem?.category}</dd>
                  </div>
                </dl>
              </section>
            )}
          </div>

          <footer className="capability-drawer__footer">
            {server ? (
              <>
                {server.transport === 'remote-http' ? (
                  <button
                    type="button"
                    data-testid="mcp-configure-key"
                    className="capability-button is-secondary"
                    disabled={props.busy}
                    onClick={() => props.onConfigureAuth(server)}
                  >
                    <KeyRound size={13} />
                    {server.authConfigured ? '更新 Key' : '配置 Key'}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="mcp-detail-refresh"
                  className="capability-button capability-button--primary"
                  disabled={props.busy}
                  onClick={() => props.onRefresh(server)}
                >
                  {props.busy ? (
                    <Loader2 className="animate-spin" size={13} />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  刷新工具
                </button>
                <button
                  type="button"
                  data-testid="mcp-detail-delete"
                  className="capability-button is-danger"
                  disabled={props.busy}
                  onClick={() => props.onDeleteMcp(server)}
                >
                  <Trash2 size={13} />
                  删除
                </button>
              </>
            ) : marketItem ? (
              <button
                type="button"
                className="capability-button capability-button--primary"
                onClick={() => {
                  props.onOpenChange(false);
                  props.onRegister(marketItem);
                }}
              >
                <Plus size={13} />
                使用此模板
              </button>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailMetric(props: {
  label: string;
  value: string;
  tone?: 'success' | 'muted';
}): JSX.Element {
  return (
    <div
      className={
        props.tone ? `capability-detail-metric is-${props.tone}` : 'capability-detail-metric'
      }
    >
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function readFrontmatterField(source: string, field: string): string {
  const match = new RegExp(`^${field}:\\s*(.*)$`, 'm').exec(source);
  return match?.[1]?.trim() ?? '';
}

function SkillEditorDialog(props: {
  state?: SkillEditorState;
  saving: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onSubmit(source: string): void;
}): JSX.Element {
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [fileError, setFileError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = props.state?.source ?? '';
    setSource(next);
    setName(readFrontmatterField(next, 'name'));
    setDescription(readFrontmatterField(next, 'description'));
    setVersion(readFrontmatterField(next, 'version') || '1.0.0');
    setFileError(undefined);
  }, [props.state]);

  const updateField = (field: 'name' | 'description' | 'version', value: string) => {
    if (field === 'name') setName(value);
    if (field === 'description') setDescription(value);
    if (field === 'version') setVersion(value);
    setSource((current) =>
      replaceSkillFrontmatter(current, {
        name: field === 'name' ? value : name,
        description: field === 'description' ? value : description,
        version: field === 'version' ? value : version,
      }),
    );
  };

  const handleSourceChange = (value: string) => {
    setFileError(undefined);
    setSource(value);
    setName(readFrontmatterField(value, 'name'));
    setDescription(readFrontmatterField(value, 'description'));
    setVersion(readFrontmatterField(value, 'version') || '1.0.0');
  };

  return (
    <Dialog.Root
      open={Boolean(props.state)}
      onOpenChange={(open) => {
        if (!open && props.saving) return;
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-dialog capability-dialog--editor">
          <header className="capability-dialog__header">
            <div>
              <Dialog.Title>
                {props.state?.mode === 'edit' ? '编辑 Skill' : '创建 Skill'}
              </Dialog.Title>
              <Dialog.Description>
                {props.state?.skill?.originType === 'market'
                  ? '市场原版不会被覆盖，保存后创建本地派生版本。'
                  : '每次保存都会创建一个不可变的新版本。'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="capability-icon-button"
                aria-label="关闭 Skill 编辑"
                disabled={props.saving}
              >
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>

          <div className="capability-dialog__body capability-skill-editor">
            <div className="capability-skill-editor__identity">
              <span>
                <Sparkles size={20} />
              </span>
              <label className="capability-skill-editor__field">
                <span>
                  <FileCode2 size={12} /> 名称
                </span>
                <input
                  value={name}
                  onChange={(event) => updateField('name', event.target.value)}
                  placeholder="my-skill"
                />
              </label>
              <label className="capability-skill-editor__field">
                <span>
                  <CircleGauge size={12} /> 版本
                </span>
                <input
                  value={version}
                  onChange={(event) => updateField('version', event.target.value)}
                  placeholder="1.0.0"
                />
              </label>
            </div>
            <label className="capability-form-field">
              <span>
                <BookOpen size={13} /> 描述
              </span>
              <textarea
                value={description}
                onChange={(event) => updateField('description', event.target.value)}
                placeholder="用一句话说明这个 Skill 的作用"
                rows={2}
              />
            </label>
            <div className="capability-editor-toolbar">
              <span>
                <FileCode2 size={13} /> SKILL.md
              </span>
              <button
                type="button"
                className="capability-button is-secondary"
                disabled={props.saving}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={12} />
                导入文件
              </button>
              <input
                ref={fileRef}
                data-testid="skill-file-input"
                type="file"
                accept=".md,text/markdown,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  setFileError(undefined);
                  if (file.size > MAX_SKILL_MD_CHARS) {
                    setFileError(
                      `文件超过 ${MAX_SKILL_MD_CHARS.toLocaleString('zh-CN')} 字节限制，请缩小后重试。`,
                    );
                    return;
                  }
                  void file
                    .text()
                    .then((text) => {
                      const normalized = text.replace(/^\uFEFF/, '');
                      if (normalized.length > MAX_SKILL_MD_CHARS) {
                        setFileError(
                          `SKILL.md 超过 ${MAX_SKILL_MD_CHARS.toLocaleString('zh-CN')} 字符限制。`,
                        );
                        return;
                      }
                      handleSourceChange(normalized);
                    })
                    .catch(() => setFileError('文件读取失败，请确认文件可访问后重试。'));
                }}
              />
              <em>
                {source.length.toLocaleString('zh-CN')} /{' '}
                {MAX_SKILL_MD_CHARS.toLocaleString('zh-CN')}
              </em>
            </div>
            <textarea
              data-testid="skill-md-input"
              className="capability-code-editor"
              value={source}
              spellCheck={false}
              onChange={(event) => handleSourceChange(event.target.value)}
            />
            {fileError || props.error ? (
              <div className="capability-inline-error" role="alert">
                <AlertTriangle size={14} />
                {fileError ?? props.error}
              </div>
            ) : null}
          </div>

          <footer className="capability-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="capability-button is-quiet" disabled={props.saving}>
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="import-skill-submit"
              className="capability-button capability-button--primary"
              disabled={
                props.saving || !source.trim() || !name.trim() || source.length > MAX_SKILL_MD_CHARS
              }
              onClick={() => props.onSubmit(source)}
            >
              {props.saving ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />}
              {props.saving ? '保存中' : '保存'}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SkillRemoteImportDialog(props: {
  open: boolean;
  loading: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onSubmit(url: string): void;
}): JSX.Element {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (props.open) return;
    setUrl('');
  }, [props.open]);

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-dialog capability-dialog--remote-import">
          <header className="capability-dialog__header">
            <div>
              <Dialog.Title>导入远端 Skill</Dialog.Title>
              <Dialog.Description>
                从公开 HTTP(S) 地址读取 SKILL.md，校验后保存为本地版本。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="capability-icon-button"
                aria-label="关闭远端 Skill 导入"
                disabled={props.loading}
              >
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>
          <div className="capability-dialog__body capability-remote-import-form">
            <label className="capability-form-field">
              <span>
                <Link2 size={13} /> SKILL.md 地址
              </span>
              <input
                data-testid="skill-remote-url-input"
                type="url"
                value={url}
                spellCheck={false}
                placeholder="https://raw.githubusercontent.com/org/repo/main/SKILL.md"
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && url.trim() && !props.loading) {
                    event.preventDefault();
                    props.onSubmit(url);
                  }
                }}
              />
              <small>支持 GitHub blob 地址；内容仅作为文本解析，脚本不会执行。</small>
            </label>
            <div className="capability-remote-import-note">
              <CloudDownload size={15} />
              <div>
                <strong>来源会被记录</strong>
                <span>导入后可在“我的 Skill”中查看远端来源并继续编辑。</span>
              </div>
            </div>
            {props.error ? (
              <div className="capability-inline-error" role="alert">
                <AlertTriangle size={14} />
                {props.error}
              </div>
            ) : null}
          </div>
          <footer className="capability-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="capability-button is-quiet" disabled={props.loading}>
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="skill-remote-import-submit"
              className="capability-button capability-button--primary"
              disabled={props.loading || !url.trim()}
              onClick={() => props.onSubmit(url)}
            >
              {props.loading ? (
                <Loader2 className="animate-spin" size={13} />
              ) : (
                <CloudDownload size={13} />
              )}
              {props.loading ? '获取中' : '获取并导入'}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SkillSourceDialog(props: {
  skill?: SkillVersionSummary;
  onOpenChange(open: boolean): void;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const skill = props.skill;
    const api = runtimeBridge();
    if (!skill || !api?.getSkill) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setSource('');
    void api
      .getSkill({ skillVersionId: skill.skillVersionId })
      .then((response) => {
        if (!cancelled) setSource(response.sourceMd);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(capabilityErrorMessage(cause, '读取 SKILL.md 失败'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.skill]);

  return (
    <Dialog.Root open={Boolean(props.skill)} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-dialog capability-dialog--source">
          <header className="capability-dialog__header">
            <div>
              <Dialog.Title>SKILL.md 源码</Dialog.Title>
              <Dialog.Description>{props.skill?.name} · 只读查看</Dialog.Description>
            </div>
            <div className="capability-dialog__header-actions">
              <button
                type="button"
                className="capability-button is-secondary"
                disabled={!source}
                onClick={() => {
                  void navigator.clipboard?.writeText(source);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_200);
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? '已复制' : '复制'}
              </button>
              <Dialog.Close asChild>
                <button type="button" className="capability-icon-button" aria-label="关闭源码">
                  <X size={17} />
                </button>
              </Dialog.Close>
            </div>
          </header>
          <div className="capability-dialog__body">
            {loading ? (
              <LoadingState label="正在读取源码..." />
            ) : error ? (
              <div className="capability-inline-error">
                <AlertTriangle size={14} />
                {error}
              </div>
            ) : (
              <pre className="capability-source-view">{source}</pre>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SkillPublishDialog(props: {
  open: boolean;
  skillVersionId?: string;
  families: SkillFamily[];
  onSkillVersionChange(value?: string): void;
  onOpenChange(open: boolean): void;
  onMessage(message: string): void;
  onError(message: string): void;
}): JSX.Element {
  const { families, skillVersionId, open, onError } = props;
  const selectedSkill = useMemo(
    () =>
      families
        .flatMap((family) => family.versions)
        .find((skill) => skill.skillVersionId === skillVersionId),
    [families, skillVersionId],
  );
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('开发工具');
  const [version, setVersion] = useState('1.0.0');
  const [icon, setIcon] = useState('sparkles');
  const [skillMd, setSkillMd] = useState('');
  const [draft, setDraft] = useState<SkillPublishDraftSummary>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const api = runtimeBridge();
    if (!open || !selectedSkill || !api?.getSkill) return;
    let cancelled = false;
    setLoading(true);
    setDraft(undefined);
    void api
      .getSkill({ skillVersionId: selectedSkill.skillVersionId })
      .then((response) => {
        if (cancelled) return;
        setDisplayName(response.skill.name);
        setDescription(response.skill.description);
        setVersion(response.skill.version);
        setSkillMd(response.sourceMd);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          onError(capabilityErrorMessage(cause, '读取发布内容失败'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onError, selectedSkill]);

  const saveDraft = async (): Promise<SkillPublishDraftSummary | undefined> => {
    const api = runtimeBridge();
    if (!api?.saveSkillPublishDraft || !selectedSkill || saving) return undefined;
    setSaving(true);
    try {
      const response = await api.saveSkillPublishDraft({
        id: draft?.id,
        skillVersionId: selectedSkill.skillVersionId,
        skillId: selectedSkill.skillId,
        displayName,
        description,
        skillMd,
        category,
        version,
        icon,
        attachments: [],
      });
      setDraft(response.draft);
      props.onMessage('发布草稿已保存在本地');
      return response.draft;
    } catch (cause) {
      props.onError(capabilityErrorMessage(cause, '保存发布草稿失败'));
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = async () => {
    const api = runtimeBridge();
    if (!api?.submitSkillPublishDraft || saving) return;
    const saved = draft ?? (await saveDraft());
    if (!saved) return;
    setSaving(true);
    try {
      const response = await api.submitSkillPublishDraft({ id: saved.id });
      props.onMessage(`${response.message}，草稿已保存在本地`);
    } catch (cause) {
      props.onError(capabilityErrorMessage(cause, '提交发布草稿失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && saving) return;
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-dialog capability-dialog--publish">
          <header className="capability-dialog__header">
            <div>
              <Dialog.Title>发布 Skill</Dialog.Title>
              <Dialog.Description>当前仅保存本地草稿；市场审核渠道筹备中。</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="capability-icon-button"
                aria-label="关闭发布 Skill"
                disabled={saving}
              >
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>

          <div className="capability-dialog__body capability-publish-form">
            {loading ? (
              <LoadingState label="正在准备发布表单..." />
            ) : (
              <>
                <label className="capability-form-field">
                  <span>选择 Skill</span>
                  <select
                    value={props.skillVersionId ?? ''}
                    onChange={(event) =>
                      props.onSkillVersionChange(event.target.value || undefined)
                    }
                  >
                    {props.families.map((family) => (
                      <option
                        key={family.latest.skillVersionId}
                        value={family.latest.skillVersionId}
                      >
                        {family.latest.name} · v{family.latest.version}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="capability-publish-grid">
                  <label className="capability-form-field">
                    <span>Skill 标识</span>
                    <input value={selectedSkill?.skillId ?? ''} readOnly />
                  </label>
                  <label className="capability-form-field">
                    <span>显示名称</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                </div>
                <label className="capability-form-field">
                  <span>描述</span>
                  <textarea
                    value={description}
                    rows={3}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label className="capability-form-field">
                  <span>SKILL.md 内容</span>
                  <textarea
                    className="capability-code-editor is-publish"
                    value={skillMd}
                    spellCheck={false}
                    onChange={(event) => setSkillMd(event.target.value)}
                  />
                  <small>{skillMd.length.toLocaleString('zh-CN')} 字符</small>
                </label>
                <div className="capability-publish-grid is-three">
                  <label className="capability-form-field">
                    <span>分类</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value)}>
                      {SKILL_CATEGORIES.filter((item) => item !== '全部').map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="capability-form-field">
                    <span>版本</span>
                    <input value={version} onChange={(event) => setVersion(event.target.value)} />
                  </label>
                  <label className="capability-form-field">
                    <span>图标</span>
                    <select value={icon} onChange={(event) => setIcon(event.target.value)}>
                      <option value="sparkles">Sparkles</option>
                      <option value="package">Package</option>
                      <option value="code">Code</option>
                    </select>
                  </label>
                </div>
                <div className="capability-publish-channel-note">
                  <Globe2 size={14} />
                  <div>
                    <strong>市场审核渠道筹备中</strong>
                    <span>提交操作会保留完整本地草稿，不会覆盖当前 Skill。</span>
                  </div>
                </div>
              </>
            )}
          </div>

          <footer className="capability-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="capability-button is-quiet" disabled={saving}>
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="capability-button is-secondary"
              disabled={saving || !selectedSkill || !displayName.trim() || !skillMd.trim()}
              onClick={() => void saveDraft()}
            >
              {saving ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />}
              保存草稿
            </button>
            <button
              type="button"
              className="capability-button capability-button--primary"
              disabled={saving || !selectedSkill || !displayName.trim() || !skillMd.trim()}
              onClick={() => void submitDraft()}
            >
              <Send size={13} />
              提交审核
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function McpRegisterDialog(props: {
  item: McpRegistrationPreset | null | undefined;
  open: boolean;
  saving: boolean;
  error?: string;
  onOpenChange(open: boolean): void;
  onSubmit(payload: {
    name: string;
    transport: 'local-stdio' | 'remote-http';
    endpoint: string;
    notes: string;
    trusted: boolean;
    apiKey?: string;
    authScheme?: 'api-key' | 'bearer';
    discoverTools?: boolean;
  }): void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'local-stdio' | 'remote-http'>('local-stdio');
  const [endpoint, setEndpoint] = useState('');
  const [notes, setNotes] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [authScheme, setAuthScheme] = useState<'api-key' | 'bearer'>('api-key');
  const [discoverTools, setDiscoverTools] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const existingServer = props.item && 'mcpServerId' in props.item ? props.item : undefined;

  useEffect(() => {
    setName(props.item?.name ?? '');
    setTransport(props.item?.transport === 'remote-http' ? 'remote-http' : 'local-stdio');
    setEndpoint(props.item?.endpoint ?? '');
    setNotes(props.item?.notes ?? '');
    setTrusted(existingServer?.trusted ?? Boolean(props.item));
    // Echo the latest stored key back into the dialog (plaintext storage).
    const storedKey = existingServer?.authKey?.trim() ?? '';
    if (apiKeyRef.current) apiKeyRef.current.value = storedKey;
    setHasApiKey(Boolean(storedKey));
    setAuthScheme(existingServer?.authScheme === 'bearer' ? 'bearer' : 'api-key');
    setDiscoverTools(true);
    setShowApiKey(false);
  }, [existingServer, props.item, props.open]);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && props.saving) return;
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-dialog capability-dialog--register">
          <header className="capability-dialog__header">
            <div>
              <Dialog.Title>{existingServer ? '配置远端 MCP' : '注册 MCP'}</Dialog.Title>
              <Dialog.Description>
                {existingServer
                  ? '服务信息已由 AI 或现有配置登记，只需输入一次服务 Key。'
                  : transport === 'remote-http'
                    ? '登记远端地址并安全保存服务 Key，可自动发现远端工具。'
                    : '保存本地服务配置并同步到 MCP 发现目录。'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="capability-icon-button"
                aria-label="关闭 MCP 注册"
                disabled={props.saving}
              >
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>
          <div className="capability-dialog__body capability-register-form">
            <section className="capability-register-section">
              <h4 className="capability-register-section__title">服务配置</h4>
              <label className="capability-form-field">
                <span>名称</span>
                <input
                  data-testid="mcp-name-input"
                  value={name}
                  readOnly={Boolean(existingServer)}
                  placeholder="例如 Workspace Files"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="capability-publish-grid">
                <label className="capability-form-field">
                  <span>传输方式</span>
                  <span className="capability-select-wrap">
                    <select
                      data-testid="mcp-transport-select"
                      value={transport}
                      disabled={Boolean(existingServer)}
                      onChange={(event) => {
                        const nextTransport = event.target.value as 'local-stdio' | 'remote-http';
                        setTransport(nextTransport);
                        setHasApiKey(false);
                      }}
                    >
                      <option value="local-stdio">本地进程（stdio）</option>
                      <option value="remote-http">远程 HTTP</option>
                    </select>
                    <ChevronDown size={13} className="capability-select-chevron" />
                  </span>
                </label>
                <label className="capability-form-field">
                  <span>
                    {transport === 'local-stdio' ? <Server size={13} /> : <Globe2 size={13} />}
                    {transport === 'local-stdio' ? '启动命令' : '远程 Endpoint'}
                  </span>
                  <input
                    data-testid="mcp-endpoint-input"
                    value={endpoint}
                    readOnly={Boolean(existingServer)}
                    spellCheck={false}
                    placeholder={
                      transport === 'local-stdio' ? '填写 MCP 启动命令' : 'https://mcp.example.com'
                    }
                    onChange={(event) => setEndpoint(event.target.value)}
                  />
                </label>
              </div>
            </section>
            {transport === 'remote-http' ? (
              <section className="capability-register-section">
                <h4 className="capability-register-section__title">远端鉴权</h4>
                <div className="capability-remote-auth-grid">
                  <label className="capability-form-field">
                    <span>
                      <KeyRound size={13} /> 鉴权方式
                    </span>
                    <span className="capability-select-wrap">
                      <select
                        value={authScheme}
                        onChange={(event) =>
                          setAuthScheme(event.target.value as 'api-key' | 'bearer')
                        }
                      >
                        <option value="api-key">API Key</option>
                        <option value="bearer">Bearer Token</option>
                      </select>
                      <ChevronDown size={13} className="capability-select-chevron" />
                    </span>
                  </label>
                  <label className="capability-form-field">
                    <span>
                      <KeyRound size={13} /> 服务 Key
                    </span>
                    <div className="capability-secret-input">
                      <input
                        ref={apiKeyRef}
                        defaultValue={existingServer?.authKey ?? ''}
                        data-testid="mcp-api-key-input"
                        type={showApiKey ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder={existingServer?.authKey ? '' : '输入服务 Key'}
                        onChange={(event) => setHasApiKey(Boolean(event.target.value.trim()))}
                      />
                      <button
                        type="button"
                        className="capability-icon-button"
                        aria-label={showApiKey ? '隐藏服务 Key' : '显示服务 Key'}
                        onClick={() => setShowApiKey((value) => !value)}
                      >
                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </label>
                </div>
                <label className="capability-check-option">
                  <input
                    type="checkbox"
                    checked={discoverTools}
                    onChange={(event) => setDiscoverTools(event.target.checked)}
                  />
                  <span>
                    <strong>注册后自动发现工具</strong>
                    <small>连接成功后把远端工具声明同步到 MCP 目录。</small>
                  </span>
                </label>
              </section>
            ) : null}
            <section className="capability-register-section">
              <h4 className="capability-register-section__title">其他设置</h4>
              <label className="capability-form-field">
                <span>备注</span>
                <textarea
                  value={notes}
                  rows={3}
                  placeholder="记录用途、运行环境或维护说明"
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={
                  trusted ? 'capability-trust-option is-active' : 'capability-trust-option'
                }
                onClick={() => setTrusted((value) => !value)}
              >
                <span>{trusted ? <Check size={11} /> : null}</span>
                <div>
                  <strong>标记为可信来源</strong>
                  <small>未标记时，工具输出会按照不可信内容处理。</small>
                </div>
              </button>
            </section>
            {props.error ? (
              <div className="capability-inline-error" role="alert">
                <AlertTriangle size={14} />
                {props.error}
              </div>
            ) : null}
          </div>
          <footer className="capability-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="capability-button is-quiet" disabled={props.saving}>
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="mcp-register-submit"
              className="capability-button capability-button--primary"
              disabled={
                props.saving ||
                !name.trim() ||
                !endpoint.trim() ||
                (transport === 'remote-http' && !hasApiKey)
              }
              onClick={() => {
                const apiKey = apiKeyRef.current?.value.trim();
                props.onSubmit({
                  name: name.trim(),
                  transport,
                  endpoint: endpoint.trim(),
                  notes: notes.trim(),
                  trusted,
                  ...(transport === 'remote-http' && apiKey
                    ? { apiKey, authScheme, discoverTools }
                    : {}),
                });
              }}
            >
              {props.saving ? <Loader2 className="animate-spin" size={13} /> : <Plug size={13} />}
              {props.saving
                ? '保存中'
                : existingServer
                  ? '保存 Key 并发现工具'
                  : transport === 'remote-http'
                    ? '注册远端 MCP'
                    : '注册 MCP'}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OrganizeReportDialog(props: {
  report?: CapabilityOrganizeReportSummary;
  capabilityNames: Map<string, string>;
  onOpenChange(open: boolean): void;
}): JSX.Element {
  const report = props.report;
  const sections: Array<{
    key: keyof CapabilityOrganizeReportSummary['categories'];
    title: string;
    description: string;
  }> = [
    { key: 'unused', title: '长期未使用', description: '45 天内没有调用记录' },
    { key: 'inactive', title: '未激活', description: '当前工作区没有激活' },
    { key: 'problematic', title: '存在问题', description: '近期失败、取消或发现异常' },
    {
      key: 'contextWarning',
      title: '上下文提醒',
      description: '上下文消耗已接近建议预算',
    },
    { key: 'highContext', title: '高上下文', description: '上下文消耗超过建议预算' },
  ];

  return (
    <Dialog.Root open={Boolean(report)} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="capability-dialog-overlay" />
        <Dialog.Content className="capability-dialog capability-dialog--organize">
          <header className="capability-dialog__header">
            <div>
              <Dialog.Title>能力整理报告</Dialog.Title>
              <Dialog.Description>
                只读预览 · 不会修改任何全局启用或工作区激活状态
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="capability-icon-button" aria-label="关闭整理报告">
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>
          <div className="capability-dialog__body capability-organize-report">
            {report ? (
              <>
                <div className="capability-organize-summary">
                  <DetailMetric label="能力总数" value={String(report.summary.capabilityCount)} />
                  <DetailMetric label="长期未用" value={String(report.summary.unusedCount)} />
                  <DetailMetric
                    label="有问题"
                    value={String(report.summary.problematicCount)}
                    tone={report.summary.problematicCount > 0 ? 'muted' : 'success'}
                  />
                  <DetailMetric
                    label="上下文预算"
                    value={`${formatTokens(report.contextBudgetTokens)} tokens`}
                  />
                </div>
                <div className="capability-organize-sections">
                  {sections.map((section) => {
                    const ids = report.categories[section.key];
                    return (
                      <section key={section.key}>
                        <div>
                          <h3>{section.title}</h3>
                          <p>{section.description}</p>
                        </div>
                        {ids.length > 0 ? (
                          <ul>
                            {ids.map((id) => (
                              <li key={id}>
                                <span>{props.capabilityNames.get(id) ?? id}</span>
                                <small>{id}</small>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="capability-organize-empty">
                            <CheckCircle2 size={13} />
                            没有匹配项
                          </span>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
          <footer className="capability-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="capability-button capability-button--primary">
                完成
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
