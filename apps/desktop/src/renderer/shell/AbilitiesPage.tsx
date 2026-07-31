// Skill 能力中心：管理已安装的 SKILL.md（粘贴 / 文件 / URL 下载 / 示例导入），
// 查看完整 Skill 内容，并管理 MCP 服务器注册。
// 安全边界保持在 Runtime：这里只读取文本并调用 skill.import，绝不执行脚本。
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  Library,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ImportSkillResponse,
  McpServerSummary,
  SkillVersionSummary,
} from '@sync-think/protocol';

const MAX_SKILL_MD_CHARS = 512_000;

const EXAMPLE_SKILLS = [
  {
    id: 'code-review',
    name: '代码审查',
    description: '按严重程度发现缺陷，并给出可执行的修改建议。',
    source: `---
name: code-review
description: 按严重程度发现缺陷，并给出可执行的修改建议
version: 0.1.0
allowed-tools: ["read-file"]
---

你是严谨的代码审查员。收到代码或变更时：
1. 先检查正确性、安全性、边界条件和回归风险。
2. 问题按严重程度排序，并给出文件位置和可复现情形。
3. 只报告能够说明因果的问题，不把风格偏好当成缺陷。
4. 每个问题都给出最小、可执行的修改建议。
5. 若没有实质问题，明确说明未发现阻塞项。
`,
  },
  {
    id: 'test-writer',
    name: '测试补全',
    description: '从行为与边界出发补充稳定、可维护的自动化测试。',
    source: `---
name: test-writer
description: 从行为与边界出发补充稳定、可维护的自动化测试
version: 0.1.0
allowed-tools: ["read-file"]
---

你是测试工程师。为功能补测试时：
1. 先提炼公开行为、输入边界和失败路径。
2. 优先写能够捕获真实回归的测试，避免只验证实现细节。
3. 覆盖正常路径、空值、边界值和关键异常。
4. 测试名称说明场景与期望结果，固定时间与随机性。
5. 最后说明尚未覆盖的风险。
`,
  },
  {
    id: 'product-writer-zh',
    name: '中文产品说明',
    description: '把技术能力整理成清晰、克制、可操作的中文说明。',
    source: `---
name: product-writer-zh
description: 把技术能力整理成清晰、克制、可操作的中文说明
version: 0.1.0
---

你是中文产品文案编辑。输出说明文档时：
1. 先回答“它解决什么问题”，再说明“怎么使用”。
2. 使用短句、明确标题和可执行步骤，避免空泛宣传。
3. 区分已支持、有限支持和暂未支持的能力。
4. 技术术语首次出现时给出一句通俗解释。
5. 结尾提供最短验收路径。
`,
  },
] as const;

type SkillFamily = {
  skillId: string;
  latest: SkillVersionSummary;
  versions: SkillVersionSummary[];
};

