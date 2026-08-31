import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AlertTriangle,
  ArrowLeft,
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
  Edit3,
  FileCode2,
  Folder,
  Globe2,
  KeyRound,
  Layers3,
  Link2,
  Loader2,
  PackageOpen,
  Play,
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
import { SlidingTabs } from '../SlidingTabs.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useDialog } from '../Dialog.js';
import type {
  CapabilityGovernanceListResponse,
  CapabilityOrganizeReportSummary,
  CapabilityUsageSummary,
  GovernedMcpServerSummary,
  GovernedSkillSummary,
  ImportSkillResponse,
  McpServerSummary,
  SkillLocalImportPayload,
  SkillLocalInspectItem,
  SkillLocalInstallScope,
  SkillMarketItemSummary,
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
type CatalogTab = 'market' | 'mine' | 'local';
type StatusFilter = 'all' | 'active' | 'enabled' | 'inactive' | 'unused' | 'problem';
type SourceFilter = 'all' | 'market' | 'local' | 'derived';

type SkillEditorState = {
  mode: 'create' | 'edit';
  skill?: SkillVersionSummary;
  source: string;
};

type SkillMetadataEditorState = {
  skillName: string;
  displayName: string;
  description: string;
  icon: string;
};

type McpRegistrationPreset = McpMarketItem | McpServerSummary;

type LocalSkillInstallRequest = {
  path: string;
  scopes: SkillLocalInstallScope[];
  name: string;
  description: string;
  icon?: string;
};

type LocalSkillDisplayMetadata = {
  displayName?: string;
  description?: string;
  icon?: string;
};

const LOCAL_SKILL_METADATA_KEY = 'sync-think.skill-metadata.v1';
const SKILL_ICON_EMOJIS = ['✨', '🧰', '🧠', '📝', '🔎', '⚙️', '📊', '🎨', '🚀', '🛡️'];

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

function localSkillScopeKey(scope: SkillLocalInstallScope): string {
  return scope.type === 'global' ? 'global' : `workspace:${scope.workspaceId}`;
}

function portableBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function readLocalSkillMetadata(): Record<string, LocalSkillDisplayMetadata> {
  try {
    const stored = window.localStorage.getItem(LOCAL_SKILL_METADATA_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, LocalSkillDisplayMetadata>)
      : {};
  } catch {
    return {};
  }
}

function persistLocalSkillMetadata(
  skillNames: readonly string[],
  metadata: LocalSkillDisplayMetadata,
): Record<string, LocalSkillDisplayMetadata> {
  const current = readLocalSkillMetadata();
  if (skillNames.length !== 1) return current;
  try {
    current[skillNames[0]!] = metadata;
    window.localStorage.setItem(LOCAL_SKILL_METADATA_KEY, JSON.stringify(current));
  } catch {
    // Metadata is optional; a blocked localStorage must not roll back the Skill install.
  }
  return current;
}

function resizeSkillIcon(file: File, size = 128, maxChars = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图标文件读取失败'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('图标文件读取失败'));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error('图标图片格式无效'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('图标处理不可用'));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        let quality = 0.8;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxChars && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

export type AbilityCenterInitialView = 'create-skill';

export interface AbilitiesPageProps {
  activeWorkspaceId?: string;
  workspaces?: WorkspaceSummary[];
  initialView?: AbilityCenterInitialView;
  navigationKey?: string | number;
  onGoToAgents(): void;
  onCatalogChanged?(): void;
}

export function AbilitiesPage(props: AbilitiesPageProps): JSX.Element {
  const dialog = useDialog();
  const workspaces = useMemo(() => props.workspaces ?? [], [props.workspaces]);
  const onCatalogChanged = props.onCatalogChanged;
  const fallbackWorkspaceId =
    props.activeWorkspaceId ?? workspaces[0]?.workspaceId ?? 'default-workspace';
  const [section, setSection] = useState<AbilitySection>('skills');
  const [tab, setTab] = useState<CatalogTab>('market');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(fallbackWorkspaceId);
  const [selectedSkillScope, setSelectedSkillScope] = useState('global');
  const [skills, setSkills] = useState<SkillVersionSummary[]>([]);
  const [marketSkills, setMarketSkills] = useState<SkillMarketItemSummary[]>([]);
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [localCandidates, setLocalCandidates] = useState<
    import('@sync-think/protocol').LocalSkillCandidate[]
  >([]);
  const [localSkillMetadata, setLocalSkillMetadata] = useState(readLocalSkillMetadata);
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
  const [skillEditor, setSkillEditor] = useState<SkillEditorState | undefined>(() =>
    props.initialView === 'create-skill'
      ? { mode: 'create', source: newSkillTemplate() }
      : undefined,
  );
  const [skillMetadataEditor, setSkillMetadataEditor] = useState<SkillMetadataEditorState>();
  const [localSkillImportOpen, setLocalSkillImportOpen] = useState(false);
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

  useEffect(() => {
    if (props.initialView !== 'create-skill') return;
    setSection('skills');
    setCreateMenuOpen(false);
    setSkillEditor({ mode: 'create', source: newSkillTemplate() });
  }, [props.initialView, props.navigationKey]);

  const loadCatalog = useCallback(
    async (options?: { background?: boolean }) => {
      const requestId = ++loadRequestRef.current;
      const api = runtimeBridge();
      if (!api?.listSkills || !api.listMcpServers) {
        setLoadError('Runtime bridge 不可用');
        setLoading(false);
        return;
      }
      if (!options?.background) setLoading(true);
      setLoadError(undefined);
      try {
        const [skillsResponse, marketResponse, mcpResponse, governanceResponse] = await Promise.all(
          [
            api.listSkills({ limit: 500 }),
            api.listSkillMarket ? api.listSkillMarket() : Promise.resolve({ items: SKILL_MARKET }),
            api.listMcpServers({ limit: 100 }),
            api.listCapabilityGovernance
              ? api.listCapabilityGovernance({ workspaceId: selectedWorkspaceId })
              : Promise.resolve(undefined),
          ],
        );
        if (requestId !== loadRequestRef.current) return;
        setSkills(skillsResponse.skills);
        setMarketSkills(marketResponse.items);
        setServers(mcpResponse.servers);
        setGovernance(governanceResponse);
      } catch (cause) {
        if (requestId !== loadRequestRef.current) return;
        setLoadError(capabilityErrorMessage(cause, '能力库加载失败'));
      } finally {
        if (requestId === loadRequestRef.current) setLoading(false);
      }
    },
    [selectedWorkspaceId],
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadLocalSkills = useCallback(async () => {
    const api = runtimeBridge();
    if (!api?.skillLocalScan) return;
    try {
      const res = await api.skillLocalScan({ refresh: true });
      setLocalCandidates(res.candidates);
      await loadCatalog({ background: true });
    } catch {
      // 扫描失败保持现状。
    }
  }, [loadCatalog]);

  useEffect(() => {
    void loadLocalSkills();
    const timer = window.setInterval(() => void loadLocalSkills(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadLocalSkills]);

  const importLocalSkill = useCallback(
    async (request: LocalSkillInstallRequest): Promise<boolean> => {
      const api = runtimeBridge();
      if (!api?.skillLocalImport || busyId) return false;
      setBusyId('skill-local-import');
      setError(undefined);
      try {
        const scopeLabel = (scope: SkillLocalInstallScope): string =>
          scope.type === 'global'
            ? '全局'
            : (workspaces.find((workspace) => workspace.workspaceId === scope.workspaceId)?.name ??
              scope.workspaceId);
        const runInstall = async (overwrite: boolean) => {
          const successes: Awaited<ReturnType<typeof api.skillLocalImport>>[] = [];
          const failures: Array<{ label: string; message: string }> = [];
          const conflicts = new Set<string>();
          for (const scope of request.scopes) {
            const payload: SkillLocalImportPayload = {
              path: request.path,
              scope,
              ...(overwrite ? { overwrite: true } : {}),
            };
            try {
              const result = await api.skillLocalImport(payload);
              if (result.conflictNames.length > 0) {
                for (const name of result.conflictNames) conflicts.add(name);
              } else if (result.imports.length > 0) {
                successes.push(result);
              } else {
                failures.push({ label: scopeLabel(scope), message: '没有生成可用的 Skill' });
              }
            } catch (cause) {
              failures.push({
                label: scopeLabel(scope),
                message: capabilityErrorMessage(cause, '导入失败'),
              });
            }
          }
          return { successes, failures, conflicts: [...conflicts] };
        };

        let outcome = await runInstall(false);
        if (outcome.conflicts.length > 0) {
          const confirmed = await dialog.confirm({
            title: '覆盖已有 Skill',
            message: `以下 Skill 已存在：${outcome.conflicts.join('、')}。是否覆盖对应文件夹？`,
            confirmText: '覆盖并导入',
            danger: true,
          });
          if (!confirmed) return false;
          outcome = await runInstall(true);
        }
        if (outcome.successes.length === 0) {
          const detail = outcome.failures
            .map((failure) => `${failure.label}：${failure.message}`)
            .join('；');
          throw new Error(detail || '导入完成，但没有生成可用的 Skill');
        }

        const skillNames = [...new Set(outcome.successes.flatMap((result) => result.skillNames))];
        setLocalSkillMetadata(
          persistLocalSkillMetadata(skillNames, {
            displayName: request.name.trim(),
            ...(request.description.trim() ? { description: request.description.trim() } : {}),
            ...(request.icon ? { icon: request.icon } : {}),
          }),
        );
        await loadLocalSkills();
        onCatalogChanged?.();
        const locationSuffix =
          outcome.successes.length > 1 ? `，共 ${outcome.successes.length} 个位置` : '';
        setMessage(
          skillNames.length === 1
            ? `已导入 Skill：${skillNames[0]}${locationSuffix}`
            : `已导入 ${skillNames.length} 个 Skill${locationSuffix}`,
        );
        setTab('mine');
        if (outcome.failures.length > 0) {
          setError(
            `部分位置导入失败：${outcome.failures
              .map((failure) => `${failure.label}：${failure.message}`)
              .join('；')}`,
          );
          return false;
        }
        setLocalSkillImportOpen(false);
        return true;
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '导入 Skill 失败'));
        return false;
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, dialog, loadLocalSkills, onCatalogChanged, workspaces],
  );

  const editLocalSkillMetadata = useCallback(
    (skill: SkillVersionSummary) => {
      const metadata = localSkillMetadata[skill.name];
      setSkillMetadataEditor({
        skillName: skill.name,
        displayName: metadata?.displayName?.trim() || skill.name,
        description: metadata?.description?.trim() || skill.description,
        icon: metadata?.icon ?? '',
      });
    },
    [localSkillMetadata],
  );

  const saveLocalSkillMetadata = useCallback((state: SkillMetadataEditorState) => {
    setLocalSkillMetadata(
      persistLocalSkillMetadata([state.skillName], {
        ...(state.displayName.trim() ? { displayName: state.displayName.trim() } : {}),
        ...(state.description.trim() ? { description: state.description.trim() } : {}),
        ...(state.icon ? { icon: state.icon } : {}),
      }),
    );
    setSkillMetadataEditor(undefined);
  }, []);

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
  const selectedMarketSkill = marketSkills.find((item) => item.id === detailMarketSkillId);
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
      if (!api?.installSkillMarket || busyId) return;
      setBusyId(`market-skill:${item.id}`);
      setError(undefined);
      try {
        const result = await api.installSkillMarket({ marketSkillId: item.id });
        setSkills((current) => {
          const remaining = current.filter(
            (skill) => skill.skillVersionId !== result.skill.skillVersionId,
          );
          return [...remaining, result.skill];
        });
        setMessage(skillImportMessage(result));
        setDetailMarketSkillId(undefined);
        setDetailSkillVersionId(result.skill.skillVersionId);
        setTab('mine');
        notifyCatalogChanged();
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '安装 Skill 失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, notifyCatalogChanged],
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
      setSkills((current) =>
        current.map((item) =>
          item.skillVersionId === skill.skillVersionId ? { ...item, enabled } : item,
        ),
      );
      try {
        const response = await api.setSkillEnabled({
          skillVersionId: skill.skillVersionId,
          enabled,
        });
        setSkills((current) =>
          current.map((item) =>
            item.skillVersionId === response.skill.skillVersionId ? response.skill : item,
          ),
        );
        setGovernance((current) =>
          current
            ? {
                ...current,
                skills: current.skills.map((row) =>
                  row.skill.skillVersionId === response.skill.skillVersionId
                    ? { ...row, skill: response.skill }
                    : row,
                ),
              }
            : current,
        );
        notifyCatalogChanged();
      } catch (cause) {
        setSkills((current) =>
          current.map((item) => (item.skillVersionId === skill.skillVersionId ? skill : item)),
        );
        setError(capabilityErrorMessage(cause, '更新 Skill 全局状态失败'));
      } finally {
        setBusyId(undefined);
      }
    },
    [busyId, notifyCatalogChanged],
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
    async (
      capabilityType: 'skill' | 'mcp',
      capabilityId: string,
      active: boolean,
      workspaceId?: string,
    ): Promise<boolean> => {
      const api = runtimeBridge();
      if (!api?.setCapabilityWorkspaceActive) return false;
      const targetWorkspaceId = workspaceId ?? selectedWorkspaceId;
      setBusyId(`workspace:${capabilityType}:${capabilityId}:${targetWorkspaceId}`);
      setError(undefined);
      try {
        const response = await api.setCapabilityWorkspaceActive({
          workspaceId: targetWorkspaceId,
          capabilityType,
          capabilityId,
          active,
        });
        const nextActive = response.activation?.active ?? active;
        const targetWorkspaceName =
          workspaces.find((workspace) => workspace.workspaceId === targetWorkspaceId)?.name ??
          targetWorkspaceId;
        setGovernance((current) => {
          if (!current) return current;
          const updateWorkspaceNames = <
            T extends { workspaceActive: boolean; activeWorkspaceNames?: string[] },
          >(
            row: T,
            rowCapabilityId: string,
          ): T => {
            if (rowCapabilityId !== capabilityId) return row;
            const seededNames = row.activeWorkspaceNames?.length
              ? row.activeWorkspaceNames
              : row.workspaceActive
                ? [workspaceName]
                : [];
            const names = new Set(seededNames);
            if (nextActive) names.add(targetWorkspaceName);
            else names.delete(targetWorkspaceName);
            return {
              ...row,
              workspaceActive:
                targetWorkspaceId === selectedWorkspaceId ? nextActive : row.workspaceActive,
              activeWorkspaceNames: [...names],
            };
          };
          return {
            ...current,
            skills:
              capabilityType === 'skill'
                ? current.skills.map((row) => updateWorkspaceNames(row, row.skill.skillVersionId))
                : current.skills,
            mcpServers:
              capabilityType === 'mcp'
                ? current.mcpServers.map((row) => updateWorkspaceNames(row, row.server.mcpServerId))
                : current.mcpServers,
          };
        });
        return true;
      } catch (cause) {
        setError(capabilityErrorMessage(cause, '更新工作区激活状态失败'));
        return false;
      } finally {
        setBusyId(undefined);
      }
    },
    [selectedWorkspaceId, workspaces, workspaceName],
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

  if (section === 'skills') {
    return (
      <main className="ability-hub" data-testid="abilities-page">
        <NewMaxSkillHub
          marketItems={marketSkills}
          tab={tab === 'market' ? 'market' : 'mine'}
          query={query}
          category={skillCategory}
          statusFilter={statusFilter}
          sourceFilter={sourceFilter}
          families={families}
          governanceMap={skillGovernanceMap}
          localCandidates={localCandidates}
          localMetadata={localSkillMetadata}
          loading={loading}
          loadError={loadError}
          message={message}
          error={error}
          workspaces={workspaces}
          selectedScope={selectedSkillScope}
          selectedWorkspaceId={selectedWorkspaceId}
          workspaceName={workspaceName}
          busyId={busyId}
          createMenuOpen={createMenuOpen}
          onBack={props.onGoToAgents}
          onOpenMcp={() => {
            setQuery('');
            setSection('mcp');
          }}
          onTabChange={setTab}
          onQueryChange={setQuery}
          onCategoryChange={setSkillCategory}
          onStatusFilterChange={setStatusFilter}
          onSourceFilterChange={setSourceFilter}
          onScopeChange={(scope) => {
            setSelectedSkillScope(scope);
            if (scope !== 'global') setSelectedWorkspaceId(scope);
          }}
          onToggleCreateMenu={() => setCreateMenuOpen((open) => !open)}
          onActivationCode={() => {
            setMessage('Skill 激活码渠道筹备中');
            setError(undefined);
          }}
          onImport={() => {
            setCreateMenuOpen(false);
            setError(undefined);
            setLocalSkillImportOpen(true);
          }}
          onCreate={() => void openSkillEditor()}
          onReload={() => void loadCatalog()}
          onCloseNotice={closeNotices}
          onOpenMarket={setDetailMarketSkillId}
          onOpenSkill={setDetailSkillVersionId}
          onUseSkill={() => props.onGoToAgents()}
          onEditMetadata={editLocalSkillMetadata}
          onPublishSkill={(skill) => setPublishSkillVersionId(skill.skillVersionId)}
          onInstallMarket={(item) => void installMarketSkill(item)}
          onGlobalEnabled={(skill, enabled) => void setSkillGlobalEnabled(skill, enabled)}
          onWorkspaceActive={(skill, active, workspaceId) =>
            setWorkspaceActive('skill', skill.skillVersionId, active, workspaceId)
          }
          onOrganize={() => void previewOrganize()}
        />

        <SkillDetailDrawer
          skill={selectedSkill}
          displayMetadata={selectedSkill ? localSkillMetadata[selectedSkill.name] : undefined}
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

        <SkillEditorDialog
          state={skillEditor}
          saving={busyId === 'skill-editor'}
          error={skillEditor ? error : undefined}
          onOpenChange={(open) => {
            if (!open) setSkillEditor(undefined);
          }}
          onSubmit={(source) => void saveSkillEditor(source)}
        />

        <NewMaxSkillImportDialog
          open={localSkillImportOpen}
          loading={busyId === 'skill-local-import'}
          error={localSkillImportOpen ? error : undefined}
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onOpenChange={(open) => {
            if (!open && busyId !== 'skill-local-import') {
              setLocalSkillImportOpen(false);
              setError(undefined);
            }
          }}
          onSubmit={importLocalSkill}
        />

        <NewMaxSkillMetadataDialog
          state={skillMetadataEditor}
          onOpenChange={(open) => {
            if (!open) setSkillMetadataEditor(undefined);
          }}
          onSave={saveLocalSkillMetadata}
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

        <OrganizeReportDialog
          report={organizeReport}
          capabilityNames={new Map(skills.map((skill) => [skill.skillVersionId, skill.name]))}
          onOpenChange={(open) => {
            if (!open) setOrganizeReport(undefined);
          }}
        />
      </main>
    );
  }

  return (
    <main className="ability-hub" data-testid="abilities-page">
      <NewMaxMcpHub
        tab={tab === 'market' ? 'market' : 'mine'}
        query={query}
        category={mcpCategory}
        statusFilter={statusFilter}
        servers={servers}
        governanceMap={mcpGovernanceMap}
        loading={loading}
        loadError={loadError}
        message={message}
        error={error}
        busyId={busyId}
        onBack={props.onGoToAgents}
        onOpenSkills={() => {
          setQuery('');
          setSection('skills');
        }}
        onTabChange={setTab}
        onQueryChange={setQuery}
        onCategoryChange={setMcpCategory}
        onStatusFilterChange={setStatusFilter}
        onReload={() => void loadCatalog()}
        onCloseNotice={closeNotices}
        onOpenMarket={setDetailMarketMcpId}
        onOpenServer={setDetailMcpServerId}
        onRegister={setRegisterMcpItem}
        onGlobalEnabled={(server, enabled) => void setMcpGlobalEnabled(server, enabled)}
        onRefresh={(server) => void refreshMcpTools(server)}
        onOrganize={() => void previewOrganize()}
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

function NewMaxSkillHub(props: {
  marketItems: SkillMarketItem[];
  tab: 'market' | 'mine';
  query: string;
  category: (typeof SKILL_CATEGORIES)[number];
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
  families: SkillFamily[];
  governanceMap: Map<string, GovernedSkillSummary>;
  localCandidates: import('@sync-think/protocol').LocalSkillCandidate[];
  localMetadata: Record<string, LocalSkillDisplayMetadata>;
  loading: boolean;
  loadError?: string;
  message?: string;
  error?: string;
  workspaces: WorkspaceSummary[];
  selectedScope: string;
  selectedWorkspaceId: string;
  workspaceName: string;
  busyId?: string;
  createMenuOpen: boolean;
  onBack(): void;
  onOpenMcp(): void;
  onTabChange(tab: CatalogTab): void;
  onQueryChange(value: string): void;
  onCategoryChange(value: (typeof SKILL_CATEGORIES)[number]): void;
  onStatusFilterChange(value: StatusFilter): void;
  onSourceFilterChange(value: SourceFilter): void;
  onScopeChange(value: string): void;
  onToggleCreateMenu(): void;
  onActivationCode(): void;
  onImport(): void;
  onCreate(): void;
  onReload(): void;
  onCloseNotice(): void;
  onOpenMarket(id: string): void;
  onOpenSkill(id: string): void;
  onUseSkill(skill: SkillVersionSummary): void;
  onEditMetadata(skill: SkillVersionSummary): void;
  onPublishSkill(skill: SkillVersionSummary): void;
  onInstallMarket(item: SkillMarketItem): void;
  onGlobalEnabled(skill: SkillVersionSummary, enabled: boolean): void;
  onWorkspaceActive(
    skill: SkillVersionSummary,
    active: boolean,
    workspaceId?: string,
  ): Promise<boolean | void> | boolean | void;
  onOrganize(): void;
}): JSX.Element {
  const [sortMode, setSortMode] = useState<'triggers' | 'updated' | 'name'>('triggers');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const needle = props.query.trim().toLocaleLowerCase();
  const marketItems = props.marketItems.filter((item) => {
    const categoryMatches = props.category === '全部' || item.category === props.category;
    const searchMatches =
      !needle ||
      [item.name, item.slug, item.category, item.description]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    return categoryMatches && searchMatches;
  });
  const rows = props.families.map((family) => {
    const skill = family.latest;
    const governance = props.governanceMap.get(skill.skillVersionId);
    const metadata = props.localMetadata[skill.name];
    return {
      family,
      skill,
      display: {
        name: metadata?.displayName?.trim() || skill.name,
        description: metadata?.description?.trim() || skill.description,
      },
      usage: governance?.usage ?? defaultUsage('skill', skill.skillVersionId),
      workspaceActive: governance?.workspaceActive ?? false,
      activeWorkspaceNames: governance?.activeWorkspaceNames ?? [],
    };
  });
  const filteredRows = rows.filter(({ skill, display, usage, workspaceActive }) => {
    const enabled = skill.enabled !== false;
    const origin = skill.originType ?? 'local';
    const searchMatches =
      !needle ||
      [
        display.name,
        display.description,
        skill.name,
        skill.skillId,
        skill.version,
        skill.originRef ?? '',
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    const sourceMatches = props.sourceFilter === 'all' || origin === props.sourceFilter;
    const statusMatches =
      props.statusFilter === 'all' ||
      (props.statusFilter === 'active' && usage.callCount > 0 && workspaceActive) ||
      (props.statusFilter === 'enabled' && enabled) ||
      (props.statusFilter === 'inactive' && !enabled) ||
      (props.statusFilter === 'unused' && usage.callCount === 0) ||
      (props.statusFilter === 'problem' &&
        (usage.problemCount > 0 || skill.hasScripts || skill.warnings.length > 0));
    return searchMatches && sourceMatches && statusMatches;
  });
  const visibleRows = [...filteredRows].sort((left, right) => {
    if (sortMode === 'name') return left.display.name.localeCompare(right.display.name, 'zh-CN');
    if (sortMode === 'updated') {
      return Date.parse(right.skill.createdAt) - Date.parse(left.skill.createdAt);
    }
    return (
      right.usage.callCount - left.usage.callCount ||
      Date.parse(right.skill.createdAt) - Date.parse(left.skill.createdAt)
    );
  });
  const recentCount = rows.filter((row) => row.usage.callCount > 0).length;
  const unusedCount = rows.filter((row) => row.usage.callCount === 0).length;
  const problemCount = rows.filter(
    (row) => row.usage.problemCount > 0 || row.skill.hasScripts || row.skill.warnings.length > 0,
  ).length;
  const contextTokens = rows.reduce((sum, row) => sum + row.usage.contextTokens, 0);
  const sourceCounts: Record<SourceFilter, number> = {
    all: rows.length,
    market: rows.filter((row) => row.skill.originType === 'market').length,
    local: rows.filter((row) => (row.skill.originType ?? 'local') === 'local').length,
    derived: rows.filter((row) => row.skill.originType === 'derived').length,
  };
  const statusCounts: Record<Exclude<StatusFilter, 'problem'>, number> = {
    all: rows.length,
    active: rows.filter((row) => row.usage.callCount > 0 && row.workspaceActive).length,
    enabled: rows.filter((row) => row.skill.enabled !== false).length,
    inactive: rows.filter((row) => row.skill.enabled === false).length,
    unused: unusedCount,
  };

  const locationOf = (skill: SkillVersionSummary): string => {
    if (skill.originType === 'market') return '市场安装';
    if (skill.originType === 'derived') return '共享';
    const path = skill.originRef?.toLocaleLowerCase();
    // 库内导入的 skill 没有磁盘来源（originRef 为空），不属于任何安装目录
    if (!path) return 'Skill 库';
    const candidate = props.localCandidates.find(
      (entry) =>
        entry.path.toLocaleLowerCase() === path || (entry.name ?? entry.folderName) === skill.name,
    );
    if (!candidate) return 'Skill 库';
    // 工作区源显示真实安装路径（SKILL.md 所在目录），而不是工作区名
    if (candidate.sourceType === 'workspace') return candidate.skillDirectory;
    return candidate.sourceLabel ?? candidate.skillDirectory;
  };

  return (
    <>
      <header className="ability-hub__topbar">
        <div className="ability-hub__title-block">
          <button
            type="button"
            className="ability-hub__back"
            aria-label="返回"
            title="返回"
            onClick={props.onBack}
          >
            <ArrowLeft size={17} />
          </button>
          <h1>Skill 管理</h1>
          <button
            type="button"
            data-testid="abilities-section-mcp"
            className="ability-hub__sibling-link"
            aria-label="MCP 管理"
            onClick={props.onOpenMcp}
          >
            <Plug size={14} />
            <span>MCP 管理</span>
          </button>
        </div>
        <div className="ability-hub__actions">
          <button
            type="button"
            className="ability-hub__activation-action"
            onClick={props.onActivationCode}
          >
            <KeyRound size={14} />
            Skill 激活码
          </button>
          <div className="newmax-skill-create">
            <button
              type="button"
              data-testid="open-skill-import"
              className="ability-hub__create-action"
              aria-expanded={props.createMenuOpen}
              onClick={props.onToggleCreateMenu}
            >
              <Plus size={14} />
              创建 Skill
              <ChevronDown size={13} />
            </button>
            {props.createMenuOpen ? (
              <div className="newmax-skill-create__menu" role="menu">
                <button type="button" role="menuitem" onClick={props.onImport}>
                  <Upload size={15} />
                  导入
                </button>
                <button type="button" role="menuitem" onClick={props.onCreate}>
                  <WandSparkles size={15} />
                  创建 Skill
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="ability-hub__body">
        <section className="ability-hub__controls">
          <SlidingTabs className="ability-hub__catalog-tabs" aria-label="Skill 目录">
            <button
              type="button"
              role="tab"
              aria-selected={props.tab === 'market'}
              className={props.tab === 'market' ? 'is-active' : undefined}
              onClick={() => props.onTabChange('market')}
            >
              Skill 市场 <span>{props.marketItems.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="skill-tab-mine"
              aria-selected={props.tab === 'mine'}
              className={props.tab === 'mine' ? 'is-active' : undefined}
              onClick={() => props.onTabChange('mine')}
            >
              我的 Skill <span>{props.families.length}</span>
            </button>
          </SlidingTabs>
          <label className="ability-hub__search">
            <Search size={14} />
            <input
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="搜索 Skill"
              aria-label="搜索 Skill"
            />
            {props.query ? (
              <button type="button" aria-label="清除搜索" onClick={() => props.onQueryChange('')}>
                <X size={12} />
              </button>
            ) : null}
          </label>
        </section>

        {props.loadError ? (
          <div className="ability-status is-error" role="alert">
            <AlertTriangle size={14} />
            <div>
              <strong>能力库加载失败</strong>
              <span>{props.loadError}</span>
            </div>
            <button type="button" onClick={props.onReload}>
              重新加载
            </button>
          </div>
        ) : props.message ? (
          <div className="ability-status is-success" role="status">
            <CheckCircle2 size={14} />
            <div>
              <strong>{props.message}</strong>
            </div>
            <button type="button" aria-label="关闭提示" onClick={props.onCloseNotice}>
              <X size={12} />
            </button>
          </div>
        ) : props.error ? (
          <div className="ability-status is-error" role="alert">
            <AlertTriangle size={14} />
            <div>
              <strong>{props.error}</strong>
            </div>
            <button type="button" aria-label="关闭错误" onClick={props.onCloseNotice}>
              <X size={12} />
            </button>
          </div>
        ) : null}

        {props.tab === 'market' ? (
          <>
            <div className="ability-hub__category-row">
              {SKILL_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={props.category === category}
                  className={props.category === category ? 'is-active' : undefined}
                  onClick={() => props.onCategoryChange(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="ability-hub__scroll">
              <div className="ability-hub__market-grid">
                {marketItems.map((item) => {
                  const installed = marketSkillInstalled(item, props.families);
                  const busy = props.busyId === `market-skill:${item.id}`;
                  return (
                    <article key={item.id} className="ability-market-card">
                      <button
                        type="button"
                        className="ability-market-card__main"
                        onClick={() =>
                          installed
                            ? props.onOpenSkill(installed.skillVersionId)
                            : props.onOpenMarket(item.id)
                        }
                      >
                        <span className="ability-market-card__icon">
                          <MarketSkillGlyph icon={item.icon} />
                        </span>
                        <span className="ability-market-card__copy">
                          <span className="ability-market-card__title">
                            <strong>{item.name}</strong>
                            {installed ? <em>已安装</em> : null}
                          </span>
                          <span className="ability-market-card__description">
                            {item.description}
                          </span>
                        </span>
                      </button>
                      <footer className="ability-market-card__footer">
                        <span>{item.author === 'SYNC-THINK' ? '官方' : item.author}</span>
                        <div>
                          {installed ? (
                            <>
                              <button
                                type="button"
                                className="is-link"
                                onClick={() => props.onOpenSkill(installed.skillVersionId)}
                              >
                                管理
                              </button>
                              <button
                                type="button"
                                className="is-use"
                                onClick={() => props.onUseSkill(installed)}
                              >
                                使用
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="is-use"
                              disabled={Boolean(props.busyId)}
                              onClick={() => props.onInstallMarket(item)}
                            >
                              {busy ? (
                                <Loader2 className="animate-spin" size={11} />
                              ) : (
                                <Plus size={11} />
                              )}
                              {busy ? '安装中' : '安装'}
                            </button>
                          )}
                        </div>
                      </footer>
                    </article>
                  );
                })}
              </div>
              {marketItems.length === 0 ? <EmptyState title="没有匹配的 Skill" compact /> : null}
            </div>
          </>
        ) : (
          <>
            <div className="ability-hub__stats">
              <NewMaxStat value={rows.length} label="全部 skills" note="库 + 插件 + 项目级" />
              <NewMaxStat value={recentCount} label="近期活跃" note="近期有触发记录" />
              <NewMaxStat value={unusedCount} label="在吃灰" note="近期未触发" />
              <NewMaxStat
                value={problemCount}
                label="有问题"
                note="截断 / 缺描述 / 残留"
                warning={problemCount > 0}
              />
              <div
                className={`ability-stat ability-stat--context${contextTokens > CONTEXT_BUDGET_TOKENS ? ' is-warning' : ''}`}
              >
                <div>
                  <span>常驻上下文占用</span>
                  <strong>
                    {contextTokens > CONTEXT_BUDGET_TOKENS
                      ? `≈ 超限 ${(contextTokens / CONTEXT_BUDGET_TOKENS).toFixed(1)}×`
                      : '正常'}
                  </strong>
                </div>
                <span className="ability-stat__meter">
                  <i
                    style={{
                      width: `${Math.min(100, (contextTokens / CONTEXT_BUDGET_TOKENS) * 100)}%`,
                    }}
                  />
                </span>
                <p>
                  {formatTokens(contextTokens)} 字符 / 建议上限约{' '}
                  {formatTokens(CONTEXT_BUDGET_TOKENS)}（估算）
                </p>
              </div>
            </div>
            <div className="ability-hub__workspace-row" aria-label="工作区范围">
              <button
                type="button"
                className={`ability-hub__scope-pill${props.selectedScope === 'global' ? ' is-active' : ''}`}
                onClick={() => props.onScopeChange('global')}
              >
                <Folder size={11} />
                全局
              </button>
              {props.workspaces.slice(0, 4).map((workspace) => (
                <button
                  key={workspace.workspaceId}
                  type="button"
                  className={`ability-hub__scope-pill${
                    workspace.workspaceId === props.selectedScope ? ' is-active' : ''
                  }`}
                  onClick={() => props.onScopeChange(workspace.workspaceId)}
                >
                  <Folder size={11} />
                  {workspace.name}
                </button>
              ))}
              {props.workspaces.length > 4 ? (
                <span className="ability-hub__scope-more">+{props.workspaces.length - 4}</span>
              ) : null}
            </div>
            <div className="ability-hub__filter-row">
              <div className="ability-hub__security-filter" aria-label="来源筛选">
                {(
                  [
                    ['all', '全部来源'],
                    ['market', '市场安装'],
                    ['local', '本地安装'],
                    ['derived', '共享'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={props.sourceFilter === value ? 'is-active' : undefined}
                    onClick={() => props.onSourceFilterChange(value)}
                  >
                    {label}
                    {sourceCounts[value] > 0 ? <small>{sourceCounts[value]}</small> : null}
                  </button>
                ))}
              </div>
              <div className="ability-hub__security-filter" aria-label="状态筛选">
                {(
                  [
                    ['all', '全部状态'],
                    ['active', '活跃'],
                    ['enabled', '已启用'],
                    ['inactive', '未启用'],
                    ['unused', '未触发'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={props.statusFilter === value ? 'is-active' : undefined}
                    onClick={() => props.onStatusFilterChange(value)}
                  >
                    {label}
                    {statusCounts[value] > 0 ? <small>{statusCounts[value]}</small> : null}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ability-hub__organize"
                disabled={Boolean(props.busyId)}
                onClick={props.onOrganize}
              >
                {props.busyId === 'organize' ? (
                  <Loader2 className="animate-spin" size={13} />
                ) : (
                  <WandSparkles size={13} />
                )}
                一键整理
              </button>
              <div className="ability-hub__sort-wrap">
                <button
                  type="button"
                  className="ability-hub__sort"
                  aria-haspopup="menu"
                  aria-expanded={sortMenuOpen}
                  onClick={() => setSortMenuOpen((open) => !open)}
                >
                  {sortMode === 'triggers'
                    ? '按触发次数'
                    : sortMode === 'updated'
                      ? '最近更新'
                      : '按名称'}{' '}
                  <ChevronDown size={12} />
                </button>
                {sortMenuOpen ? (
                  <div className="ability-hub__sort-menu" role="menu">
                    {(
                      [
                        ['triggers', '按触发次数'],
                        ['updated', '最近更新'],
                        ['name', '按名称'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sortMode === value}
                        onClick={() => {
                          setSortMode(value);
                          setSortMenuOpen(false);
                        }}
                      >
                        {label}
                        {sortMode === value ? <Check size={11} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="ability-hub__scroll ability-hub__scroll--installed">
              {props.loading ? (
                <LoadingState label="正在读取 Skill..." />
              ) : rows.length === 0 ? (
                <div className="ability-hub__empty-library">
                  <span>
                    <Sparkles size={20} />
                  </span>
                  <h2>还没有 Skill</h2>
                  <p>从 Skill 市场安装，或导入本地 Skill 文件夹与 ZIP。</p>
                  <button type="button" onClick={props.onImport}>
                    <Upload size={13} />
                    导入 Skill
                  </button>
                </div>
              ) : visibleRows.length === 0 ? (
                <EmptyState title="没有匹配的已安装 Skill" compact />
              ) : (
                <div className="ability-installed-list" role="table" aria-label="Skill 列表">
                  <div className="ability-installed-list__header" role="row">
                    <span>SKILL</span>
                    <span>安装位置</span>
                    <span>已激活工作区</span>
                    <span>45 天触发</span>
                    <span>最后触发</span>
                    <span>操作</span>
                    <span>启用</span>
                  </div>
                  {visibleRows.map(
                    ({ family, skill, display, usage, workspaceActive, activeWorkspaceNames }) => {
                      const issue =
                        usage.problemCount > 0 || skill.hasScripts || skill.warnings.length > 0;
                      const globallyEnabled = skill.enabled !== false;
                      const workspaceBusy = Boolean(
                        props.busyId?.startsWith(`workspace:skill:${skill.skillVersionId}:`),
                      );
                      return (
                        <article
                          key={family.skillId}
                          className={`ability-installed-row${globallyEnabled ? '' : ' is-disabled'}`}
                          role="row"
                          data-enabled={globallyEnabled ? '1' : '0'}
                          aria-disabled={!globallyEnabled || undefined}
                        >
                          <button
                            type="button"
                            className="ability-installed-row__identity"
                            onClick={() => props.onOpenSkill(skill.skillVersionId)}
                          >
                            <span className="ability-installed-row__copy">
                              <span className="ability-installed-row__name">
                                <strong>{display.name}</strong>
                                <em className={issue ? 'is-warning' : 'is-healthy'}>
                                  {issue
                                    ? `${usage.problemCount || skill.warnings.length} 个问题`
                                    : '已扫描'}
                                </em>
                                {!globallyEnabled ? <em className="is-disabled">已停用</em> : null}
                                <small>v{skill.version}</small>
                              </span>
                              <small>{display.description || '未提供说明'}</small>
                            </span>
                          </button>
                          <span
                            className="ability-installed-row__location"
                            title={locationOf(skill)}
                          >
                            {locationOf(skill)}
                          </span>
                          <WorkspaceActivationControl
                            active={workspaceActive}
                            activeWorkspaceNames={activeWorkspaceNames}
                            globallyEnabled={globallyEnabled}
                            currentWorkspaceId={props.selectedWorkspaceId}
                            workspaceName={props.workspaceName}
                            workspaces={props.workspaces}
                            capabilityType="skill"
                            capabilityId={skill.skillVersionId}
                            testId={`skill-workspace-activation-${skill.skillVersionId}`}
                            busy={workspaceBusy}
                            disabled={Boolean(props.busyId) && !workspaceBusy}
                            onWorkspaceChange={(workspaceId, active) =>
                              props.onWorkspaceActive(skill, active, workspaceId)
                            }
                          />
                          <strong className="ability-installed-row__metric">
                            {usage.callCount.toLocaleString('zh-CN')}
                          </strong>
                          <span className="ability-installed-row__date">
                            {formatRelativeDate(usage.lastUsedAt)}
                          </span>
                          <div className="ability-installed-row__actions">
                            <button
                              type="button"
                              title="使用"
                              aria-label={`使用 ${display.name}`}
                              disabled={!globallyEnabled || Boolean(props.busyId)}
                              onClick={() => props.onUseSkill(skill)}
                            >
                              <Play size={13} />
                            </button>
                            <button
                              type="button"
                              title="编辑"
                              aria-label={`编辑 ${display.name}`}
                              onClick={() => props.onEditMetadata(skill)}
                            >
                              <Edit3 size={13} />
                            </button>
                            {skill.originType !== 'market' ? (
                              <button
                                type="button"
                                title="共享"
                                aria-label={`共享 ${display.name}`}
                                onClick={() => props.onPublishSkill(skill)}
                              >
                                <Upload size={13} />
                              </button>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="ability-enable-switch"
                            role="switch"
                            aria-checked={skill.enabled !== false}
                            aria-label={`${skill.enabled === false ? '启用' : '停用'} ${display.name}`}
                            data-enabled={skill.enabled !== false ? '1' : '0'}
                            disabled={Boolean(props.busyId)}
                            onClick={() => props.onGlobalEnabled(skill, skill.enabled === false)}
                          >
                            <span />
                          </button>
                        </article>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function NewMaxMcpHub(props: {
  tab: 'market' | 'mine';
  query: string;
  category: (typeof MCP_CATEGORIES)[number];
  statusFilter: StatusFilter;
  servers: McpServerSummary[];
  governanceMap: Map<string, GovernedMcpServerSummary>;
  loading: boolean;
  loadError?: string;
  message?: string;
  error?: string;
  busyId?: string;
  onBack(): void;
  onOpenSkills(): void;
  onTabChange(tab: CatalogTab): void;
  onQueryChange(value: string): void;
  onCategoryChange(value: (typeof MCP_CATEGORIES)[number]): void;
  onStatusFilterChange(value: StatusFilter): void;
  onReload(): void;
  onCloseNotice(): void;
  onOpenMarket(id: string): void;
  onOpenServer(id: string): void;
  onRegister(item: McpMarketItem | null): void;
  onGlobalEnabled(server: McpServerSummary, enabled: boolean): void;
  onRefresh(server: McpServerSummary): void;
  onOrganize(): void;
}): JSX.Element {
  const [sortMode, setSortMode] = useState<'calls' | 'updated' | 'name'>('calls');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
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
  const rows = props.servers.map((server) => {
    const governance = props.governanceMap.get(server.mcpServerId);
    return {
      server,
      usage: governance?.usage ?? defaultUsage('mcp', server.mcpServerId),
    };
  });
  const filteredRows = rows.filter(({ server, usage }) => {
    const searchMatches =
      !needle ||
      [server.name, server.endpoint, server.notes, ...server.tools.map((tool) => tool.name)]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
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
  const visibleRows = [...filteredRows].sort((left, right) => {
    if (sortMode === 'name') return left.server.name.localeCompare(right.server.name, 'zh-CN');
    if (sortMode === 'updated') {
      return Date.parse(right.server.updatedAt) - Date.parse(left.server.updatedAt);
    }
    return (
      right.usage.callCount - left.usage.callCount ||
      Date.parse(right.server.updatedAt) - Date.parse(left.server.updatedAt)
    );
  });
  const enabledCount = rows.filter((row) => row.server.enabled !== false).length;
  const recentCount = rows.filter((row) => row.usage.callCount > 0).length;
  const unusedCount = rows.filter((row) => row.usage.callCount === 0).length;
  const problemCount = rows.filter(
    (row) => row.usage.problemCount > 0 || !row.server.trusted || row.server.tools.length === 0,
  ).length;
  const statusCounts: Record<StatusFilter, number> = {
    all: rows.length,
    active: recentCount,
    enabled: enabledCount,
    inactive: rows.length - enabledCount,
    unused: unusedCount,
    problem: problemCount,
  };

  return (
    <>
      <header className="ability-hub__topbar">
        <div className="ability-hub__title-block">
          <button
            type="button"
            className="ability-hub__back"
            aria-label="返回"
            title="返回"
            onClick={props.onBack}
          >
            <ArrowLeft size={17} />
          </button>
          <h1>MCP 管理</h1>
          <button
            type="button"
            className="ability-hub__sibling-link"
            aria-label="Skill 管理"
            onClick={props.onOpenSkills}
          >
            <Sparkles size={14} />
            <span>Skill 管理</span>
          </button>
        </div>
        <div className="ability-hub__actions">
          <button
            type="button"
            data-testid="mcp-register-open"
            className="ability-hub__create-action"
            onClick={() => props.onRegister(null)}
          >
            <Plus size={14} />
            注册 MCP
          </button>
        </div>
      </header>

      <div className="ability-hub__body">
        <section className="ability-hub__controls">
          <SlidingTabs className="ability-hub__catalog-tabs" aria-label="MCP 目录">
            <button
              type="button"
              role="tab"
              aria-selected={props.tab === 'market'}
              className={props.tab === 'market' ? 'is-active' : undefined}
              onClick={() => props.onTabChange('market')}
            >
              MCP 市场 <span>{MCP_MARKET.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="mcp-tab-mine"
              aria-selected={props.tab === 'mine'}
              className={props.tab === 'mine' ? 'is-active' : undefined}
              onClick={() => props.onTabChange('mine')}
            >
              我的 MCP <span>{props.servers.length}</span>
            </button>
          </SlidingTabs>
          <label className="ability-hub__search">
            <Search size={14} />
            <input
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="搜索 MCP"
              aria-label="搜索 MCP"
            />
            {props.query ? (
              <button type="button" aria-label="清除搜索" onClick={() => props.onQueryChange('')}>
                <X size={12} />
              </button>
            ) : null}
          </label>
        </section>

        {props.loadError ? (
          <div className="ability-status is-error" role="alert">
            <AlertTriangle size={14} />
            <div>
              <strong>能力库加载失败</strong>
              <span>{props.loadError}</span>
            </div>
            <button type="button" onClick={props.onReload}>
              重新加载
            </button>
          </div>
        ) : props.message ? (
          <div className="ability-status is-success" role="status">
            <CheckCircle2 size={14} />
            <div>
              <strong>{props.message}</strong>
            </div>
            <button type="button" aria-label="关闭提示" onClick={props.onCloseNotice}>
              <X size={12} />
            </button>
          </div>
        ) : props.error ? (
          <div className="ability-status is-error" role="alert">
            <AlertTriangle size={14} />
            <div>
              <strong>{props.error}</strong>
            </div>
            <button type="button" aria-label="关闭错误" onClick={props.onCloseNotice}>
              <X size={12} />
            </button>
          </div>
        ) : null}

        {props.tab === 'market' ? (
          <>
            <div className="ability-hub__category-row">
              {MCP_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={props.category === category}
                  className={props.category === category ? 'is-active' : undefined}
                  onClick={() => props.onCategoryChange(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="ability-hub__scroll">
              <div className="ability-hub__market-grid">
                {marketItems.map((item) => {
                  const installed = marketMcpInstalled(item, props.servers);
                  return (
                    <article key={item.id} className="ability-market-card">
                      <button
                        type="button"
                        className="ability-market-card__main"
                        onClick={() =>
                          installed
                            ? props.onOpenServer(installed.mcpServerId)
                            : props.onOpenMarket(item.id)
                        }
                      >
                        <span className="ability-market-card__icon is-mcp">
                          <McpMarketGlyph category={item.category} />
                        </span>
                        <span className="ability-market-card__copy">
                          <span className="ability-market-card__title">
                            <strong>{item.name}</strong>
                            {installed ? <em>已注册</em> : null}
                          </span>
                          <span className="ability-market-card__description">
                            {item.description}
                          </span>
                        </span>
                      </button>
                      <footer className="ability-market-card__footer">
                        <span>{item.transport === 'local-stdio' ? '本地 stdio' : '远程 HTTP'}</span>
                        <div>
                          {installed ? (
                            <button
                              type="button"
                              className="is-link"
                              onClick={() => props.onOpenServer(installed.mcpServerId)}
                            >
                              管理
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="is-use"
                              onClick={() => props.onRegister(item)}
                            >
                              <Plus size={11} />
                              注册
                            </button>
                          )}
                        </div>
                      </footer>
                    </article>
                  );
                })}
              </div>
              {marketItems.length === 0 ? <EmptyState title="没有匹配的 MCP" compact /> : null}
            </div>
          </>
        ) : (
          <>
            <div className="ability-hub__stats">
              <NewMaxStat value={rows.length} label="全部 MCP" note="已登记的外部工具服务" />
              <NewMaxStat value={enabledCount} label="已启用" note="可在 Agent 中绑定使用" />
              <NewMaxStat value={recentCount} label="近期调用" note="45 天内有调用记录" />
              <NewMaxStat value={unusedCount} label="未调用" note="45 天内没有调用记录" />
              <NewMaxStat
                value={problemCount}
                label="需检查"
                note="未信任、无工具或调用异常"
                warning={problemCount > 0}
              />
            </div>
            <div className="ability-hub__filter-row">
              <div className="ability-hub__security-filter" aria-label="状态筛选">
                {(
                  [
                    ['all', '全部状态'],
                    ['enabled', '已启用'],
                    ['active', '近期调用'],
                    ['inactive', '已停用'],
                    ['unused', '未调用'],
                    ['problem', '需检查'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={props.statusFilter === value}
                    className={props.statusFilter === value ? 'is-active' : undefined}
                    onClick={() => props.onStatusFilterChange(value)}
                  >
                    {label}
                    {statusCounts[value] > 0 ? <small>{statusCounts[value]}</small> : null}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ability-hub__organize"
                disabled={Boolean(props.busyId)}
                onClick={props.onOrganize}
              >
                {props.busyId === 'organize' ? (
                  <Loader2 className="animate-spin" size={13} />
                ) : (
                  <WandSparkles size={13} />
                )}
                一键整理
              </button>
              <div className="ability-hub__sort-wrap">
                <button
                  type="button"
                  className="ability-hub__sort"
                  aria-haspopup="menu"
                  aria-expanded={sortMenuOpen}
                  onClick={() => setSortMenuOpen((open) => !open)}
                >
                  {sortMode === 'calls'
                    ? '按调用次数'
                    : sortMode === 'updated'
                      ? '最近更新'
                      : '按名称'}{' '}
                  <ChevronDown size={12} />
                </button>
                {sortMenuOpen ? (
                  <div className="ability-hub__sort-menu" role="menu">
                    {(
                      [
                        ['calls', '按调用次数'],
                        ['updated', '最近更新'],
                        ['name', '按名称'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sortMode === value}
                        onClick={() => {
                          setSortMode(value);
                          setSortMenuOpen(false);
                        }}
                      >
                        {label}
                        {sortMode === value ? <Check size={11} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="ability-hub__scroll ability-hub__scroll--mcp">
              {props.loading ? (
                <LoadingState label="正在读取 MCP..." />
              ) : rows.length === 0 ? (
                <div className="ability-hub__empty-library">
                  <span>
                    <Plug size={20} />
                  </span>
                  <h2>还没有注册 MCP</h2>
                  <p>从市场选择模板，或手动填写本地命令与远程 Endpoint。</p>
                  <button type="button" onClick={() => props.onRegister(null)}>
                    <Plus size={13} />
                    注册 MCP
                  </button>
                </div>
              ) : visibleRows.length === 0 ? (
                <EmptyState title="没有匹配的 MCP" compact />
              ) : (
                <div className="mcp-installed-grid" aria-label="MCP 服务列表">
                  {visibleRows.map(({ server, usage }) => {
                    const issue =
                      usage.problemCount > 0 || !server.trusted || server.tools.length === 0;
                    const refreshBusy = props.busyId === `mcp-refresh:${server.mcpServerId}`;
                    return (
                      <article
                        key={server.mcpServerId}
                        className={`mcp-installed-card${server.enabled === false ? ' is-disabled' : ''}`}
                      >
                        <button
                          type="button"
                          className="mcp-installed-card__main"
                          onClick={() => props.onOpenServer(server.mcpServerId)}
                        >
                          <span className="capability-row-icon is-mcp">
                            <Server size={15} />
                          </span>
                          <span>
                            <strong>{server.name}</strong>
                            <em>
                              {issue
                                ? '需要检查'
                                : `${server.tools.length.toLocaleString('zh-CN')} 个工具`}
                            </em>
                            <small>{server.endpoint || '未填写 Endpoint'}</small>
                          </span>
                        </button>
                        {/* TD-041: MCP is global. Workspace activation records are audit-only. */}
                        <button
                          type="button"
                          className="ability-enable-switch"
                          role="switch"
                          aria-checked={server.enabled !== false}
                          aria-label={`${server.enabled === false ? '启用' : '停用'} ${server.name}`}
                          data-enabled={server.enabled !== false ? '1' : '0'}
                          disabled={Boolean(props.busyId)}
                          onClick={() => props.onGlobalEnabled(server, server.enabled === false)}
                        >
                          <span />
                        </button>
                        <div className="mcp-installed-card__facts">
                          <span>
                            <Link2 size={12} />
                            {server.transport === 'remote-http' ? '远程 HTTP' : '本地 stdio'}
                          </span>
                          <span>
                            <ShieldCheck size={12} />
                            {server.trusted ? '可信来源' : '未标记可信'}
                          </span>
                          <span>
                            <CircleGauge size={12} />
                            {usage.callCount.toLocaleString('zh-CN')} 次调用
                          </span>
                          <span>{formatRelativeDate(usage.lastUsedAt)}</span>
                        </div>
                        <button
                          type="button"
                          data-testid={`mcp-row-refresh-${server.mcpServerId}`}
                          className="mcp-installed-card__refresh"
                          disabled={Boolean(props.busyId)}
                          onClick={() => props.onRefresh(server)}
                        >
                          <RefreshCw
                            className={refreshBusy ? 'animate-spin' : undefined}
                            size={12}
                          />
                          {refreshBusy ? '刷新中' : '刷新工具'}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function NewMaxStat(props: {
  value: number | string;
  label: string;
  note: string;
  warning?: boolean;
}): JSX.Element {
  return (
    <div className={`ability-stat${props.warning ? ' is-warning' : ''}`}>
      <div>
        <strong>{props.value}</strong>
        <span>{props.label}</span>
      </div>
      <p>{props.note}</p>
    </div>
  );
}

function MarketSkillGlyph(props: { icon?: string }): JSX.Element {
  if (props.icon === 'folder-cog') return <Folder size={23} />;
  if (props.icon === 'workflow') return <CircleGauge size={23} />;
  if (props.icon === 'palette') return <WandSparkles size={23} />;
  if (props.icon === 'file-text') return <FileCode2 size={23} />;
  if (props.icon === 'chart-no-axes-combined') return <Layers3 size={23} />;
  if (props.icon === 'send') return <Send size={23} />;
  return <PackageOpen size={23} />;
}

function McpMarketGlyph(props: { category: string }): JSX.Element {
  if (props.category === '文件系统') return <Folder size={23} />;
  if (props.category === '浏览器') return <Globe2 size={23} />;
  if (props.category === '数据库') return <Layers3 size={23} />;
  if (props.category === '协作') return <Boxes size={23} />;
  if (props.category === '开发工具') return <Code2 size={23} />;
  return <Plug size={23} />;
}

export function SkillSurface(props: {
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
  onWorkspaceActive(
    skill: SkillVersionSummary,
    active: boolean,
    workspaceId?: string,
  ): Promise<boolean | void> | boolean | void;
  onDelete(skill: SkillVersionSummary): void;
  onOrganize(): void;
  localCandidates: import('@sync-think/protocol').LocalSkillCandidate[];
  localDirectory: string;
  localWatching: boolean;
  localExists: boolean;
  onLocalImport(path: string): void;
}): JSX.Element {
  const needle = props.query.trim().toLocaleLowerCase();
  if (props.tab === 'local') {
    const visible = props.localCandidates.filter((candidate) => {
      if (!needle) return true;
      return [
        candidate.name ?? candidate.folderName,
        candidate.description ?? '',
        candidate.summary ?? '',
        candidate.path,
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle);
    });
    return (
      <section className="capability-center__content" data-testid="skill-local-surface">
        <div className="capability-local__banner">
          <span className="capability-local__banner-dot" aria-hidden="true" />
          本地 Skill 目录：<code>{props.localDirectory}</code>
          {props.localWatching
            ? '（自动监听中）'
            : props.localExists
              ? '（未监听）'
              : '（目录不存在，创建后自动发现）'}
        </div>
        {visible.length === 0 ? (
          <div className="capability-center__empty">
            {props.localCandidates.length === 0
              ? '未在本地目录发现 SKILL.md。把 skill 文件放入约定目录（任意子目录下的 SKILL.md）即可被自动发现。'
              : '没有匹配的本地 skill。'}
          </div>
        ) : (
          <div className="capability-local__list">
            {visible.map((candidate) => (
              <div
                key={candidate.path}
                className="capability-local__card"
                data-imported={candidate.imported ? '1' : '0'}
              >
                <div className="capability-local__card-main">
                  <div className="capability-local__card-title">
                    <span>{candidate.name ?? candidate.folderName}</span>
                    {candidate.imported ? (
                      <span className="capability-local__badge">已导入</span>
                    ) : null}
                  </div>
                  {candidate.description ? (
                    <div className="capability-local__desc">{candidate.description}</div>
                  ) : null}
                  {candidate.summary ? (
                    <div className="capability-local__summary">{candidate.summary}</div>
                  ) : null}
                  <div className="capability-local__meta">
                    <code>{candidate.path}</code>
                    <span>· {(candidate.sizeBytes / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
                {!candidate.imported ? (
                  <button
                    type="button"
                    className="capability-local__import"
                    onClick={() => props.onLocalImport(candidate.path)}
                  >
                    导入
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }
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
                    globallyEnabled={skill.enabled !== false}
                    currentWorkspaceId={props.selectedWorkspaceId}
                    workspaceName={props.workspaceName}
                    workspaces={props.workspaces}
                    capabilityType="skill"
                    capabilityId={skill.skillVersionId}
                    testId={`skill-workspace-activation-${skill.skillVersionId}`}
                    busy={
                      props.busyId === `workspace:skill:${skill.skillVersionId}` ||
                      Boolean(props.busyId?.startsWith(`workspace:skill:${skill.skillVersionId}:`))
                    }
                    disabled={
                      Boolean(props.busyId) &&
                      !props.busyId?.startsWith(`workspace:skill:${skill.skillVersionId}:`)
                    }
                    onWorkspaceChange={(workspaceId, active) =>
                      props.onWorkspaceActive(skill, active, workspaceId)
                    }
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
  activeWorkspaceNames?: readonly string[];
  globallyEnabled: boolean;
  currentWorkspaceId: string;
  workspaceName: string;
  workspaces: WorkspaceSummary[];
  capabilityType: 'skill' | 'mcp';
  capabilityId: string;
  testId?: string;
  busy?: boolean;
  disabled?: boolean;
  onWorkspaceChange(workspaceId: string, active: boolean): Promise<boolean | void> | boolean | void;
}): JSX.Element {
  const { onWorkspaceChange, workspaces } = props;
  const [open, setOpen] = useState(false);
  const [activations, setActivations] = useState<Map<string, boolean>>(new Map());
  const [loadingActivations, setLoadingActivations] = useState(false);
  const [pendingWorkspaceIds, setPendingWorkspaceIds] = useState<Set<string>>(new Set());
  const [activationError, setActivationError] = useState<string>();
  const currentWorkspaceActiveRef = useRef(props.active);

  useEffect(() => {
    currentWorkspaceActiveRef.current = props.active;
  }, [props.active]);

  const loadActivations = useCallback(async () => {
    setActivationError(undefined);
    setActivations(
      new Map(
        props.currentWorkspaceId
          ? ([[props.currentWorkspaceId, currentWorkspaceActiveRef.current]] as const)
          : [],
      ),
    );
    const api = runtimeBridge();
    if (!api?.listCapabilityWorkspaceActivations) return;
    setLoadingActivations(true);
    try {
      const entries = await Promise.all(
        props.workspaces.map(async (workspace) => {
          try {
            const response = await api.listCapabilityWorkspaceActivations({
              workspaceId: workspace.workspaceId,
              capabilityType: props.capabilityType,
            });
            const record = response.activations.find(
              (activation) => activation.capabilityId === props.capabilityId,
            );
            return [workspace.workspaceId, Boolean(record?.active)] as const;
          } catch {
            return [workspace.workspaceId, false] as const;
          }
        }),
      );
      setActivations(new Map(entries));
    } finally {
      setLoadingActivations(false);
    }
  }, [props.capabilityId, props.capabilityType, props.currentWorkspaceId, props.workspaces]);

  useEffect(() => {
    if (!open) return;
    void loadActivations();
  }, [open, loadActivations]);

  useEffect(() => {
    if (!props.globallyEnabled) setOpen(false);
  }, [props.globallyEnabled]);

  const changeWorkspace = useCallback(
    async (workspaceId: string, nextActive: boolean): Promise<boolean> => {
      const previous = activations.get(workspaceId) ?? false;
      setActivationError(undefined);
      setActivations((current) => new Map(current).set(workspaceId, nextActive));
      setPendingWorkspaceIds((current) => new Set(current).add(workspaceId));
      try {
        const result = await onWorkspaceChange(workspaceId, nextActive);
        if (result === false) {
          setActivations((current) => new Map(current).set(workspaceId, previous));
          setActivationError('更新失败，已恢复原状态');
          return false;
        }
        return true;
      } catch {
        setActivations((current) => new Map(current).set(workspaceId, previous));
        setActivationError('更新失败，已恢复原状态');
        return false;
      } finally {
        setPendingWorkspaceIds((current) => {
          const next = new Set(current);
          next.delete(workspaceId);
          return next;
        });
      }
    },
    [activations, onWorkspaceChange],
  );

  const allWorkspacesActive =
    workspaces.length > 0 &&
    workspaces.every((workspace) => activations.get(workspace.workspaceId) === true);
  const controlsBusy = loadingActivations || pendingWorkspaceIds.size > 0 || Boolean(props.busy);

  const changeAllWorkspaces = useCallback(
    async (nextActive: boolean) => {
      const targets = workspaces.filter(
        (workspace) => (activations.get(workspace.workspaceId) ?? false) !== nextActive,
      );
      if (targets.length === 0) return;

      const previous = new Map(activations);
      const targetIds = new Set(targets.map((workspace) => workspace.workspaceId));
      setActivationError(undefined);
      setActivations((current) => {
        const next = new Map(current);
        for (const workspace of targets) next.set(workspace.workspaceId, nextActive);
        return next;
      });
      setPendingWorkspaceIds((current) => new Set([...current, ...targetIds]));

      const failedIds = new Set<string>();
      for (const workspace of targets) {
        try {
          const result = await onWorkspaceChange(workspace.workspaceId, nextActive);
          if (result === false) failedIds.add(workspace.workspaceId);
        } catch {
          failedIds.add(workspace.workspaceId);
        }
      }

      if (failedIds.size > 0) {
        setActivations((current) => {
          const next = new Map(current);
          for (const workspaceId of failedIds) {
            next.set(workspaceId, previous.get(workspaceId) ?? false);
          }
          return next;
        });
        setActivationError(
          failedIds.size === targets.length
            ? '工作区状态更新失败，已恢复原状态'
            : `${failedIds.size} 个工作区更新失败`,
        );
      }
      setPendingWorkspaceIds((current) => {
        const next = new Set(current);
        for (const workspaceId of targetIds) next.delete(workspaceId);
        return next;
      });
    },
    [activations, onWorkspaceChange, workspaces],
  );

  const triggerDisabled = !props.globallyEnabled || Boolean(props.disabled);
  const activeWorkspaceNames = (props.activeWorkspaceNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  const displayedWorkspaceNames =
    activeWorkspaceNames.length > 0
      ? activeWorkspaceNames
      : props.active
        ? [props.workspaceName]
        : [];
  const hasActiveWorkspace = displayedWorkspaceNames.length > 0;
  const activationLabel =
    displayedWorkspaceNames.length === 0
      ? '未激活'
      : displayedWorkspaceNames.length === 1
        ? displayedWorkspaceNames[0]
        : `${displayedWorkspaceNames[0]} +${displayedWorkspaceNames.length - 1}`;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`capability-workspace-activation${
            hasActiveWorkspace && props.globallyEnabled ? ' is-active' : ''
          }${props.busy ? ' is-busy' : ''}${triggerDisabled ? ' is-disabled' : ''}`}
          data-testid={props.testId}
          disabled={triggerDisabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={props.busy || undefined}
          title={
            props.globallyEnabled
              ? hasActiveWorkspace
                ? `${displayedWorkspaceNames.join('、')}：已激活`
                : `${props.workspaceName}：未激活`
              : 'Skill 已全局停用'
          }
        >
          <span className="capability-workspace-activation__label">
            {props.globallyEnabled ? activationLabel : '已停用'}
          </span>
          {props.globallyEnabled ? (
            props.busy ? (
              <Loader2 className="animate-spin" size={12} aria-hidden="true" />
            ) : (
              <ChevronDown size={12} aria-hidden="true" />
            )
          ) : null}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="skill-workspace-menu"
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
          aria-label="激活到工作区"
        >
          <DropdownMenu.Label className="skill-workspace-menu__title">
            激活到工作区
          </DropdownMenu.Label>
          <button
            type="button"
            className="skill-workspace-menu__row"
            role="switch"
            aria-label="激活全部工作区"
            aria-checked={allWorkspacesActive}
            disabled={Boolean(props.disabled) || controlsBusy || workspaces.length === 0}
            onClick={() => void changeAllWorkspaces(!allWorkspacesActive)}
          >
            <span>全局</span>
            <span
              className="skill-workspace-menu__switch"
              data-checked={allWorkspacesActive ? '1' : '0'}
              aria-hidden="true"
            >
              <i />
            </span>
          </button>
          <DropdownMenu.Separator className="skill-workspace-menu__separator" />

          <div className="skill-workspace-menu__list">
            {workspaces.length === 0 ? (
              <span className="skill-workspace-menu__empty">没有可用工作区</span>
            ) : (
              workspaces.map((workspace) => {
                const name = workspace.name || workspace.workspaceId;
                const isActive = activations.get(workspace.workspaceId) ?? false;
                const pending = pendingWorkspaceIds.has(workspace.workspaceId);
                return (
                  <button
                    key={workspace.workspaceId}
                    type="button"
                    className="skill-workspace-menu__row"
                    role="switch"
                    aria-label={`${name} 工作区`}
                    aria-checked={isActive}
                    aria-busy={pending || undefined}
                    disabled={Boolean(props.disabled) || controlsBusy}
                    title={name}
                    onClick={() => void changeWorkspace(workspace.workspaceId, !isActive)}
                  >
                    <span>{name}</span>
                    <span
                      className="skill-workspace-menu__switch"
                      data-checked={isActive ? '1' : '0'}
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {activationError ? (
            <span className="skill-workspace-menu__error" role="status">
              {activationError}
            </span>
          ) : null}
          <DropdownMenu.Separator className="skill-workspace-menu__separator" />
          <button
            type="button"
            className="skill-workspace-menu__done"
            onClick={() => setOpen(false)}
          >
            完成
          </button>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  displayMetadata?: LocalSkillDisplayMetadata;
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
  const name = props.displayMetadata?.displayName?.trim() || skill?.name || marketItem?.name || '';
  const description =
    props.displayMetadata?.description?.trim() ||
    skill?.description ||
    marketItem?.description ||
    '';
  const icon = props.displayMetadata?.icon;
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
                {icon?.startsWith('data:') ? (
                  <img src={icon} alt="" />
                ) : icon ? (
                  icon
                ) : (
                  <PackageOpen size={20} />
                )}
              </span>
              <div>
                <Dialog.Title>{name}</Dialog.Title>
                <Dialog.Description>
                  {skill
                    ? `${skillOriginLabel(skill)} · v${skill.version}`
                    : marketItem
                      ? `${marketItem.author} · ${marketItem.category} · v${marketItem.version}`
                      : ''}
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
                    aria-label="删除 Skill"
                    title="删除 Skill"
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

function NewMaxSkillMetadataDialog(props: {
  state?: SkillMetadataEditorState;
  onOpenChange(open: boolean): void;
  onSave(state: SkillMetadataEditorState): void;
}): JSX.Element {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string>();
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.state) return;
    setDisplayName(props.state.displayName);
    setDescription(props.state.description);
    setIcon(props.state.icon);
    setError(undefined);
  }, [props.state]);

  const handleIconFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setIcon(await resizeSkillIcon(file));
      setError(undefined);
    } catch (cause) {
      setError(capabilityErrorMessage(cause, '图标加载失败'));
    } finally {
      event.target.value = '';
    }
  };

  const save = () => {
    if (!props.state) return;
    if (!displayName.trim()) {
      setError('请填写 Skill 名称');
      return;
    }
    props.onSave({
      skillName: props.state.skillName,
      displayName: displayName.trim(),
      description: description.trim(),
      icon,
    });
  };

  return (
    <Dialog.Root open={Boolean(props.state)} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="newmax-import-overlay" />
        <Dialog.Content className="newmax-metadata-dialog">
          <header className="newmax-metadata-dialog__header">
            <Dialog.Title>编辑 Skill</Dialog.Title>
            <Dialog.Description className="sr-only">
              编辑 Skill 的显示名称、描述与图标
            </Dialog.Description>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭 Skill 信息编辑">
                <X size={17} />
              </button>
            </Dialog.Close>
          </header>
          <div className="newmax-metadata-dialog__body">
            <div className="newmax-metadata-dialog__icon-row">
              <button
                type="button"
                className="newmax-metadata-dialog__icon"
                aria-label="上传 Skill 图标"
                onClick={() => iconInputRef.current?.click()}
              >
                {icon.startsWith('data:') ? (
                  <img src={icon} alt="" />
                ) : icon ? (
                  icon
                ) : (
                  <Plus size={20} />
                )}
              </button>
              <input
                aria-label="Skill 图标"
                value={icon.startsWith('data:') ? '' : icon}
                placeholder="输入 emoji 或图标"
                onChange={(event) => setIcon(event.target.value.slice(0, 16))}
              />
              <input
                ref={iconInputRef}
                type="file"
                accept="image/*"
                tabIndex={-1}
                onChange={(event) => void handleIconFile(event)}
              />
            </div>
            <input
              aria-label="Skill 名称"
              value={displayName}
              placeholder="为你的 Skill 起个名字"
              maxLength={160}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setError(undefined);
              }}
            />
            <textarea
              aria-label="Skill 描述"
              value={description}
              placeholder="简要描述这个 Skill 的功能和用途"
              rows={3}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
            {error ? (
              <div className="newmax-import-error" role="alert">
                <AlertTriangle size={14} />
                {error}
              </div>
            ) : null}
          </div>
          <footer className="newmax-metadata-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="is-cancel">
                取消
              </button>
            </Dialog.Close>
            <button type="button" className="is-primary" onClick={save}>
              保存
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NewMaxSkillImportDialog(props: {
  open: boolean;
  loading: boolean;
  error?: string;
  workspaces: WorkspaceSummary[];
  selectedWorkspaceId: string;
  onOpenChange(open: boolean): void;
  onSubmit(payload: LocalSkillInstallRequest): Promise<boolean>;
}): JSX.Element {
  const availableWorkspaces = props.workspaces.filter((workspace) => Boolean(workspace.folderPath));
  const defaultScopeKey = availableWorkspaces.some(
    (workspace) => workspace.workspaceId === props.selectedWorkspaceId,
  )
    ? `workspace:${props.selectedWorkspaceId}`
    : 'global';
  const [sourcePath, setSourcePath] = useState('');
  const [sourceType, setSourceType] = useState<'folder' | 'file' | 'zip'>();
  const [skills, setSkills] = useState<SkillLocalInspectItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [scopes, setScopes] = useState<SkillLocalInstallScope[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scopeFieldRef = useRef<HTMLDivElement>(null);
  const emojiFieldRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!props.open) return;
    setSourcePath('');
    setSourceType(undefined);
    setSkills([]);
    setName('');
    setDescription('');
    setIcon('');
    setScopes(
      defaultScopeKey === 'global'
        ? [{ type: 'global' }]
        : [
            {
              type: 'workspace',
              workspaceId: defaultScopeKey.slice('workspace:'.length),
            },
          ],
    );
    setScopeOpen(false);
    setEmojiOpen(false);
    setDragActive(false);
    setInspecting(false);
    setLocalError(undefined);
  }, [defaultScopeKey, props.open]);

  useEffect(() => {
    if (!scopeOpen && !emojiOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (scopeOpen && !scopeFieldRef.current?.contains(target)) setScopeOpen(false);
      if (emojiOpen && !emojiFieldRef.current?.contains(target)) setEmojiOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [emojiOpen, scopeOpen]);

  const inspectPath = async (path: string) => {
    const api = runtimeBridge();
    if (!api?.skillLocalInspect) {
      setLocalError('Runtime bridge 不支持本地 Skill 检查');
      return;
    }
    setInspecting(true);
    setLocalError(undefined);
    try {
      const result = await api.skillLocalInspect({ path });
      setSourcePath(result.sourcePath);
      setSourceType(result.sourceType);
      setSkills(result.skills);
    } catch (cause) {
      setSourcePath('');
      setSourceType(undefined);
      setSkills([]);
      setLocalError(capabilityErrorMessage(cause, '读取 Skill 失败'));
    } finally {
      setInspecting(false);
    }
  };

  const pickFolder = async () => {
    const result = await runtimeBridge()?.pickFolder({ title: '选择 Skill 文件夹' });
    if (!result || result.canceled || !result.path) return;
    await inspectPath(result.path);
  };

  const pickZip = async () => {
    const result = await runtimeBridge()?.pickSkillZip();
    if (!result || result.canceled || !result.path) return;
    await inspectPath(result.path);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const path = runtimeBridge()?.pathForFile?.(file) ?? '';
    if (!path) {
      setLocalError('未能读取拖入项目的本地路径，请使用选择按钮');
      return;
    }
    void inspectPath(path);
  };

  const handleIconChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setIcon(await resizeSkillIcon(file));
      setEmojiOpen(false);
      setLocalError(undefined);
    } catch (cause) {
      setLocalError(capabilityErrorMessage(cause, '图标加载失败'));
    } finally {
      event.target.value = '';
    }
  };

  const toggleScope = (next: SkillLocalInstallScope) => {
    const key = localSkillScopeKey(next);
    setScopes((current) =>
      current.some((scope) => localSkillScopeKey(scope) === key)
        ? current.filter((scope) => localSkillScopeKey(scope) !== key)
        : [...current, next],
    );
    setLocalError(undefined);
  };

  const scopeLabel = (scope: SkillLocalInstallScope): string =>
    scope.type === 'global'
      ? '全局'
      : (availableWorkspaces.find((workspace) => workspace.workspaceId === scope.workspaceId)
          ?.name ?? scope.workspaceId);
  const selectedName = sourcePath ? portableBasename(sourcePath) : '';

  const submit = async () => {
    if (!sourcePath || skills.length === 0) {
      setLocalError('请先选择包含 SKILL.md 的文件夹或 ZIP 文件');
      return;
    }
    if (!name.trim()) {
      setLocalError('请填写 Skill 名称');
      return;
    }
    if (scopes.length === 0) {
      setLocalError('请选择安装位置');
      return;
    }
    await props.onSubmit({
      path: sourcePath,
      scopes,
      name: name.trim(),
      description: description.trim(),
      ...(icon ? { icon } : {}),
    });
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="newmax-import-overlay" />
        <Dialog.Content className="newmax-import-dialog">
          <header className="newmax-import-dialog__header">
            <Dialog.Title>导入 Skill</Dialog.Title>
            <Dialog.Description className="sr-only">
              从本地文件夹或 ZIP 文件导入完整 Skill 目录
            </Dialog.Description>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭导入 Skill" disabled={props.loading}>
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>

          <div
            className={`newmax-import-dialog__body${sourcePath ? ' has-source' : ''}${dragActive ? ' is-dragging' : ''}`}
            onDragEnter={(event) => {
              if (!Array.from(event.dataTransfer.types).includes('Files')) return;
              event.preventDefault();
              dragDepthRef.current += 1;
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepthRef.current -= 1;
              if (dragDepthRef.current <= 0) {
                dragDepthRef.current = 0;
                setDragActive(false);
              }
            }}
            onDrop={handleDrop}
          >
            <section className="newmax-import-picker">
              <div className="newmax-import-picker__label">
                <strong>选择文件或文件夹</strong>
                <span>可直接拖入文件夹或 ZIP · cmd+shift+. 显示隐藏的 .claude</span>
              </div>
              <div className="newmax-import-picker__buttons">
                <button
                  type="button"
                  className={sourcePath && sourceType !== 'zip' ? 'is-selected' : undefined}
                  title={sourcePath && sourceType !== 'zip' ? sourcePath : undefined}
                  disabled={inspecting || props.loading}
                  onClick={() => void pickFolder()}
                >
                  <Folder size={15} />
                  <span>{sourcePath && sourceType !== 'zip' ? selectedName : '选择文件夹'}</span>
                </button>
                <button
                  type="button"
                  className={sourcePath && sourceType === 'zip' ? 'is-selected' : undefined}
                  title={sourcePath && sourceType === 'zip' ? sourcePath : undefined}
                  disabled={inspecting || props.loading}
                  onClick={() => void pickZip()}
                >
                  <Upload size={15} />
                  <span>{sourcePath && sourceType === 'zip' ? selectedName : '选择 ZIP 文件'}</span>
                </button>
              </div>
              {inspecting ? (
                <div className="newmax-import-picker__path">
                  <Loader2 className="animate-spin" size={13} /> 正在检查 Skill...
                </div>
              ) : null}
            </section>

            <section className="newmax-import-icon-field">
              <strong>Skill 图标</strong>
              <div className="newmax-import-icon-field__control" ref={emojiFieldRef}>
                <button
                  type="button"
                  className="newmax-import-icon-field__preview"
                  aria-label="选择 Emoji 图标"
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((open) => !open)}
                >
                  {!icon ? (
                    <Plus size={19} />
                  ) : icon.startsWith('data:') ? (
                    <img src={icon} alt="" />
                  ) : (
                    icon
                  )}
                </button>
                {emojiOpen ? (
                  <div className="newmax-import-emoji-menu" role="menu" aria-label="Emoji 图标">
                    {SKILL_ICON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        aria-label={`使用 ${emoji} 图标`}
                        onClick={() => {
                          setIcon(emoji);
                          setEmojiOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
                <span>
                  选择 emoji 或{' '}
                  <button
                    type="button"
                    onClick={() => {
                      imageInputRef.current?.click();
                    }}
                  >
                    上传图片
                  </button>{' '}
                  <small>(128×128)</small>
                </span>
                {icon ? (
                  <button
                    type="button"
                    className="newmax-import-icon-field__clear"
                    aria-label="清除图标"
                    title="清除图标"
                    onClick={() => setIcon('')}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  tabIndex={-1}
                  onChange={(event) => void handleIconChange(event)}
                />
              </div>
            </section>

            <label className="newmax-import-field">
              <span>Skill 名称</span>
              <input
                value={name}
                disabled={props.loading}
                placeholder="为你的 Skill 起个名字"
                maxLength={160}
                onChange={(event) => {
                  setName(event.target.value);
                  setLocalError(undefined);
                }}
              />
            </label>

            <label className="newmax-import-field">
              <span>Skill 描述</span>
              <div className="newmax-import-field__textarea">
                <textarea
                  value={description}
                  disabled={props.loading}
                  placeholder="简要描述这个 Skill 的功能和用途"
                  maxLength={200}
                  rows={3}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <em>{description.length}/200</em>
              </div>
            </label>

            <section className="newmax-import-field newmax-import-scope" ref={scopeFieldRef}>
              <strong>安装位置</strong>
              <button
                type="button"
                className="newmax-import-scope__trigger"
                aria-haspopup="menu"
                aria-expanded={scopeOpen}
                disabled={props.loading}
                onClick={() => setScopeOpen((open) => !open)}
              >
                <span>
                  {scopes.length > 0
                    ? scopes.map((scope) => scopeLabel(scope)).join('、')
                    : '选择安装位置'}
                </span>
                <ChevronDown size={14} />
              </button>
              {scopeOpen ? (
                <div className="newmax-import-scope__menu" role="menu" aria-label="安装位置">
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={scopes.some((scope) => scope.type === 'global')}
                    onClick={() => toggleScope({ type: 'global' })}
                  >
                    <span className="newmax-import-scope__check">
                      {scopes.some((scope) => scope.type === 'global') ? <Check size={12} /> : null}
                    </span>
                    <span>
                      <strong>全局</strong>
                      <small>~/.sync-think/skills</small>
                    </span>
                  </button>
                  {availableWorkspaces.map((workspace) => {
                    const next: SkillLocalInstallScope = {
                      type: 'workspace',
                      workspaceId: workspace.workspaceId,
                    };
                    const checked = scopes.some(
                      (scope) => localSkillScopeKey(scope) === localSkillScopeKey(next),
                    );
                    const root = workspace.folderPath?.replace(/[\\/]+$/, '') ?? '';
                    return (
                      <button
                        key={workspace.workspaceId}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        onClick={() => toggleScope(next)}
                      >
                        <span className="newmax-import-scope__check">
                          {checked ? <Check size={12} /> : null}
                        </span>
                        <span>
                          <strong>{workspace.name}</strong>
                          <small>{root}\.claude\skills</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>

            {localError || props.error ? (
              <div className="newmax-import-error" role="alert">
                <AlertTriangle size={14} />
                {localError ?? props.error}
              </div>
            ) : null}
          </div>

          <footer className="newmax-import-dialog__footer">
            <Dialog.Close asChild>
              <button type="button" className="is-cancel" disabled={props.loading}>
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-testid="skill-local-import-submit"
              className="is-primary"
              disabled={props.loading || inspecting || scopes.length === 0}
              onClick={() => void submit()}
            >
              {props.loading ? (
                <Loader2 className="animate-spin" size={13} />
              ) : (
                <Upload size={13} />
              )}
              {props.loading ? '导入中' : '导入'}
            </button>
          </footer>
          {dragActive ? (
            <div className="newmax-import-drop-overlay" aria-hidden="true">
              <Upload size={18} />
              拖放到这里导入
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
