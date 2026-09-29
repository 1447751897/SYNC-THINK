import { pushLibraryNavigation, readLibraryNavigation } from './design-system/navigation.js';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  Menu,
  Palette,
  Search,
  Shapes,
  X,
} from 'lucide-react';
import { CopyTextButton } from './CopyTextButton.js';
import { TOKEN_CATALOG } from './design-system/catalog.generated.js';
import {
  DOCUMENTED_COMPONENTS,
  visibleSections,
  filterComponents,
  readLibraryRoute,
  routeHash,
  type DocumentedComponent,
  type LibraryRoute,
} from './design-system/catalog.js';
import { PreviewFrame, PreviewTheme } from './design-system/PreviewFrame.js';
import { TokenEditor } from './design-system/TokenEditor.js';
import { ThemeInspector, download } from './design-system/ThemeInspector.js';
import { STORAGE_KEY, exportThemeCss, readDraft, themeValues } from './design-system/theme.js';

const groups = [...new Set(TOKEN_CATALOG.map((t) => t.group))];
const liveCount = DOCUMENTED_COMPONENTS.filter((c) => c.live).length;
const compositions = new Set([
  'ShellApp',
  'compose-toolbar',
  'CitationContext',
  'KeepAliveLayer',
  'FileDiffSurface',
  'BrowserPanel',
]);
const wideComponents = new Set([
  'ChatView',
  'CollaborationChatView',
  'BotConversationPane',
  'AgentLibrary',
  'TeamLibrary',
  'AbilityCenterPage',
  'BrowserStage',
  'BrowserTaskDashboard',
  'BrowserWorkflowPanel',
  'BrowserPanel',
  'TaskPanel',
  'TaskCalendar',
  'ActivityCenterPage',
  'SettingsPage',
  'PreferencesSettings',
  'ModelSettings',
  'ImageGenerationSettings',
  'WebSearchSettings',
  'ProjectlessDataSetting',
  'ShellApp',
  'WorkspaceWorkbench',
  'WorkspacePaneHost',
  'ExcalidrawPreview',
  'ExcalidrawDraftPreview',
  'FilePane',
  'WorkspaceFileView',
  'GitPanel',
  'TerminalPane',
  'RightDock',
]);
const featuredNames = [
  'CodeBlockButton',
  'AgentAvatarView',
  'SlidingTabs',
  'ComposerEditor',
  'ToolApprovalCard',
  'CodeBlock',
];
function ComponentCard({
  component: c,
  onOpen,
}: {
  component: DocumentedComponent;
  onOpen: () => void;
}) {
  const wide = wideComponents.has(c.name);
  return (
    <article className={`ds-visual-card${wide ? ' is-page-preview' : ''}`}>
      <div className="ds-visual-card-stage">
        <PreviewFrame name={c.name} thumbnail wide={wide} />
        <button
          className="ds-visual-card-cover"
          type="button"
          onClick={onOpen}
          aria-label={`查看 ${c.title} · ${c.name}`}
        >
          <span>
            打开交互预览 <ArrowUpRight size={14} />
          </span>
        </button>
      </div>
      <button className="ds-visual-card-caption" type="button" onClick={onOpen}>
        <span>
          <strong>{c.title}</strong>
          <small>{c.description}</small>
        </span>
        <ArrowUpRight size={15} />
      </button>
      <div className="ds-visual-card-meta">
        <code>{c.name}</code>
        <span>
          {c.legacy
            ? '历史结构复原'
            : compositions.has(c.name)
              ? '组件组合 · 演示场景'
              : '原组件 · 演示数据'}
        </span>
      </div>
    </article>
  );
}
function ComponentDetail({
  component: c,
  onNavigate,
}: {
  component: DocumentedComponent;
  onNavigate: (route: LibraryRoute) => void;
}) {
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const [revision, setRevision] = useState(0);
  const [variant, setVariant] = useState('default');
  const alternate =
    c.name === 'ToolResult' ? '错误状态' : c.name === 'AgentActivity' ? '执行中' : null;
  const emptyState = ['AgentLibrary', 'TeamLibrary'].includes(c.name);
  const section = visibleSections.find((s) => s.id === c.section)!;
  const siblings = filterComponents('', c.section);
  const index = siblings.findIndex((item) => item.id === c.id);
  return (
    <>
      <div className="ds-doc-breadcrumb">
        <button type="button" onClick={() => onNavigate({ view: 'overview' })}>
          组件
        </button>
        <ChevronRight size={12} />
        <button type="button" onClick={() => onNavigate({ view: 'category', section: c.section })}>
          {section.title}
        </button>
        <ChevronRight size={12} />
        <span>{c.title}</span>
      </div>
      <header className="ds-doc-heading">
        <h1>{c.title}</h1>
        <p>{c.description}</p>
      </header>
      <div className="ds-preview-toolbar">
        <div className="ds-detail-tabs" role="group" aria-label="组件详情内容">
          <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
            设计与交互
          </button>
          <button type="button" aria-pressed={tab === 'source'} onClick={() => setTab('source')}>
            <Code2 size={13} />
            实现说明
          </button>
        </div>
        {(alternate || emptyState) && (
          <select
            className="ds-preview-state-select"
            aria-label="预览状态"
            value={variant}
            onChange={(event) => setVariant(event.target.value)}
          >
            <option value="default">默认状态</option>
            <option value={emptyState ? 'empty' : 'alternate'}>
              {emptyState ? '空状态' : alternate}
            </option>
          </select>
        )}
        <button
          type="button"
          className="ds-button ds-button--secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          重置预览
        </button>
        <span>{c.legacy ? '历史结构复原 · 非现役样式' : '本地演示 · 不连接工作区'}</span>
      </div>
      {tab === 'preview' ? (
        <section className="ds-component-stage" aria-label={`${c.title} 组件预览`}>
          <PreviewFrame
            key={revision}
            variant={variant}
            name={c.name}
            wide={wideComponents.has(c.name)}
          />
        </section>
      ) : (
        <section className="ds-doc-source">
          <h2>组件如何实现</h2>
          <p>
            {c.legacy
              ? '历史 React 组件的结构与交互复原。旧版样式表已从仓库移除，此处使用独立的归档样式，不代表现役桌面设计。'
              : compositions.has(c.name)
                ? '本场景由 Sync-Think 原有组件组合而成，展示它们如何在实际界面中协作。应用启动、浏览器网页与业务数据由本地演示替代，不连接真实工作区。'
                : '直接导入 Sync-Think 的现有组件，保留其样式与交互。业务数据由独立预览页提供，输入、选择与审批仅改变演示状态。'}
          </p>
          <h2>源码位置</h2>
          <div className="ds-doc-source-path">
            <code>{c.source}</code>
            <CopyTextButton text={c.source} label="复制源码路径" />
          </div>
          <h2>公开导出</h2>
          <div className="ds-doc-exports">
            {c.exports.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
        </section>
      )}
      <div className="ds-design-notes">
        <section>
          <h2>使用场景</h2>
          <p>{section.description}</p>
          <span>
            {section.title} / {section.english}
          </span>
        </section>
        <section>
          <h2>主题与状态</h2>
          <p>打开主题工作台，切换明暗、修改颜色或圆角。预览画布同步使用相同的语义变量。</p>
          <code>--color-panel · --color-text · --color-accent</code>
        </section>
      </div>
      <nav className="ds-doc-pagination" aria-label="同类组件">
        {index > 0 ? (
          <button
            type="button"
            onClick={() => onNavigate({ view: 'component', id: siblings[index - 1].id })}
          >
            <ArrowLeft size={15} />
            <span>
              <small>上一个</small>
              {siblings[index - 1].title}
            </span>
          </button>
        ) : (
          <span />
        )}
        {index < siblings.length - 1 ? (
          <button
            type="button"
            onClick={() => onNavigate({ view: 'component', id: siblings[index + 1].id })}
          >
            <span>
              <small>下一个</small>
              {siblings[index + 1].title}
            </span>
            <ArrowRight size={15} />
          </button>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}

export function DesignSystemPage() {
  const [draft, setDraft] = useState(readDraft);
  const [route, setRoute] = useState<LibraryRoute>(() => readLibraryRoute(readLibraryNavigation()));
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [storageStatus, setStorageStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([]));
  const [mobileNav, setMobileNav] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const values = useMemo(() => themeValues(draft), [draft]);
  const selected =
    route.view === 'component' ? DOCUMENTED_COMPONENTS.find((c) => c.id === route.id) : undefined;
  const activeSection = route.view === 'category' ? route.section : selected?.section;
  const currentSection = visibleSections.find((s) => s.id === activeSection);
  const isSearching = !!query.trim() && route.view !== 'tokens';
  const list = isSearching
    ? filterComponents(query)
    : filterComponents(
        '',
        route.view === 'category' ? route.section : undefined,
        route.view === 'live',
      );
  const shownSections = visibleSections.filter(
    (s) =>
      list.some((c) => c.section === s.id) &&
      (route.view !== 'overview' || isSearching || s.id !== 'legacy'),
  );
  const tokens = TOKEN_CATALOG.filter(
    (t) =>
      (group === 'all' || t.group === group) &&
      `${t.name} ${t.group} ${values[t.name]}`.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      setStorageStatus('草稿已保存在本机');
    } catch {
      setStorageStatus('存储不可用，请导出保留修改');
    }
  }, [draft]);
  useEffect(() => {
    const sync = () => {
      setRoute(readLibraryRoute(readLibraryNavigation()));
      setQuery('');
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    if (activeSection) setExpanded((previous) => new Set(previous).add(activeSection));
  }, [route, activeSection]);
  const update = (name: string, value: string) =>
    setDraft((d) => ({
      ...d,
      overrides: { ...d.overrides, [d.mode]: { ...d.overrides[d.mode], [name]: value } },
    }));
  const navigate = (next: LibraryRoute) => {
    pushLibraryNavigation(routeHash(next));
    setRoute(next);
    setQuery('');
    setMobileNav(false);
  };
  const toggleSection = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <PreviewTheme.Provider value={{ values, mode: draft.mode }}>
      <div
        className={`design-system-page ds-docs${draft.mode === 'dark' ? ' dark' : ''}${mobileNav ? ' ds-nav-open' : ''}${inspectorOpen ? ' ds-inspector-open' : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setMobileNav(false);
            setInspectorOpen(false);
          }
        }}
        data-testid="design-system-page"
        style={{ ...values, colorScheme: draft.mode } as CSSProperties}
      >
        <header className="ds-doc-topbar">
          <button
            type="button"
            className="ds-doc-mobile-toggle"
            aria-label="展开组件导航"
            aria-expanded={mobileNav}
            onClick={() => {
              setMobileNav((v) => !v);
              setInspectorOpen(false);
            }}
          >
            <Menu size={18} />
          </button>
          <button
            type="button"
            className="ds-doc-brand"
            onClick={() => navigate({ view: 'overview' })}
          >
            <Shapes size={23} />
            <strong>Sync-Think</strong>
            <span>UI</span>
          </button>
          <nav className="ds-doc-topnav" aria-label="组件库内容">
            <button
              type="button"
              aria-pressed={
                route.view === 'overview' || route.view === 'category' || route.view === 'component'
              }
              onClick={() => navigate({ view: 'overview' })}
            >
              组件
            </button>
            <button
              type="button"
              aria-pressed={route.view === 'tokens'}
              onClick={() => navigate({ view: 'tokens' })}
            >
              主题 Token
            </button>
            <button
              type="button"
              aria-pressed={route.view === 'live'}
              onClick={() => navigate({ view: 'live' })}
            >
              设计场景<span>{liveCount}</span>
            </button>
          </nav>
          <div className="ds-doc-top-actions">
            <button
              type="button"
              className="ds-doc-search-shortcut"
              aria-label="聚焦组件搜索"
              onClick={() => searchRef.current?.focus()}
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              className="ds-doc-theme-toggle"
              aria-label="打开主题工作台"
              aria-expanded={inspectorOpen}
              onClick={() => {
                setInspectorOpen((v) => !v);
                setMobileNav(false);
              }}
            >
              <Palette size={16} />
              <span>主题工作台</span>
            </button>
            <button
              type="button"
              className="ds-button ds-button--secondary ds-doc-export"
              onClick={() => {
                download('sync-think-theme.css', exportThemeCss(draft), 'text/css');
                setNotice('已导出明暗主题 CSS。');
              }}
            >
              <Download size={13} />
              导出 CSS
            </button>
          </div>
        </header>
        <div className="ds-doc-layout">
          {mobileNav && (
            <button
              type="button"
              className="ds-doc-nav-backdrop"
              aria-label="关闭组件导航"
              onClick={() => setMobileNav(false)}
            />
          )}
          <aside className="ds-doc-sidebar" aria-label="组件分类导航">
            <div className="ds-doc-nav-intro">
              <span>开始 / INTRO</span>
              <button
                type="button"
                aria-current={route.view === 'overview' ? 'page' : undefined}
                onClick={() => navigate({ view: 'overview' })}
              >
                组件总览 <small>{DOCUMENTED_COMPONENTS.filter((c) => !c.legacy).length}</small>
              </button>
              <button
                type="button"
                aria-current={route.view === 'tokens' ? 'page' : undefined}
                onClick={() => navigate({ view: 'tokens' })}
              >
                主题与设计 Token <small>{TOKEN_CATALOG.length}</small>
              </button>
              <button
                type="button"
                aria-current={route.view === 'live' ? 'page' : undefined}
                onClick={() => navigate({ view: 'live' })}
              >
                全部设计场景 <small>{liveCount}</small>
              </button>
            </div>
            {visibleSections.map((section) => {
              const members = DOCUMENTED_COMPONENTS.filter((c) => c.section === section.id);
              const open = expanded.has(section.id);
              return (
                <section
                  key={section.id}
                  className={`ds-doc-nav-group${section.id === 'legacy' ? ' is-legacy' : ''}`}
                >
                  <div className="ds-doc-nav-group-heading">
                    <button
                      type="button"
                      aria-current={
                        route.view === 'category' && route.section === section.id
                          ? 'page'
                          : undefined
                      }
                      onClick={() => navigate({ view: 'category', section: section.id })}
                    >
                      {section.title}
                      <small>{members.length}</small>
                    </button>
                    <button
                      type="button"
                      aria-label={`${open ? '收起' : '展开'}${section.title}`}
                      aria-expanded={open}
                      aria-controls={`ds-nav-${section.id}`}
                      onClick={() => toggleSection(section.id)}
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <div id={`ds-nav-${section.id}`} hidden={!open}>
                    {members.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        aria-current={selected?.id === c.id ? 'page' : undefined}
                        className="ds-doc-nav-item"
                        onClick={() => navigate({ view: 'component', id: c.id })}
                        title={c.name}
                      >
                        <span>{c.title}</span>
                        {c.live && (
                          <span className="ds-doc-nav-live" aria-label="可交互">
                            LIVE
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            <div className="ds-doc-sidebar-footer">
              <span className="ds-live-dot" />
              来自项目源码 · 分类持续维护
            </div>
          </aside>
          <main className="ds-doc-main" ref={mainRef} id="ds-main-content">
            <div className="ds-doc-content">
              <label className="ds-doc-search">
                <Search size={15} />
                <input
                  ref={searchRef}
                  aria-label="搜索组件或 token"
                  placeholder={
                    route.view === 'tokens' ? '搜索 token 名称或值…' : '搜索组件名称、用途或源码…'
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                    <X size={13} />
                  </button>
                )}
              </label>
              {selected && !isSearching ? (
                <ComponentDetail key={selected.id} component={selected} onNavigate={navigate} />
              ) : route.view === 'tokens' ? (
                <>
                  <div className="ds-doc-breadcrumb">Foundations / 设计基础</div>
                  <header className="ds-doc-heading">
                    <h1>主题与设计 Token</h1>
                    <p>
                      {TOKEN_CATALOG.length} 个来自桌面主题源文件的语义变量。编辑后按 Enter
                      或离开输入框应用，右侧草稿会同步保存。
                    </p>
                  </header>
                  <div className="ds-doc-token-toolbar">
                    <strong>{tokens.length} 个 token</strong>
                    <select
                      aria-label="Token 分组"
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                    >
                      <option value="all">全部分组</option>
                      {groups.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ds-token-catalog">
                    {tokens.map((t) => (
                      <TokenEditor
                        key={`${draft.mode}-${t.name}`}
                        token={t}
                        value={values[t.name]}
                        onChange={(v) => update(t.name, v)}
                      />
                    ))}
                  </div>
                  {!tokens.length && <p className="ds-empty">没有匹配的 token，试试其他关键词。</p>}
                </>
              ) : (
                <>
                  <div className="ds-doc-breadcrumb">
                    {isSearching
                      ? 'Search / 全局搜索'
                      : route.view === 'live'
                        ? 'Playground / 设计场景'
                        : currentSection
                          ? `${currentSection.english} / ${currentSection.title}`
                          : 'Components / 设计展览'}
                  </div>
                  <header className="ds-doc-heading">
                    <h1>
                      {isSearching
                        ? '找到你需要的组件'
                        : route.view === 'live'
                          ? '可交互的真实组件'
                          : currentSection
                            ? currentSection.title
                            : '为思考而设计。'}
                    </h1>
                    <p>
                      {isSearching
                        ? `“${query}” · ${list.length} 个结果，覆盖现役与历史组件。`
                        : route.view === 'live'
                          ? '这些样例直接导入桌面端原组件。选择一个组件，单独体验交互与主题变化。'
                          : currentSection
                            ? currentSection.description
                            : '真实组件，完整场景。探索 Sync-Think 的界面语言，直接体验每一个设计。'}
                    </p>
                  </header>
                  <div className="ds-doc-summary">
                    <span>
                      {isSearching
                        ? list.length
                        : route.view === 'live'
                          ? liveCount
                          : currentSection
                            ? list.length
                            : DOCUMENTED_COMPONENTS.filter((c) => !c.legacy).length}{' '}
                      个组件
                    </span>
                    <i />
                    <span>
                      {route.view === 'overview' && !isSearching
                        ? `${visibleSections.filter((s) => s.id !== 'legacy').length} 个用途分类`
                        : isSearching
                          ? '跨全部分类'
                          : (currentSection?.english ?? '按用途分组')}
                    </span>
                    <span className="ds-doc-summary-live">
                      <span />
                      所有现役组件均有可视化场景
                    </span>
                  </div>
                  {route.view === 'overview' && !isSearching && (
                    <>
                      <div className="ds-feature-composition">
                        <section>
                          <div className="ds-feature-label">
                            从一个想法开始 <span>Prompt Input</span>
                          </div>
                          <PreviewFrame name="ComposerEditor" thumbnail />
                        </section>
                        <section>
                          <div className="ds-feature-label">
                            每一步，都清晰可见 <span>Tool Result</span>
                          </div>
                          <PreviewFrame name="ToolResult" thumbnail variant="hero" />
                        </section>
                      </div>
                      <div className="ds-showcase-heading">
                        <h2>从这些组件开始</h2>
                        <span>界面的基础，也是交互的细节</span>
                      </div>
                      <div className="ds-doc-card-grid ds-featured-grid">
                        {featuredNames.map((name) => {
                          const c = DOCUMENTED_COMPONENTS.find((c) => c.name === name)!;
                          return (
                            <ComponentCard
                              key={c.id}
                              component={c}
                              onOpen={() => navigate({ view: 'component', id: c.id })}
                            />
                          );
                        })}
                      </div>
                      <div className="ds-category-pills">
                        {visibleSections
                          .filter((s) => s.id !== 'legacy')
                          .map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => navigate({ view: 'category', section: s.id })}
                            >
                              {s.title}
                              <ArrowUpRight size={12} />
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                  {shownSections.map((section) => {
                    const all = list.filter((c) => c.section === section.id);
                    const items = route.view === 'overview' && !isSearching ? all.slice(0, 6) : all;
                    return (
                      <section
                        key={section.id}
                        className="ds-doc-category-section"
                        aria-label={section.title}
                      >
                        {(route.view !== 'category' || isSearching) && (
                          <header>
                            <div>
                              <h2 id={`section-${section.id}`}>
                                {section.title}
                                <span>{all.length}</span>
                              </h2>
                              <p>{section.description}</p>
                            </div>
                            {items.length < all.length && (
                              <button
                                type="button"
                                onClick={() => navigate({ view: 'category', section: section.id })}
                              >
                                查看全部
                                <ArrowRight size={13} />
                              </button>
                            )}
                          </header>
                        )}
                        <div className="ds-doc-card-grid">
                          {items.map((c) => (
                            <ComponentCard
                              key={c.id}
                              component={c}
                              onOpen={() => navigate({ view: 'component', id: c.id })}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                  {!shownSections.length && (
                    <div className="ds-doc-placeholder">
                      <Search size={25} />
                      <h2>没有找到匹配的组件</h2>
                      <p>试试组件英文名、中文用途或文件路径。</p>
                      <button
                        className="ds-button ds-button--secondary"
                        type="button"
                        onClick={() => setQuery('')}
                      >
                        清空搜索
                      </button>
                    </div>
                  )}
                  {route.view === 'overview' && !isSearching && (
                    <button
                      className="ds-doc-legacy-link"
                      type="button"
                      onClick={() => navigate({ view: 'category', section: 'legacy' })}
                    >
                      历史 UI Kit{' '}
                      <span>
                        {DOCUMENTED_COMPONENTS.filter((c) => c.legacy).length} 个归档组件 ·
                        与现役组件分开管理
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  )}
                </>
              )}
              <footer className="ds-doc-footer">
                <Check size={12} />
                目录来自源码扫描 · 预览与业务执行隔离<span role="status">{notice}</span>
              </footer>
            </div>
          </main>
          <div className="ds-doc-inspector-wrap">
            <button
              type="button"
              className="ds-doc-inspector-close"
              onClick={() => setInspectorOpen(false)}
              aria-label="关闭主题工作台"
            >
              <X size={16} />
            </button>
            <ThemeInspector
              draft={draft}
              setDraft={setDraft}
              values={values}
              storageStatus={storageStatus}
              update={update}
              onOpenTokens={() => {
                navigate({ view: 'tokens' });
                setInspectorOpen(false);
              }}
            />
          </div>
        </div>
      </div>
    </PreviewTheme.Provider>
  );
}