function bridge() {
  return window.syncThink?.runtime;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function groupSkillVersions(skills: readonly SkillVersionSummary[]): SkillFamily[] {
  const families = new Map<string, SkillVersionSummary[]>();
  for (const skill of skills) {
    const rows = families.get(skill.skillId) ?? [];
    rows.push(skill);
    families.set(skill.skillId, rows);
  }
  return [...families.entries()]
    .map(([skillId, versions]) => ({
      skillId,
      versions: [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      latest: [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!,
    }))
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

function importResultMessage(result: ImportSkillResponse): string {
  if (result.deduped) return `「${result.skill.name}」的相同版本已存在，无需重复导入。`;
  if (result.reapprovalRequest) {
    return `已导入「${result.skill.name}」@${result.skill.version}。本次权限扩大，已提交审批，批准前不会自动获得新增权限。`;
  }
  return `已导入「${result.skill.name}」@${result.skill.version}。现在可以前往智能体库装备。`;
}

export function AbilitiesPage(props: {
  onGoToAgents(): void;
  onCatalogChanged?(): void;
}) {
  const [skills, setSkills] = useState<SkillVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [importStatus, setImportStatus] = useState<string>();
  // 能力中心两个板块：Skill / MCP 服务器。
  const [section, setSection] = useState<'skills' | 'mcp'>('skills');
  // URL 下载导入。
  const [urlDraft, setUrlDraft] = useState('');
  const [downloading, setDownloading] = useState(false);
  // Skill 全文查看（skill.get 懒加载）。
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceText, setSourceText] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const loadRequestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSkills = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const api = bridge();
    if (!api) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError('Runtime bridge 不可用');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      const response = await api.listSkills({ limit: 500 });
      if (requestId !== loadRequestRef.current) return;
      setSkills(response.skills);
      setSelectedId((current) =>
        current && response.skills.some((skill) => skill.skillVersionId === current)
          ? current
          : response.skills[0]?.skillVersionId,
      );
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : '读取 Skill 库失败');
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const families = useMemo(() => groupSkillVersions(skills), [skills]);
  const visibleFamilies = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return families;
    return families.filter((family) =>
      [
        family.latest.name,
        family.latest.description,
        family.skillId,
        ...family.versions.map((version) => version.version),
      ]
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [families, query]);
  const selected = skills.find((skill) => skill.skillVersionId === selectedId);

  const openImporter = (source = '') => {
    setDraft(source);
    setFileName(undefined);
    setImportError(undefined);
    setImportStatus(undefined);
    setImportOpen(true);
  };

  const importSource = useCallback(
    async (source = draft) => {
      const api = bridge();
      if (!api || importing) return;
      if (!source.trim()) {
        setImportError('请粘贴 SKILL.md 内容，或选择本地文件。');
        return;
      }
      if (source.length > MAX_SKILL_MD_CHARS) {
        setImportError('SKILL.md 超过 512,000 字符限制。');
        return;
      }
      setImporting(true);
      setImportError(undefined);
      setImportStatus(undefined);
      try {
        const result = await api.importSkill({ skillMd: source });
        setImportStatus(importResultMessage(result));
        setDraft(source);
        await loadSkills();
        setSelectedId(result.skill.skillVersionId);
        props.onCatalogChanged?.();
      } catch (error) {
        setImportError(error instanceof Error ? error.message : '导入 SKILL.md 失败');
      } finally {
        setImporting(false);
      }
    },
    [draft, importing, loadSkills, props],
  );

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    setImportError(undefined);
    setImportStatus(undefined);
    if (file.size > MAX_SKILL_MD_CHARS * 4) {
      setImportError('文件过大，请选择不超过 2 MB 的 SKILL.md。');
      return;
    }
    try {
      const source = await file.text();
      if (source.length > MAX_SKILL_MD_CHARS) {
        setImportError('SKILL.md 超过 512,000 字符限制。');
        return;
      }
      setDraft(source.replace(/^\uFEFF/, ''));
      setFileName(file.name);
    } catch {
      setImportError('无法读取所选文件，请确认它是 UTF-8 文本。');
    }
  }, []);

  const installExample = useCallback(
    async (source: string) => {
      setImportOpen(true);
      setDraft(source);
      setFileName(undefined);
      setImportError(undefined);
      setImportStatus(undefined);
      await importSource(source);
    },
    [importSource],
  );

  const handleDelete = useCallback(async () => {
    const api = bridge();
    if (!api?.deleteSkill || !selected || importing) return;
    const confirmed = window.confirm(
      `确定卸载「${selected.name}」@${selected.version}？如果仍有智能体装备或授权引用，系统会拒绝卸载。`,
    );
    if (!confirmed) return;
    setImportError(undefined);
    try {
      await api.deleteSkill({ skillVersionId: selected.skillVersionId });
      setImportStatus(`已卸载「${selected.name}」@${selected.version}。`);
      await loadSkills();
      props.onCatalogChanged?.();
    } catch (error) {
      const raw = error instanceof Error ? error.message : '卸载 Skill 失败';
      const message = /equipped|authorized|references|in.use/i.test(raw)
        ? '该版本仍被智能体装备或授权记录引用，请先解除绑定后再卸载。'
        : raw;
      setImportError(message);
      window.alert(message);
    }
  }, [importing, loadSkills, props, selected]);

  // 从公网 URL 下载 SKILL.md（走主进程代理，renderer CSP 不放外网）。
  const handleDownloadFromUrl = useCallback(async () => {
    const api = bridge();
    const url = urlDraft.trim();
    if (!api?.fetchSkillMd || !url || downloading) return;
    setDownloading(true);
    setImportError(undefined);
    setImportStatus(undefined);
    try {
      const result = await api.fetchSkillMd({ url });
      setDraft(result.skillMd);
      setFileName(undefined);
      setImportStatus(`已从 ${result.url} 下载 ${result.skillMd.length.toLocaleString()} 字符，请确认内容后点「导入」。`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '下载失败，请检查链接');
    } finally {
      setDownloading(false);
    }
  }, [downloading, urlDraft]);

  // 查看完整 SKILL.md（skill.get 懒加载）。
  const handleViewSource = useCallback(async () => {
    const api = bridge();
    if (!api?.getSkill || !selected) return;
    setSourceOpen(true);
    setSourceLoading(true);
    setSourceError(undefined);
    setSourceText(undefined);
    try {
      const result = await api.getSkill({ skillVersionId: selected.skillVersionId });
      setSourceText(result.sourceMd);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : '读取 Skill 内容失败');
    } finally {
      setSourceLoading(false);
    }
  }, [selected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page" data-testid="abilities-page">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="m-0 text-[14px] font-semibold text-text">能力中心</h1>
            <p className="m-0 mt-0.5 text-[10.5px] text-text-faint">
              {section === 'skills'
                ? '安装可复用的 Skill，再装备给一个或多个智能体'
                : '注册 MCP 服务器，把外部工具接入对话'}
            </p>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg bg-page p-0.5" role="tablist" aria-label="能力类型">
            <button
              type="button"
              role="tab"
              aria-selected={section === 'skills'}
              className={`flex h-6.5 items-center gap-1 rounded-md px-2.5 text-[11.5px] ${section === 'skills' ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-faint hover:text-text-secondary'}`}
              onClick={() => setSection('skills')}
            >
              <Sparkles size={11} /> Skill
            </button>
            <button
              type="button"
              role="tab"
              data-testid="abilities-section-mcp"
              aria-selected={section === 'mcp'}
              className={`flex h-6.5 items-center gap-1 rounded-md px-2.5 text-[11.5px] ${section === 'mcp' ? 'bg-surface font-medium text-text shadow-sm' : 'text-text-faint hover:text-text-secondary'}`}
              onClick={() => setSection('mcp')}
            >
              <Plug size={11} /> MCP
            </button>
          </div>
        </div>
        {section === 'skills' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] text-text-secondary hover:bg-hover"
              onClick={() => void loadSkills()}
              disabled={loading}
              title="刷新 Skill 列表"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
            </button>
            <button
              type="button"
              data-testid="open-skill-import"
              className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
              onClick={() => openImporter()}
            >
              <Plus size={13} /> 导入 Skill
            </button>
          </div>
        ) : null}
      </header>

      {section === 'mcp' ? (
        <McpSection />
      ) : (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
            <div className="relative min-w-0 flex-1">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <input
                className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[12.5px] text-text focus:border-accent focus:outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、描述或版本"
                aria-label="搜索 Skill"
              />
            </div>
            <span className="shrink-0 text-[11.5px] text-text-faint">
              {families.length} 个 Skill · {skills.length} 个版本
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-text-faint">
                <Loader2 size={15} className="animate-spin" /> 正在读取能力库…
              </div>
            ) : loadError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <AlertTriangle size={24} className="text-error" />
                <div>
                  <p className="m-0 text-[13px] font-medium text-text">能力库加载失败</p>
                  <p className="m-0 mt-1 max-w-md text-[11.5px] text-text-faint">{loadError}</p>
                </div>
                <button className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-hover" onClick={() => void loadSkills()}>
                  重试
                </button>
              </div>
            ) : families.length === 0 ? (
              <EmptySkillLibrary onImport={() => openImporter()} onInstallExample={(source) => void installExample(source)} />
            ) : visibleFamilies.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12.5px] text-text-faint">
                没有匹配的 Skill
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))' }}>
                {visibleFamilies.map((family) => {
                  const expanded = expandedFamilies.has(family.skillId);
                  return (
                    <article key={family.skillId} className="overflow-hidden rounded-xl border border-border bg-surface">
                      <button
                        type="button"
                        className="flex w-full items-start gap-3 p-4 text-left hover:bg-hover"
                        onClick={() => setSelectedId(family.latest.skillVersionId)}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                          <Sparkles size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-medium text-text">{family.latest.name}</span>
                            <span className="shrink-0 rounded-md bg-page px-1.5 py-0.5 text-[10px] text-text-faint">v{family.latest.version}</span>
                          </span>
                          <span className="mt-1 line-clamp-2 block min-h-8 text-[11.5px] leading-4 text-text-secondary">
                            {family.latest.description || '未提供说明'}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-faint">
                            <span>{family.latest.allowedTools.length} 个工具声明</span>
                            {family.latest.hasScripts ? <span className="text-warning">· 含脚本声明</span> : null}
                            <span>· {formatDate(family.latest.createdAt)}</span>
                          </span>
                        </span>
                      </button>
                      {family.versions.length > 1 ? (
                        <div className="border-t border-border">
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 px-4 py-2 text-[11px] text-text-faint hover:bg-hover hover:text-text-secondary"
                            onClick={() => setExpandedFamilies((current) => {
                              const next = new Set(current);
                              if (next.has(family.skillId)) next.delete(family.skillId);
                              else next.add(family.skillId);
                              return next;
                            })}
                          >
                            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {family.versions.length} 个已安装版本
                          </button>
                          {expanded ? (
                            <div className="border-t border-border bg-page p-1.5">
                              {family.versions.map((version) => (
                                <button
                                  type="button"
                                  key={version.skillVersionId}
                                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[11.5px] hover:bg-hover"
                                  onClick={() => setSelectedId(version.skillVersionId)}
                                >
                                  <span className="text-text">v{version.version}</span>
                                  <span className="text-text-faint">{formatDate(version.createdAt)}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="hidden w-[320px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface xl:flex">
          {selected ? (
            <SkillDetails
              skill={selected}
              onImportNewVersion={() => openImporter()}
              onGoToAgents={props.onGoToAgents}
              onDelete={() => void handleDelete()}
              onViewSource={() => void handleViewSource()}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-[11.5px] text-text-faint">
              选择一个 Skill 查看版本与安全信息
            </div>
          )}
        </aside>
      </div>
      )}

      {importOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.34)] p-6" role="presentation">
          <section className="flex max-h-[82vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="skill-import-title">
            <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
              <div>
                <h2 id="skill-import-title" className="m-0 text-[14px] font-semibold text-text">导入 SKILL.md</h2>
                <p className="m-0 mt-0.5 text-[10.5px] text-text-faint">只解析说明文本，不会自动执行其中声明的脚本或工具</p>
              </div>
              <button className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text" onClick={() => setImportOpen(false)} aria-label="关闭导入">
                <X size={15} />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Globe size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
                  <input
                    data-testid="skill-url-input"
                    className="h-8 w-full rounded-lg border border-border bg-page pl-8 pr-3 text-[12px] text-text focus:border-accent focus:outline-none"
                    value={urlDraft}
                    onChange={(event) => setUrlDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleDownloadFromUrl();
                    }}
                    placeholder="粘贴网上 SKILL.md 链接（支持 GitHub 页面地址）"
                    spellCheck={false}
                  />
                </div>
                <button
                  type="button"
                  data-testid="skill-url-download"
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:bg-hover disabled:opacity-40"
                  disabled={downloading || !urlDraft.trim()}
                  onClick={() => void handleDownloadFromUrl()}
                >
                  {downloading ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
                  {downloading ? '下载中…' : '下载'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:bg-hover" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} /> 选择本地文件
                </button>
                <input
                  ref={fileRef}
                  className="hidden"
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  onChange={(event) => {
                    void handleFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {fileName ? <span className="text-[11.5px] text-text-faint">已读取 {fileName}</span> : null}
                <span className="ml-auto text-[10.5px] text-text-faint">{draft.length.toLocaleString()} / {MAX_SKILL_MD_CHARS.toLocaleString()} 字符</span>
              </div>

              <textarea
                data-testid="skill-md-input"
                className="min-h-[330px] w-full flex-1 resize-y rounded-xl border border-border bg-page px-4 py-3 font-mono text-[12px] leading-5 text-text focus:border-accent focus:outline-none"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setImportError(undefined);
                  setImportStatus(undefined);
                }}
                placeholder={'---\nname: my-skill\ndescription: 这个能力做什么\nversion: 0.1.0\n---\n\n写下这个 Skill 的工作流程与约束…'}
                spellCheck={false}
              />

              <div className="flex flex-wrap gap-1.5">
                <span className="mr-1 self-center text-[10.5px] text-text-faint">填入示例：</span>
                {EXAMPLE_SKILLS.map((example) => (
                  <button key={example.id} type="button" className="rounded-md bg-page px-2 py-1 text-[10.5px] text-text-secondary hover:bg-hover" onClick={() => {
                    setDraft(example.source);
                    setFileName(undefined);
                    setImportError(undefined);
                    setImportStatus(undefined);
                  }}>
                    {example.name}
                  </button>
                ))}
              </div>

              {importError ? (
                <div className="flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[11.5px] text-error" role="alert">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {importError}
                </div>
              ) : null}
              {importStatus ? (
                <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[11.5px] text-accent-text" role="status">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> {importStatus}
                </div>
              ) : null}
            </div>

            <footer className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
              <span className="flex items-center gap-1.5 text-[10.5px] text-text-faint"><ShieldCheck size={12} /> 安装不等于授权，需由智能体显式装备</span>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-hover" onClick={() => setImportOpen(false)}>关闭</button>
                <button type="button" data-testid="import-skill-submit" className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-40" disabled={importing || !draft.trim() || draft.length > MAX_SKILL_MD_CHARS} onClick={() => void importSource()}>
                  {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {importing ? '导入中…' : '导入'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {sourceOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.34)] p-6" role="presentation" onClick={() => setSourceOpen(false)}>
          <section
            className="flex max-h-[82vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-source-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
              <div>
                <h2 id="skill-source-title" className="m-0 text-[14px] font-semibold text-text">
                  {selected ? `${selected.name} @${selected.version}` : 'Skill 内容'}
                </h2>
                <p className="m-0 mt-0.5 text-[10.5px] text-text-faint">完整 SKILL.md 源文本 · 只读展示，不会执行其中脚本</p>
              </div>
              <button className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text" onClick={() => setSourceOpen(false)} aria-label="关闭">
                <X size={15} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {sourceLoading ? (
                <div className="flex h-40 items-center justify-center gap-2 text-[12.5px] text-text-faint">
                  <Loader2 size={15} className="animate-spin" /> 正在读取…
                </div>
              ) : sourceError ? (
                <div className="flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[11.5px] text-error" role="alert">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {sourceError}
                </div>
              ) : (
                <pre
                  data-testid="skill-source-view"
                  className="m-0 whitespace-pre-wrap break-words rounded-xl border border-border bg-page p-4 font-mono text-[12px] leading-5 text-text"
                >
                  {sourceText}
                </pre>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** MCP 服务器板块：列出已注册服务器与工具，支持注册远程/本地服务器与刷新工具清单。 */
function McpSection() {
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'local-stdio' | 'remote-http'>('local-stdio');
  const [endpoint, setEndpoint] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string>();

  const load = useCallback(async () => {
    const api = bridge();
    if (!api?.listMcpServers) {
      setError('Runtime bridge 不可用');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const response = await api.listMcpServers({ limit: 100 });
      setServers(response.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取 MCP 服务器失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRegister = useCallback(async () => {
    const api = bridge();
    if (!api?.registerMcpServer || saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请填写服务器名称');
      return;
    }
    setSaving(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const result = await api.registerMcpServer({
        name: trimmedName,
        transport,
        endpoint: endpoint.trim() || undefined,
        trusted,
      });
      setStatus(
        result.updated
          ? `已更新服务器「${result.server.name}」。`
          : `已注册服务器「${result.server.name}」。注册只保存元数据，不会立即启动进程。`,
      );
      setFormOpen(false);
      setName('');
      setEndpoint('');
      setTrusted(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册 MCP 服务器失败');
    } finally {
      setSaving(false);
    }
  }, [endpoint, load, name, saving, transport, trusted]);

  const handleRefreshTools = useCallback(
    async (server: McpServerSummary) => {
      const api = bridge();
      if (!api?.refreshMcpTools || refreshingId) return;
      setRefreshingId(server.mcpServerId);
      setError(undefined);
      setStatus(undefined);
      try {
        await api.refreshMcpTools({ mcpServerId: server.mcpServerId });
        setStatus(`已刷新「${server.name}」的工具清单。`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : '刷新工具清单失败（服务器可能未运行）');
      } finally {
        setRefreshingId(undefined);
      }
    },
    [load, refreshingId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="mcp-section">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <span className="text-[11.5px] text-text-faint">
          {servers.length} 个已注册服务器 · 注册仅保存元数据，工具调用仍需权限与审批
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] text-text-secondary hover:bg-hover"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
          <button
            type="button"
            data-testid="mcp-register-open"
            className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90"
            onClick={() => setFormOpen((v) => !v)}
          >
            <Plus size={13} /> 注册服务器
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {formOpen ? (
          <div className="mb-4 rounded-xl border border-border bg-surface p-4">
            <h3 className="m-0 text-[13px] font-semibold text-text">注册 MCP 服务器</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-text-faint">名称</span>
                <input
                  data-testid="mcp-name-input"
                  className="h-8 w-full rounded-lg border border-border bg-page px-3 text-[12px] text-text focus:border-accent focus:outline-none"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如 filesystem-tools"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-text-faint">传输方式</span>
                <select
                  className="h-8 w-full rounded-lg border border-border bg-page px-2 text-[12px] text-text focus:border-accent focus:outline-none"
                  value={transport}
                  onChange={(event) => setTransport(event.target.value as 'local-stdio' | 'remote-http')}
                >
                  <option value="local-stdio">本地进程（stdio）</option>
                  <option value="remote-http">远程 HTTP</option>
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1 block text-[11px] text-text-faint">
                  {transport === 'local-stdio' ? '启动命令（如 npx -y @modelcontextprotocol/server-filesystem D:\\data）' : '服务器 URL'}
                </span>
                <input
                  className="h-8 w-full rounded-lg border border-border bg-page px-3 font-mono text-[11.5px] text-text focus:border-accent focus:outline-none"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={transport === 'local-stdio' ? 'npx -y @modelcontextprotocol/server-…' : 'https://…'}
                  spellCheck={false}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-text-secondary md:col-span-2">
                <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
                标记为可信来源（不勾选时输出按不可信内容处理）
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-hover" onClick={() => setFormOpen(false)}>
                取消
              </button>
              <button
                type="button"
                data-testid="mcp-register-submit"
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:opacity-40"
                disabled={saving || !name.trim()}
                onClick={() => void handleRegister()}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                {saving ? '注册中…' : '注册'}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[11.5px] text-error" role="alert">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        ) : null}
        {status ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[11.5px] text-accent-text" role="status">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> {status}
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-[12.5px] text-text-faint">
            <Loader2 size={15} className="animate-spin" /> 正在读取 MCP 服务器…
          </div>
        ) : servers.length === 0 ? (
          <div className="mx-auto flex max-w-[560px] flex-col items-center py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
              <Plug size={25} />
            </span>
            <h2 className="m-0 mt-4 text-[15px] font-semibold text-text">还没有 MCP 服务器</h2>
            <p className="m-0 mt-1 text-[12px] leading-5 text-text-faint">
              注册一个 MCP 服务器，把外部工具（文件系统、数据库、API 等）接入对话。注册只保存元数据，实际调用仍受权限与审批控制。
            </p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))' }}>
            {servers.map((server) => (
              <article key={server.mcpServerId} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                    <Plug size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-text">{server.name}</span>
                      <span className="shrink-0 rounded-md bg-page px-1.5 py-0.5 text-[10px] text-text-faint">
                        {server.transport === 'local-stdio' ? '本地' : server.transport === 'remote-http' ? '远程' : server.transport}
                      </span>
                      {server.trusted ? (
                        <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent-text">可信</span>
                      ) : null}
                    </div>
                    {server.endpoint ? (
                      <p className="m-0 mt-1 truncate font-mono text-[10.5px] text-text-faint" title={server.endpoint}>
                        {server.endpoint}
                      </p>
                    ) : null}
                    <p className="m-0 mt-1.5 text-[11px] text-text-secondary">
                      {server.tools.length > 0 ? `${server.tools.length} 个工具` : '尚未发现工具（点右侧刷新）'}
                    </p>
                    {server.tools.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {server.tools.slice(0, 6).map((tool) => (
                          <span key={tool.name} className="rounded-md bg-page px-1.5 py-0.5 font-mono text-[10px] text-text-secondary" title={tool.description}>
                            {tool.name}
                          </span>
                        ))}
                        {server.tools.length > 6 ? (
                          <span className="text-[10px] text-text-faint">+{server.tools.length - 6}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-hover hover:text-text"
                    title="向服务器请求最新工具清单"
                    disabled={Boolean(refreshingId)}
                    onClick={() => void handleRefreshTools(server)}
                  >
                    <RefreshCw size={13} className={refreshingId === server.mcpServerId ? 'animate-spin' : ''} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptySkillLibrary(props: { onImport(): void; onInstallExample(source: string): void }) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col items-center py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-text"><Library size={25} /></span>
      <h2 className="m-0 mt-4 text-[15px] font-semibold text-text">能力库还是空的</h2>
      <p className="m-0 mt-1 max-w-lg text-[12px] leading-5 text-text-faint">导入一份 SKILL.md，把固定工作流程变成可复用能力。安装后可装备给多个智能体。</p>
      <button type="button" className="mt-4 flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-[var(--color-accent-fg)] hover:opacity-90" onClick={props.onImport}><Upload size={13} /> 导入我的 SKILL.md</button>
      <div className="mt-8 w-full text-left">
        <p className="m-0 mb-2 text-[11px] font-medium text-text-faint">或者一键安装示例</p>
        <div className="grid grid-cols-3 gap-2">
          {EXAMPLE_SKILLS.map((example) => (
            <button key={example.id} type="button" className="rounded-xl border border-border bg-surface p-3 text-left hover:border-border-strong hover:bg-hover" onClick={() => props.onInstallExample(example.source)}>
              <FileText size={15} className="text-accent" />
              <span className="mt-2 block text-[12.5px] font-medium text-text">{example.name}</span>
              <span className="mt-1 line-clamp-3 block text-[10.5px] leading-4 text-text-faint">{example.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkillDetails(props: {
  skill: SkillVersionSummary;
  onImportNewVersion(): void;
  onGoToAgents(): void;
  onDelete(): void;
  onViewSource(): void;
}) {
  const { skill } = props;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text"><Sparkles size={19} /></span>
        <h2 className="m-0 mt-3 break-words text-[15px] font-semibold text-text">{skill.name}</h2>
        <p className="m-0 mt-1 text-[11.5px] leading-5 text-text-secondary">{skill.description || '未提供说明'}</p>

        <dl className="mt-5 grid grid-cols-[82px_1fr] gap-x-3 gap-y-2 text-[11px]">
          <dt className="text-text-faint">版本</dt><dd className="m-0 break-all text-text">{skill.version}</dd>
          <dt className="text-text-faint">安装日期</dt><dd className="m-0 text-text">{formatDate(skill.createdAt)}</dd>
          <dt className="text-text-faint">Skill ID</dt><dd className="m-0 break-all font-mono text-[10px] text-text-secondary">{skill.skillId}</dd>
          <dt className="text-text-faint">版本 ID</dt><dd className="m-0 break-all font-mono text-[10px] text-text-secondary">{skill.skillVersionId}</dd>
          <dt className="text-text-faint">内容指纹</dt><dd className="m-0 break-all font-mono text-[10px] text-text-secondary">{skill.contentFingerprint}</dd>
        </dl>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="m-0 text-[11.5px] font-semibold text-text">工具声明</h3>
          {skill.allowedTools.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">{skill.allowedTools.map((tool) => <span key={tool} className="rounded-md bg-page px-2 py-1 font-mono text-[10px] text-text-secondary">{tool}</span>)}</div>
          ) : <p className="m-0 mt-1 text-[11px] text-text-faint">未声明工具权限</p>}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="m-0 text-[11.5px] font-semibold text-text">安全状态</h3>
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-page p-3">
            {skill.hasScripts ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" /> : <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />}
            <p className="m-0 text-[10.5px] leading-4 text-text-secondary">{skill.hasScripts ? '该 Skill 声明了脚本或执行类工具。SYNC-THINK 只保存声明，不会在导入时执行；实际调用仍受权限与审批控制。' : '导入阶段仅解析文本，没有发现脚本声明。工具是否可用仍由智能体装备与权限策略决定。'}</p>
          </div>
          {skill.warnings.length ? <ul className="m-0 mt-2 space-y-1 pl-4 text-[10.5px] text-warning">{skill.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border p-4">
        <button type="button" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-[12px] font-medium text-[var(--color-accent-fg)] hover:opacity-90" onClick={props.onGoToAgents}><Sparkles size={13} /> 前往智能体库装备</button>
        <button type="button" data-testid="skill-view-source" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] text-text-secondary hover:bg-hover" onClick={props.onViewSource}><Code2 size={13} /> 查看完整内容</button>
        <button type="button" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] text-text-secondary hover:bg-hover" onClick={props.onImportNewVersion}><Upload size={13} /> 导入新版本</button>
        <button type="button" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12px] text-error hover:bg-error/10" onClick={props.onDelete}>卸载当前版本</button>
      </div>
    </div>
  );
}
