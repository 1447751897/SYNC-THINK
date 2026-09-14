import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bot, Cpu, RotateCcw, Users } from 'lucide-react';
import { AgentLibrary } from './AgentLibrary.js';
import { TeamLibrary } from './TeamLibrary.js';
import { DialogProvider } from './Dialog.js';
import { KernelUpdatePanel } from './KernelUpdatePanel.js';
import {
  ModelPickerMenu,
  ModelTrigger,
  REASONING_LABELS,
  type IdentityOption,
  type ReasoningEffort,
} from './compose-toolbar.js';
import { NewMaxComposerFrame } from './NewMaxComposerFrame.js';
import { ComposerEditor } from './ComposerEditor.js';
import { resolveKernelDisplayName } from './brand-icons.js';
import {
  capabilityViews,
  createWebsiteCapabilitySession,
  demoKernels,
  demoModels,
  type CapabilityView,
  type DemoRoster,
} from './website-capability-state.js';

const library = createWebsiteCapabilitySession();
const tabs = [
  { id: 'kernels', label: '执行内核', Icon: Cpu },
  { id: 'agents', label: '智能体库', Icon: Bot },
  { id: 'teams', label: '小队库', Icon: Users },
] as const;

export default function WebsiteCapabilityDemo(props: {
  initialView: CapabilityView;
  onStart(identity: IdentityOption, model: string, roster: DemoRoster): void;
}) {
  const [view, setView] = useState(props.initialView);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('示例工作区 · 修改仅保存在本页');
  const visibleTabs = tabs.filter((tab) => tab.id === props.initialView);
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot);
  useEffect(() => {
    const previous = Object.getOwnPropertyDescriptor(window, 'syncThink');
    const previousDemoView = document.body.dataset.demoView;
    document.body.dataset.demoView = props.initialView;
    Object.defineProperty(window, 'syncThink', {
      value: { runtime: library.runtime, kernelUpdates: library.kernelUpdates },
      configurable: true,
    });
    setReady(true);
    return () => {
      if (previousDemoView) document.body.dataset.demoView = previousDemoView;
      else delete document.body.dataset.demoView;
      if (previous) Object.defineProperty(window, 'syncThink', previous);
    };
  }, []);
  const changed = () => setNotice('已保存到示例工作区 · 刷新页面后重置');
  return (
    <DialogProvider>
      <main className="website-capability-app" data-testid="website-capability-app">
        <header className="demo-capability-header">
          <nav role="tablist" aria-label="产品能力">
            {visibleTabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`capability-${id}`}
                aria-selected={view === id}
                aria-controls="capability-panel"
                tabIndex={view === id ? 0 : -1}
                onClick={() => setView(id)}
                onKeyDown={(event) => {
                  const index = capabilityViews.indexOf(view);
                  const next =
                    event.key === 'ArrowRight'
                      ? capabilityViews[(index + 1) % 3]
                      : event.key === 'ArrowLeft'
                        ? capabilityViews[(index + 2) % 3]
                        : event.key === 'Home'
                          ? 'kernels'
                          : event.key === 'End'
                            ? 'teams'
                            : null;
                  if (next) {
                    event.preventDefault();
                    setView(next);
                    document.getElementById(`capability-${next}`)?.focus();
                  }
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <button
            type="button"
            title="重置示例工作区"
            aria-label="重置示例工作区"
            onClick={() => {
              library.reset();
              setRevision((value) => value + 1);
              setNotice('示例工作区已重置');
            }}
          >
            <RotateCcw size={16} />
          </button>
        </header>
        <div
          id="capability-panel"
          role="tabpanel"
          aria-labelledby={`capability-${view}`}
          className="demo-capability-panel"
          key={`${view}:${revision}`}
        >
          {!ready ? (
            <p role="status">正在载入示例工作区…</p>
          ) : view === 'kernels' ? (
            <KernelDemo />
          ) : view === 'agents' ? (
            <AgentLibrary
              agents={state.agents}
              teams={state.teams}
              models={demoModels}
              onRefresh={changed}
              onStartConversation={(id) => {
                const agent = state.agents.find((item) => item.id === id);
                if (agent)
                  props.onStart(
                    { track: 'agent', targetRef: id, name: agent.name },
                    agent.defaultModelId,
                    state,
                  );
              }}
            />
          ) : (
            <TeamLibrary
              teams={state.teams}
              agents={state.agents}
              onRefresh={changed}
              onStartConversation={(id) => {
                const team = state.teams.find((item) => item.id === id);
                if (team)
                  props.onStart(
                    { track: 'team', targetRef: id, name: team.name },
                    'SYNC-THINK',
                    state,
                  );
              }}
            />
          )}
        </div>
        <footer className="demo-capability-footer" role="status">
          {notice} · 不调用模型或安装程序
        </footer>
      </main>
    </DialogProvider>
  );
}

function KernelDemo() {
  const [kernel, setKernel] = useState('native');
  const [model, setModel] = useState('SYNC-THINK');
  const [reasoning, setReasoning] = useState<ReasoningEffort>('auto');
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState('整理当前项目的任务清单，并检查相关文件。');
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <section className="demo-kernel-page" aria-label="执行内核设置">
      <div className="demo-kernel-settings">
        <KernelUpdatePanel />
      </div>
      <div className="demo-kernel-composer">
        <div className="demo-kernel-selection" role="status">
          <span>当前执行内核</span>
          <strong>{demoKernels.find((item) => item.kernelId === kernel)?.name}</strong>
          <span>模型</span>
          <strong>{model}</strong>
        </div>
        <NewMaxComposerFrame variant="conversation">
          <div className="shell-newmax-composer__editor is-conversation">
            <ComposerEditor
              value={input}
              onChange={setInput}
              ariaLabel="示例任务"
              minHeight={64}
              maxHeight={110}
            />
          </div>
          <div className="shell-compose__bar">
            <div className="shell-compose__bar-left" />
            <div className="shell-compose__bar-right">
              <ModelPickerMenu
                open={open}
                models={demoModels}
                selectedModelId={model}
                defaultLabel="Sync-Think"
                reasoningEffort={reasoning}
                kernels={demoKernels}
                selectedKernelId={kernel}
                anchorEl={anchor.current}
                onClose={() => setOpen(false)}
                onPick={setModel}
                onPickKernel={(id) => {
                  setKernel(id);
                  setOpen(false);
                }}
                onReasoningChange={setReasoning}
                trigger={
                  <ModelTrigger
                    buttonRef={anchor}
                    label={resolveKernelDisplayName(kernel)}
                    reasoningLabel={REASONING_LABELS[reasoning]}
                    open={open}
                    onClick={() => setOpen(!open)}
                  />
                }
              />
            </div>
          </div>
        </NewMaxComposerFrame>
      </div>
    </section>
  );
}
