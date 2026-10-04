import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { taskRoomGoalOrigin } from '@sync-think/shared';
import type { CollaborationCommand, CollaborationSnapshot, TaskRoomState } from '@sync-think/shared';

const LABELS: Record<TaskRoomState, string> = { discussion: '讨论中', blocked: '有阻塞', running: '工作中', pausing: '正在暂停', paused: '已暂停', review: '待验收', completed: '已验收' };
export function TaskRoomBar({ snapshot, onCommand, onSelectTask, artifactCount, resultsOpen, onOpenResults }: {
  snapshot: CollaborationSnapshot; onCommand(command: CollaborationCommand): Promise<unknown>; onSelectTask(id: string): void;
  artifactCount?: number; resultsOpen?: boolean; onOpenResults?(): void;
}) {
  const room = snapshot.conversation.room!;
  const [dialog, setDialog] = useState<'goal' | 'progress' | null>(null);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(room.goal);
  const [editRevision, setEditRevision] = useState(room.goalRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const lock = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const request = useRef<{ key: string; id: string }>();
  useEffect(() => { if (!editing) setGoal(room.goal); }, [room.goal, editing]);
  useEffect(() => setReviewed(false), [room.checkpoint.version]);
  const command = async (value: Omit<Extract<CollaborationCommand, { action: 'room-pause' | 'room-resume' | 'room-complete' }>, 'clientRequestId'> | Omit<Extract<CollaborationCommand, { action: 'room-brief' }>, 'clientRequestId'> | Omit<Extract<CollaborationCommand, { action: 'start-workflow' }>, 'clientRequestId'>) => {
    if (lock.current) return;
    const key = JSON.stringify(value);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError('');
    try {
      await onCommand({ ...value, clientRequestId: request.current.id } as CollaborationCommand);
      request.current = undefined;
      if (value.action === 'room-brief') { setEditing(false); setDialog(null); }
      if (value.action === 'room-resume') setDialog(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); /* Keep the request ID for idempotent retry. */ }
    finally { lock.current = false; setBusy(false); }
  };
  const id = snapshot.conversation.id;
  const tasks = snapshot.tasks.filter(t => t.kind !== 'reply' && (t.goalRevision === undefined || t.goalRevision === room.goalRevision) && !snapshot.tasks.some(r => r.id === t.replacedByTaskId && r.replacesTaskId === t.id && (r.goalRevision === undefined || r.goalRevision === room.goalRevision)));
  const attempts = new Map(snapshot.attempts.map(a => [a.id, a]));
  const dispatchedCount = tasks.filter(t => !t.pendingAssignment).length;
  const plannedCount = tasks.filter(t => t.pendingAssignment && attempts.get(t.currentAttemptId)?.status === 'queued').length;
  const active = tasks.some(t => ['queued', 'running', 'stopping', 'waiting_input'].includes(attempts.get(t.currentAttemptId)?.status ?? ''));
  const failed = tasks.filter(t => ['failed', 'interrupted'].includes(attempts.get(t.currentAttemptId)?.status ?? '') && !attempts.get(t.currentAttemptId)?.pauseRequested).length;
  const beginEdit = () => { setGoal(room.goal); setEditRevision(room.goalRevision); setEditing(true); };
  const openGoal = () => { setError(''); setDialog('goal'); if (!room.goal) beginEdit(); else setEditing(false); };
  return <section className="task-room-bar" aria-label="群聊控制" data-testid="task-room-control">
    <div className="task-room-bar__tags">
      <span className={`task-room-tag task-room-tag--state task-room-tag--${room.state}`} role="status" title="本群上下文与文档独立；切换聊天不会停止工作">{LABELS[room.state]}</span>
      <button type="button" className="task-room-tag task-room-tag--goal" onClick={event => { opener.current = event.currentTarget; openGoal(); }} aria-label={room.goal ? `工作目标 v${room.goalRevision} · 查看与编辑` : '设置工作目标（可选）'}>工作目标{room.goal ? ` v${room.goalRevision}` : ' · 未设置'}</button>
      <button type="button" className={`task-room-tag task-room-tag--${failed ? 'error' : 'execution'}`} onClick={event => { opener.current = event.currentTarget; setError(''); setDialog('progress'); }}>执行 {dispatchedCount}{plannedCount > 0 && ` · 待派工 ${plannedCount}`}{failed > 0 && ` · 异常 ${failed}`}</button>
      <button type="button" className="task-room-tag task-room-tag--results" aria-pressed={resultsOpen} onClick={onOpenResults} disabled={!onOpenResults}>成果 {artifactCount ?? room.checkpoint.artifactIds.length}</button>
    </div>
    <div className="task-room-bar__actions">
      {room.goal && ['discussion', 'review'].includes(room.state) && <button disabled={busy || active || editing} onClick={() => void command({ action: 'start-workflow', conversationId: id, goal: room.goal })}>开始团队工作</button>}
      {(room.state === 'running' || tasks.length > 0 && ['discussion', 'review'].includes(room.state)) && <button disabled={busy} onClick={() => void command({ action: 'room-pause', conversationId: id })}>暂停本群工作</button>}
      {room.state === 'pausing' && <span title="正在等待执行停止，现有输出会保留">等待停止…</span>}
      {['paused', 'blocked'].includes(room.state) && <button disabled={busy} onClick={() => setDialog('progress')}>核对并继续</button>}
      {room.state === 'review' && room.checkpoint.artifactIds.length > 0 && <button disabled={busy} onClick={() => void command({ action: 'room-complete', conversationId: id })}>验收完成</button>}
    </div>
    <Dialog.Root open={dialog !== null} onOpenChange={open => { if (!open && !busy) { setDialog(null); setEditing(false); } }}>
      <Dialog.Portal><Dialog.Overlay className="task-room-dialog-overlay" />
        <Dialog.Content className="task-room-dialog" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
          <header><Dialog.Title>{dialog === 'goal' ? '工作目标' : '执行进度'}</Dialog.Title><Dialog.Close aria-label="关闭群聊详情" disabled={busy}>×</Dialog.Close></header>
          <Dialog.Description>{dialog === 'goal' ? '本群共同执行的目标与验收要求。保存目标不会自动派工；小队流程只是协作参考。' : '前置交付后才逐项派工；后续计划保持待派工。原始回执和工具记录在对应执行详情中。'}</Dialog.Description>
          {error && <p role="alert" className="task-room-dialog__error">{error}</p>}
          {dialog === 'goal' ? editing ? <form onSubmit={event => { event.preventDefault(); void command({ action: 'room-brief', conversationId: id, goal, expectedGoalRevision: editRevision }); }}>
            <label className="collab-field">目标与验收要求<textarea autoFocus aria-label="群聊目标与验收" value={goal} onChange={event => setGoal(event.target.value)} placeholder="先聊想法，明确后记录目标、范围与验收要求。" rows={10} disabled={busy} /></label>
            <footer><button type="button" disabled={busy} onClick={() => setEditing(false)}>取消编辑</button><button type="submit" disabled={busy || !goal.trim()}>保存工作目标</button></footer>
          </form> : <><p className="task-room-dialog__goal">{room.goal || '还没有设置工作目标，可以先在群里沟通。'}</p><footer><small>版本 {room.goalRevision}{taskRoomGoalOrigin(snapshot) === 'assistant' ? ' · 智能体自动整理，以用户原始需求为准' : ' · 用户设置'}</small><button disabled={busy || active && ['running', 'pausing'].includes(room.state)} onClick={beginEdit}>编辑工作目标 v{room.goalRevision}</button></footer></> : <>
            <div className="task-room-dialog__stats"><span>已完成 {room.checkpoint.completedTaskIds.length}</span><span>待处理 {room.checkpoint.pendingTaskIds.length}</span><span>成果 {room.checkpoint.artifactIds.length}</span></div>
            {room.checkpoint.savedAt && <small>进度保存于 {new Date(room.checkpoint.savedAt).toLocaleString()}</small>}
            {room.checkpoint.note && <p>{room.checkpoint.note}</p>}
            {room.state === 'review' && room.checkpoint.artifactIds.length === 0 && <p>尚无真实交付成果，请先核对执行记录并继续工作。</p>}
            <div className="task-room-dialog__tasks">{tasks.length ? tasks.map(task => <button key={task.id} onClick={() => { setDialog(null); onSelectTask(task.id); }}><span>{task.title}</span><small>{task.pendingAssignment && attempts.get(task.currentAttemptId)?.status === 'queued' ? '待派工 · 等待前置交付' : attempts.get(task.currentAttemptId)?.status === 'succeeded' ? '已完成' : attempts.get(task.currentAttemptId)?.status === 'failed' ? '失败' : '查看执行'}</small></button>) : <p>当前还没有派工记录。</p>}</div>
            {['paused', 'blocked'].includes(room.state) && <footer className="task-room-dialog__resume"><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />已核对现有成果与未完成工作，并处理阻塞原因</label><button disabled={busy || !reviewed} onClick={() => void command({ action: 'room-resume', conversationId: id })}>继续本群工作</button></footer>}
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
