import { useEffect, useState, type ReactNode } from 'react';
import { WorkspaceWorkbench } from './WorkspaceWorkbench.js';
import type { WorkbenchScope, WorkbenchTab } from './workspace-workbench.js';

const files: WorkbenchTab[] = [
  { id: 'document', type: 'file', path: '验收记录.md' },
  { id: 'code', type: 'file', path: 'task.ts' },
  { id: 'diff', type: 'review', runId: 'demo-review' },
];

export function WebsiteDemoWorkbench(props: {
  onClose(): void;
  renderDocument(): ReactNode;
  renderCode(): ReactNode;
  renderDiff(): ReactNode;
}) {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 1000);
  const [scope, setScope] = useState<WorkbenchScope>({
    open: true,
    size: 440,
    tabs: files,
    activeTabId: 'document',
    fileBrowserOpen: false,
    fileBrowserWidth: 221,
  });
  const [bottomSize, setBottomSize] = useState(280);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1000px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const openTab = (tab: WorkbenchTab) =>
    setScope((current) => ({
      ...current,
      activeTabId: tab.id,
      tabs: current.tabs.some((item) => item.id === tab.id) ? current.tabs : [...current.tabs, tab],
    }));
  const fileList = () => (
    <nav className="demo-workbench-files" aria-label="示例工作区文件">
      {files.map((tab) => (
        <button key={tab.id} onClick={() => openTab(tab)}>
          {tab.type === 'file' ? tab.path : '文件变更'}
        </button>
      ))}
    </nav>
  );
  return (
    <WorkspaceWorkbench
      placement={narrow ? 'bottom' : 'right'}
      scope={{ ...scope, size: narrow ? bottomSize : scope.size }}
      focused
      canOpenTerminal={false}
      onClose={props.onClose}
      onActivateTab={(activeTabId) => setScope((current) => ({ ...current, activeTabId }))}
      onCloseTab={(tab) =>
        setScope((current) => {
          const tabs = current.tabs.filter((item) => item.id !== tab.id);
          return {
            ...current,
            tabs,
            activeTabId: current.activeTabId === tab.id ? tabs.at(-1)?.id : current.activeTabId,
            fileBrowserOpen: tabs.length === 0 || current.fileBrowserOpen,
          };
        })
      }
      onSizeChange={(size) =>
        narrow ? setBottomSize(size) : setScope((current) => ({ ...current, size }))
      }
      onFileBrowserWidthChange={(fileBrowserWidth) =>
        setScope((current) => ({ ...current, fileBrowserWidth }))
      }
      onToggleFileBrowser={() =>
        setScope((current) => ({ ...current, fileBrowserOpen: !current.fileBrowserOpen }))
      }
      onNewResource={(resource) => {
        if (resource === 'files') setScope((current) => ({ ...current, fileBrowserOpen: true }));
        else if (resource === 'document') openTab(files[0]);
        else openTab({ id: `demo-${resource}`, type: 'file', path: `${resource}-演示说明.md` });
      }}
      renderFileBrowser={fileList}
      renderContent={(tab) => (
        <div className="demo-workbench-content">
          {tab.id === 'document' ? (
            props.renderDocument()
          ) : tab.id === 'code' ? (
            props.renderCode()
          ) : tab.id === 'diff' ? (
            props.renderDiff()
          ) : (
            <p>
              此嵌入页仅演示本地组件。{tab.type === 'file' ? tab.path : '资源'}
              需要在桌面端连接真实工作区后使用；这里不会启动终端、外部浏览器或模型。
            </p>
          )}
        </div>
      )}
    />
  );
}
