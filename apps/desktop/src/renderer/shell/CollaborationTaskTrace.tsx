import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import type { CollaborationArtifact, CollaborationAttempt, CollaborationSnapshot, CollaborationTask, RunId } from '@sync-think/shared';
import { loadRunTimelinePage, mergeRunTimelineSegments } from './run-timeline-loader.js';
import { CopyTextButton } from './CopyTextButton.js';
import { MarkdownContent } from './MarkdownContent.js';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { AgentAvatarView } from './AgentAvatarView.js';

const labels: Record<string, string> = { queued: '等待', running: '执行中', waiting_input: '待处理', stopping: '停止中', succeeded: '已完成', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '中断' };
function elapsed(segment: { startedAt?: string; completedAt?: string }) {
  if (!segment.startedAt || !segment.completedAt) return '';
  return `${Math.max(0, Date.parse(segment.completedAt) - Date.parse(segment.startedAt)) / 1000}s`;
}
function Artifact({ artifact, projectFolder }: { artifact: CollaborationArtifact; projectFolder?: string }) {
  const [open, setOpen] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([artifact.content ?? ''], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${artifact.title.replace(/[\\/:*?"<>|]/g, '-')}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="collab-artifact"><button className="collab-artifact__header" onClick={() => setOpen(value => !value)} aria-expanded={open}>
    <span>▤</span><strong>{artifact.title}</strong><small>{artifact.kind === 'file' ? '文件' : '文档'} · {Math.max(1, Math.ceil(artifact.bytes / 1024))} KB</small><span>{open ? '−' : '+'}</span>
  </button>{open && <div className="collab-artifact__content"><small>产物版本 {artifact.sha256.slice(0, 10)} · {new Date(artifact.createdAt).toLocaleString()}</small>
    {artifact.content !== undefined ? <><button className="collab-pill" onClick={download}>下载 Markdown</button><MarkdownContent text={artifact.content} projectFolder={projectFolder} /></> : <MarkdownContent text={`文件：\n\n[${artifact.path}](${encodeURI(artifact.storedPath ?? artifact.path ?? '')})`} projectFolder={projectFolder} />}
  </div>}</section>;
}
export function CollaborationArtifacts({ artifacts, projectFolder }: { artifacts: CollaborationArtifact[]; projectFolder?: string }) {
  return <div className="collab-artifacts">{artifacts.map(artifact => <Artifact key={artifact.id} artifact={artifact} projectFolder={projectFolder} />)}</div>;
}

export default function CollaborationTaskTrace({ snapshot, task, attempt, onSelectTask, projectFolder }: {
  snapshot: CollaborationSnapshot; task: CollaborationTask; attempt?: CollaborationAttempt; onSelectTask(id: string, attemptId?: string): void; projectFolder?: string;
}) {
  const [segments, setSegments] = useState<AssistantTurnSegment[]>([]);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const runId = attempt?.runId;
  const active = attempt && ['running', 'waiting_input', 'stopping'].includes(attempt.status);
  const loader = useRef<{ refresh(): Promise<void>; more(): Promise<void> }>();
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let refreshQueued = false;
    let nextCursor: string | undefined;
    // Re-read the last explicitly loaded page as well as the bounded head. Its
    // cursor owns the pagination frontier, so polling never hides older loaded pages.
    let tailCursor: string | undefined;
    setSegments([]); setCursor(undefined); setError(''); setLoading(false); setQuery('');
    const api = window.syncThink?.runtime;
    if (!runId || !api?.listConversationRunTimeline) return;
    const fetchPage = (cursor?: string) => loadRunTimelinePage(
      payload => api.listConversationRunTimeline(payload), runId as RunId, cursor, controller.signal,
    );
    const load = async (more = false) => {
      if (controller.signal.aborted || (more && !nextCursor)) return;
      if (pending) { if (!more) refreshQueued = true; return; }
      pending = true; setLoading(true);
      const requestedCursor = more ? nextCursor : undefined;
      try {
        let next = requestedCursor;
        const all: AssistantTurnSegment[] = [];
        const visited = new Set<string | undefined>();
        for (let pageIndex = 0; pageIndex < (more ? 1 : 8); pageIndex++) {
          visited.add(next);
          const page = await fetchPage(next);
          all.push(...page.segments); next = page.nextCursor;
          if (!next) break;
        }
        if (!more && tailCursor && !visited.has(tailCursor)) {
          const tail = await fetchPage(tailCursor);
          all.push(...tail.segments); next = tail.nextCursor;
        }
        if (!controller.signal.aborted) {
          if (more) tailCursor = requestedCursor;
          nextCursor = next;
          setSegments(current => mergeRunTimelineSegments(current, all));
          setCursor(next); setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        pending = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (refreshQueued) { refreshQueued = false; void load(); }
        }
      }
    };
    const session = { refresh: () => load(), more: () => load(true) };
    loader.current = session;
    return () => {
      controller.abort();
      loader.current = undefined;
    };
  }, [runId, retry]);
  useEffect(() => {
    // Keep the loaded pages when a running attempt completes; only its polling changes.
    void loader.current?.refresh();
    const timer = active ? setInterval(() => void loader.current?.refresh(), 2000) : undefined;
    return () => clearInterval(timer);
  }, [runId, active, retry]);
  const nodes = snapshot.tasks.filter(node => node.rootTaskId === task.rootTaskId && node.kind === 'task');
  const members = new Map(snapshot.members.map(m => [m.id, m]));
  const handoff = task.handoff;
  const sourceTask = handoff && snapshot.tasks.find(node => node.id === handoff.sourceTaskId);
  // A handoff is version-bound: do not substitute the producer's latest retry.
  const sourceAttempt = handoff && snapshot.attempts.find(item => item.id === handoff.sourceAttemptId && item.taskId === handoff.sourceTaskId);
  const sourceArtifacts = handoff ? snapshot.attempts.filter(item => item.status === 'succeeded').flatMap(item => item.artifacts ?? [])
    .filter(artifact => handoff.artifactIds.includes(artifact.id)) : [];
  const missingArtifacts = handoff ? handoff.artifactIds.filter(id => !sourceArtifacts.some(artifact => artifact.id === id)).length : 0;

  const events = segments.map(segment => {
    const tool = segment.kind === 'tool' ? segment : undefined;
    return {
      ...tool,
      id: segment.id, kind: segment.kind, status: 'status' in segment ? segment.status : 'completed',
      name: tool?.name ?? (segment.kind === 'status' ? segment.label : ''),
      text: segment.kind === 'text' ? segment.text : segment.kind === 'status' ? segment.detail ?? segment.label : '',
      phase: segment.kind === 'text' ? segment.phase : undefined,
      textRef: segment.kind === 'text' ? segment.textRef : undefined,
      startedAt: 'startedAt' in segment ? segment.startedAt : undefined, completedAt: 'completedAt' in segment ? segment.completedAt : undefined,
    };
  });
  const visible = events.filter(segment => !query || (segment.kind === 'tool' ? segment.name : segment.kind === 'thinking' ? '思考' : segment.text).toLowerCase().includes(query.toLowerCase()));
  return <ConversationContentScope.Provider value={snapshot.conversation?.id}><div className="collab-trace">
    {nodes.length > 0 && <section aria-label="团队执行图" className="collab-workflow-graph"><h4>{snapshot.conversation?.room ? '本群执行记录' : '团队执行图'} <small>{nodes.filter(n => snapshot.attempts.find(a => a.id === n.currentAttemptId)?.status === 'succeeded').length}/{nodes.length} 执行完成</small></h4>
      {nodes.map((node, index) => { const a = snapshot.attempts.find(a => a.id === node.currentAttemptId); const member = members.get(node.assigneeMemberId); return <button key={node.id} className="collab-workflow-node" data-status={a?.status} aria-current={node.id === task.id ? 'step' : undefined} onClick={() => onSelectTask(node.id)}>
        <span className="collab-workflow-node__index">{index + 1}</span><AgentAvatarView name={member?.name ?? '智能体'} avatar={member?.avatar} size={24} /><span><strong>{node.title}</strong><small>{snapshot.conversation?.room ? `${node.handoff ? ({ review: '审核', work: '交接工作', report: '回报决策' }[node.handoff.kind]) : node.purpose === 'coordination' ? '协调' : '工作'} · ${node.parentTaskId ? '来源：' + (nodes.find(n => n.id === node.parentTaskId)?.title ?? '上一轮') : '用户启动'}` : node.dependsOnTaskIds.length ? `依赖：${node.dependsOnTaskIds.map(id => nodes.find(n => n.id === id)?.title ?? id).join('、')}` : '起始阶段'}</small></span><small>{a?.waitReason === 'dependency_failed' ? '前置阶段失败' : a?.pauseRequested && a.status === 'interrupted' ? '已暂停' : a?.status === 'succeeded' && a.artifacts?.length ? '已交付' : labels[a?.status ?? 'queued']}</small>
      </button>; })}
    </section>}
    {handoff && <section className="collab-handoff-trace" aria-label="交接关系">
      <h4>{{ review: '审核交接', work: '工作交接', report: '回报交接' }[handoff.kind]}</h4>
      <div className="collab-handoff-trace__route"><button type="button" className="collab-pill" disabled={!sourceTask} onClick={() => sourceTask && onSelectTask(sourceTask.id, sourceAttempt?.id)}>{sourceTask?.title ?? '历史来源任务'} · 第 {sourceAttempt?.number ?? '—'} 次</button><span aria-hidden="true">→</span><span>{members.get(task.assigneeMemberId)?.name ?? '成员'} · {task.title}</span></div>
      {sourceArtifacts.length > 0 && <><p className="collab-muted">本轮接收的产物版本（不随来源重试替换）</p><CollaborationArtifacts artifacts={sourceArtifacts} projectFolder={projectFolder} /></>}
      {missingArtifacts > 0 && <p role="status" className="collab-muted">{missingArtifacts} 份引用产物尚未确认交付，请核对来源执行记录。</p>}
    </section>}
    {attempt?.contextManifest && <details className="collab-context-manifest"><summary>本轮上下文 · {attempt.contextManifest.purpose} · {attempt.contextManifest.continuation === 'fresh' ? '新会话' : '续接候选'}</summary><p>群聊：{attempt.contextManifest.roomId}；消息边界 #{attempt.contextManifest.sourceSequence}；已选择 {attempt.contextManifest.messageIds.length} 条消息，另有 {attempt.contextManifest.historyOmitted} 条可按需回读。</p><p>产物索引为引用，不代表正文已读。实际回读记录见下方工具轨迹。</p><pre>{JSON.stringify(attempt.contextManifest, null, 2)}</pre></details>}
    <div className="collab-trace__heading"><h4>运行轨迹</h4><input aria-label="搜索运行轨迹" placeholder="搜索工具或过程" value={query} onChange={e => setQuery(e.target.value)} /></div>
    {segments.length > 0 && <div className="collab-trace__strip" aria-label="轨迹时间轴">{events.map((segment, index) => <button key={segment.id} data-kind={segment.kind} data-status={segment.status} title={`${index + 1} · ${segment.kind === 'tool' ? segment.name : segment.kind === 'thinking' ? '思考' : '回复'} · ${elapsed(segment)}`} aria-label={`定位第 ${index + 1} 个事件`} onClick={() => { setQuery(''); setTimeout(() => list.current?.querySelector(`[data-segment-id="${CSS.escape(segment.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0); }} />)}</div>}
    <p className="collab-muted">思考仅显示状态；过程说明与工具结果保留在这里。</p>
    {error && <div role="status" className="collab-notice">{error}<button className="collab-pill" onClick={() => setRetry(n => n + 1)}>重新读取轨迹</button></div>}
    <div ref={list} className="collab-trace__events">{visible.map(segment => <details key={segment.id} data-segment-id={segment.id} data-kind={segment.kind}>
      <summary><span>{segment.kind === 'tool' ? '工具' : segment.kind === 'thinking' ? '思考' : '助手'}</span><strong>{segment.kind === 'tool' ? segment.name : segment.kind === 'thinking' ? '思考状态' : segment.kind === 'status' ? segment.name : segment.phase === 'commentary' ? '过程说明' : '最终回复'}</strong><small>{labels[segment.status] ?? segment.status} {elapsed(segment)}</small></summary>
      {segment.kind === 'tool' ? <>{segment.argumentsRef ? <DeferredToolContent deferred={segment.argumentsRef} preview={segment.argumentsJson ?? ''} assemble={false} label="工具输入" /> : <pre aria-label="工具输入">{segment.argumentsJson || '无参数'}</pre>}{segment.outputRef ? <DeferredToolContent deferred={segment.outputRef} preview={segment.output ?? ''} assemble={false} label="工具输出" /> : <pre aria-label="工具输出">{segment.output ?? '等待返回'}</pre>}</> : segment.kind === 'thinking' ? <p className="collab-muted">该阶段已记录思考状态与耗时，不展示内部推理正文。</p> : segment.textRef ? <DeferredToolContent deferred={segment.textRef} preview={segment.text} assemble={false} presentation="prose" label="过程说明" /> : <MarkdownContent text={segment.text} />}
    </details>)}</div>
    {!segments.length && !loading && !error && <p className="collab-muted">{runId ? '暂无已记录的执行事件。' : '任务开始后，运行轨迹会出现在这里。'}</p>}
    {loading && <p role="status" className="collab-muted">正在读取运行轨迹…</p>}
    {cursor && <button className="collab-pill" disabled={loading} onClick={() => void loader.current?.more()}>加载更多事件</button>}
    {attempt?.artifacts?.length ? <section><h4>本次执行的产物</h4><CollaborationArtifacts artifacts={attempt.artifacts} projectFolder={projectFolder} /></section> : null}
  </div></ConversationContentScope.Provider>;
}

export function CollaborationResultsPanel({ snapshot, selectedId, onSelect, projectFolder, onSelectTask }: {
  snapshot: CollaborationSnapshot; selectedId?: string; onSelect(id: string): void; projectFolder?: string; onSelectTask(id: string): void;
}) {
  const entries = useMemo(() => snapshot.attempts.flatMap(attempt => (attempt.artifacts ?? []).map(artifact => {
    const task = snapshot.tasks.find(t => t.id === artifact.taskId);
    return { artifact, attempt, task, current: task?.currentAttemptId === attempt.id,
      author: snapshot.members.find(m => m.id === task?.assigneeMemberId)?.name ?? '成员' };
  })).sort((a, b) => a.artifact.createdAt.localeCompare(b.artifact.createdAt)), [snapshot]);
  const selected = entries.find(e => e.artifact.id === selectedId) ?? entries.filter(e => e.current && e.attempt.status === 'succeeded').at(-1) ?? entries.at(-1);
  if (!selected) return <p className="collab-muted collab-results-empty">还没有成果。成员提交的文档、文件和历史版本会收在这里。</p>;
  const { artifact } = selected;
  const status = (entry: typeof selected) => !entry.current ? '历史版本' : entry.attempt.status === 'succeeded' ? '已交付' : '草稿 · 尚未交付';
  const count = artifact.content === undefined ? undefined : artifact.textMetrics?.charactersWithoutWhitespace ?? Array.from(artifact.content.replace(/\s/gu, '')).length;
  const download = () => {
    const url = URL.createObjectURL(new Blob([artifact.content ?? ''], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = artifact.title.replace(/[\\/:*?"<>|]/g, '-') + '.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="collab-results">
    <nav className="collab-results__list" aria-label="成果列表">{[...entries].reverse().map(entry => <button type="button" key={entry.artifact.id} aria-pressed={entry.artifact.id === artifact.id} onClick={() => onSelect(entry.artifact.id)}>
      <strong>{entry.artifact.title}</strong><small>{entry.author} · {status(entry)} · 第 {entry.attempt.number} 次</small>
    </button>)}</nav>
    <section className="collab-results__reader" aria-label="成果预览">
      <h3>{artifact.title}</h3><p className="collab-muted">{selected.author} · {status(selected)} · {new Date(artifact.createdAt).toLocaleString()}</p>
      <div className="collab-toolbar">{artifact.content !== undefined && <><button className="collab-pill" type="button" onClick={download}>下载 Markdown</button><CopyTextButton text={artifact.content} label="复制文档" compact /></>}<button type="button" className="collab-pill" onClick={() => onSelectTask(artifact.taskId)}>查看执行</button></div>
      <details className="collab-results__metadata"><summary>文档信息与保存位置</summary><p>{artifact.bytes} 字节 · 版本 {artifact.sha256.slice(0, 10)}</p>{count !== undefined && <p>整份文档 {count} 字符（含标点、排除空白；若有标题或审校也会计入，正文需单独核对）</p>}{artifact.storedPath ? <><p>已保存本地版本文件：</p><code>{artifact.storedPath}</code><MarkdownContent text={`[打开保存文件](${encodeURI(artifact.storedPath)})`} projectFolder={projectFolder} /></> : <p>{artifact.kind === 'document' ? '会话存档，可预览和下载。此历史版本没有本地文件记录。' : '历史工作文件：' + artifact.path}</p>}</details>
      {artifact.content !== undefined ? <MarkdownContent text={artifact.content} projectFolder={projectFolder} /> : <MarkdownContent text={`[打开文件](${encodeURI(artifact.storedPath ?? artifact.path ?? '')})`} projectFolder={projectFolder} />}
    </section>
  </div>;
}
