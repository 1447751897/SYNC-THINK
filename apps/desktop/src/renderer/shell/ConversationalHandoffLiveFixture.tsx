import { useEffect, useState } from 'react';
import type { ConversationListRunTimelinePayload, ConversationListRunTimelineResponse } from '@sync-think/protocol';
import type { CollaborationCommand, CollaborationResponse, Conversation, GlobalAgent } from '@sync-think/shared';
import { CollaborationChatView } from './CollaborationChatView.js';
import { DialogProvider } from './Dialog.js';
import './agent-workspace.css';

type Room = { conversation: Conversation; agents: GlobalAgent[] };
type RoomEvent = { type: string; payload: { conversationId: string } };
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '本地验收请求失败');
  return result as T;
}

/** Test-only preload adapter. Snapshots and work are provided by real Runtime RPC, never canned UI phases. */
export default function ConversationalHandoffLiveFixture() {
  const [room, setRoom] = useState<Room>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const listeners = new Set<(event: RoomEvent) => void>();
    const events = new EventSource('/live/events');
    events.onmessage = event => {
      const update = JSON.parse(event.data) as RoomEvent;
      for (const listener of listeners) listener(update);
    };
    const bridge = { runtime: {
      onEvent: (listener: (event: RoomEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      collaboration: (command: CollaborationCommand) => post<CollaborationResponse>('/live/command', command),
      listConversationRunTimeline: (payload: ConversationListRunTimelinePayload) => post<ConversationListRunTimelineResponse>('/live/timeline', payload),
      listWaitingBrowserHandoffs: async () => ({ handoffs: [] }),
      listPendingToolApprovals: async () => ({ approvals: [] }),
    } };
    const previous = Object.getOwnPropertyDescriptor(window, 'syncThink');
    Object.defineProperty(window, 'syncThink', { configurable: true, value: bridge });
    return () => { events.close(); if (previous) Object.defineProperty(window, 'syncThink', previous); else Reflect.deleteProperty(window, 'syncThink'); };
  }, []);
  async function create(mode: string) {
    setBusy(true); setError('');
    try { setRoom(await post<Room>('/live/new', { mode })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function start() {
    if (!room) return;
    setBusy(true); setError('');
    try { await post('/live/command', { action: 'start-workflow', conversationId: room.conversation.id, clientRequestId: crypto.randomUUID(), goal: '[开始]基于已有世界观，完成正文、审核、必要润色及复审，最终交付。' }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <DialogProvider><main className="agent-chat-workspace" style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
    <nav aria-label="本地实际执行验收" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 10 }}>
      {([['free', '创建自主测试群'], ['strict', '创建严格测试群'], ['long', '创建长交接测试群'], ['failed', '创建失败恢复测试群']] as const).map(([mode, label]) => <button key={mode} disabled={busy} onClick={() => void create(mode)}>{label}</button>)}
      <button disabled={busy || !room} onClick={() => void start()}>实际启动接力</button>
      <small>隔离 SQLite · 实际 Runtime 进程和 RPC · 受控模型 · 不使用你的工作数据</small>
    </nav>
    {error && <p role="alert">{error}</p>}
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{room ? <CollaborationChatView key={room.conversation.id} conversation={room.conversation} agents={room.agents} onOpenConversation={() => {}} workspace /> : <p>创建测试群后启动，真实执行结果会自动进入聊天，无手动阶段切换。</p>}</div>
  </main></DialogProvider>;
}
