import { useEffect, useState } from 'react';
import { AgentAppearanceEditor } from './AgentAppearanceEditor.js';
import { botAvatarSeed } from './bot-avatar.js';
import type { ModelOption } from './NewConversationDialog.js';
import type { CollaborationMember, GlobalAgent } from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { updateAgentPayload } from './agent-payload.js';

/** Reply languages; `auto` leaves the persona untouched. */
export const REPLY_LANGUAGES = [['auto', '自动检测'], ['zh', '简体中文'], ['en', 'English'], ['ja', '日本語']] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number][0];
const LANGUAGE_LINE = /\n*\[回复语言：[^\]\n]*\][^\n]*$/;

/** Language is persisted in the agent persona so every conversation honours it. */
export function personaLanguage(persona: string): ReplyLanguage {
  const label = LANGUAGE_LINE.exec(persona)?.[0].match(/\[回复语言：([^\]]*)\]/)?.[1];
  return REPLY_LANGUAGES.find(([, name]) => name === label)?.[0] ?? 'auto';
}
export function withPersonaLanguage(persona: string, language: ReplyLanguage) {
  const base = persona.replace(LANGUAGE_LINE, '');
  const name = REPLY_LANGUAGES.find(([id]) => id === language)?.[1];
  return language === 'auto' || !name ? base : `${base}${base ? '\n\n' : ''}[回复语言：${name}] 始终使用${name}回复。`;
}

/** Device-local delivery preferences (notification + read-aloud) per agent. */
export type AgentDevicePrefs = { notify: boolean; voice: boolean; rate: number };
const PREFS_KEY = 'sync-think.collab-agent-prefs';
const DEFAULT_PREFS: AgentDevicePrefs = { notify: false, voice: false, rate: 1 };
export function readAgentPrefs(agentId: string): AgentDevicePrefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, AgentDevicePrefs>)[agentId] }; } catch { return DEFAULT_PREFS; }
}
function writeAgentPrefs(agentId: string, prefs: AgentDevicePrefs) {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, AgentDevicePrefs>;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...all, [agentId]: prefs }));
  } catch { /* storage blocked */ }
}

/** Speak or notify for a freshly arrived reply according to the sender's prefs. */
export function announceReply(member: CollaborationMember, text: string) {
  if (!member.agentId || !text.trim()) return;
  const prefs = readAgentPrefs(member.agentId);
  if (prefs.voice && typeof speechSynthesis !== 'undefined') {
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 600));
    utterance.rate = prefs.rate;
    speechSynthesis.speak(utterance);
  }
  if (prefs.notify && typeof Notification !== 'undefined' && !document.hasFocus()) {
    const show = () => new Notification(`${member.name} 已回复`, { body: text.slice(0, 140) });
    if (Notification.permission === 'granted') show();
    else if (Notification.permission !== 'denied') void Notification.requestPermission().then((result) => { if (result === 'granted') show(); });
  }
}

type Props = { member: CollaborationMember; agent?: GlobalAgent; onSaved?(agent?: GlobalAgent): void; workspace?: boolean; creating?: boolean; models?: readonly ModelOption[]; onCreated?(agent: GlobalAgent): void; onAdvanced?(): void; onModelSettings?(): void };
const NO_MODELS: readonly ModelOption[] = [];

export function AgentEditorPanel({ member, agent, onSaved, workspace = false, creating = false, models = NO_MODELS, onCreated, onAdvanced, onModelSettings }: Props) {
  const [avatar, setAvatar] = useState(agent?.avatar ?? (creating ? botAvatarSeed('star', 'cyan') : member.avatar ?? ''));
  const [name, setName] = useState(creating ? '' : agent?.name ?? member.name);
  const [description, setDescription] = useState(agent?.description ?? '');
  const [persona, setPersona] = useState(agent?.persona ?? '');
  const [modelId, setModelId] = useState(agent?.defaultModelId ?? models[0]?.modelId ?? '');
  const [language, setLanguage] = useState<ReplyLanguage>(personaLanguage(agent?.persona ?? ''));
  const [prefs, setPrefs] = useState(() => readAgentPrefs(member.agentId ?? member.id));
  const [status, setStatus] = useState('');
  useEffect(() => { setAvatar(agent?.avatar ?? (creating ? botAvatarSeed('star', 'cyan') : member.avatar ?? '')); setName(creating ? '' : agent?.name ?? member.name); setPersona(agent?.persona ?? ''); setModelId(agent?.defaultModelId ?? ''); setDescription(agent?.description ?? ''); setLanguage(personaLanguage(agent?.persona ?? '')); setPrefs(readAgentPrefs(member.agentId ?? member.id)); setStatus(''); }, [agent?.id, agent?.name, agent?.avatar, agent?.description, agent?.persona, member.id, member.name, member.avatar, member.agentId, agent?.defaultModelId, creating]);
  useEffect(() => { if (creating && !modelId && models[0]) setModelId(models[0].modelId); }, [creating, modelId, models]);
  const updatePrefs = (patch: Partial<AgentDevicePrefs>) => setPrefs((current) => { const next = { ...current, ...patch }; writeAgentPrefs(member.agentId ?? member.id, next); return next; });
  const dirty = creating || Boolean(agent) && (avatar !== (agent!.avatar ?? '') || name.trim() !== agent!.name || description.trim() !== agent!.description || language !== personaLanguage(agent!.persona) || persona !== agent!.persona || modelId !== agent!.defaultModelId);
  const save = async () => {
    const api = window.syncThink?.runtime;
    if (!name.trim() || status === '保存中…') return;
    if (!modelId.trim()) { setStatus('请选择默认模型后再保存。'); return; }
    if (!api || (creating ? !api.createGlobalAgent : !api.updateGlobalAgent)) { setStatus('智能体服务尚未连接，请稍后重试。'); return; }
    setStatus('保存中…');
    try {
      const fields = { avatar, name: name.trim(), description: description.trim(), persona: withPersonaLanguage(persona, language), defaultModelId: modelId as GlobalAgent['defaultModelId'] };
      if (creating) {
        const result = await api.createGlobalAgent({ ...fields, defaultKernelId: 'native', availabilityScope: 'global', writePolicy: 'inherit', fallbackModelIds: [], skillIds: [], mcpServerIds: [], reasoningEffort: 'auto' });
        setStatus('已创建'); onCreated?.(result.agent);
      } else if (agent) {
        const result = await api.updateGlobalAgent(updateAgentPayload(agent, { ...fields, fallbackModelIds: agent.fallbackModelIds?.filter(id => id !== modelId) ?? [] }));
        setStatus('已保存，新的对话轮次生效'); onSaved?.(result?.agent ?? { ...agent, ...fields });
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : '保存失败'); }
  };
  return <div className="collab-editor-shell"><div className="collab-panel__body collab-editor" data-testid="collaboration-agent-editor">
    {workspace ? <>
      <AgentAppearanceEditor name={name || member.name} avatar={avatar} onChange={setAvatar} />
    </> : <div className="collab-editor__hero"><AgentAvatarView name={name || member.name} avatar={agent?.avatar ?? member.avatar} size={72} animate state="happy" /><strong>{name || member.name}</strong>{member.role && <span className="collab-tag">{member.role}</span>}</div>}
    {!agent && !creating && <p className="collab-muted">这个成员不是可编辑的智能体，只能调整本机的通知与语音。</p>}
    {(agent || creating) && <>
      <label className="collab-field">名字<input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></label>
      <label className="collab-field">描述<textarea value={description} maxLength={400} onChange={(event) => setDescription(event.target.value)} /></label>
      {(creating || models.length > 0) && <label className="collab-field">默认模型<select aria-label="默认模型" value={modelId} onChange={event => setModelId(event.target.value)}><option value="" disabled>选择模型</option>{modelId && !models.some(model => model.modelId === modelId) && <option value={modelId}>{modelId}（当前绑定）</option>}{models.map(model => <option key={model.modelId} value={model.modelId}>{model.displayName} · {model.providerName}</option>)}</select></label>}
      {creating && !models.length && <p className="collab-muted">还没有配置模型。{onModelSettings && <button className="aw-text-button" onClick={onModelSettings}>去模型设置</button>}</p>}
      {workspace && <label className="collab-field">人设<textarea aria-label="人设" placeholder="这个智能体擅长什么，如何与你沟通？" value={persona.replace(LANGUAGE_LINE, '')} onChange={event => setPersona(event.target.value)} /></label>}
      <label className="collab-field">回复语言<select value={language} onChange={(event) => setLanguage(event.target.value as ReplyLanguage)}>{REPLY_LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </>}
    {!creating && <><label className="collab-toggle"><input type="checkbox" checked={prefs.notify} onChange={(event) => updatePrefs({ notify: event.target.checked })} /><span>回复完成时通知<small>窗口不在前台时弹出系统通知。</small></span></label>
    <label className="collab-toggle"><input type="checkbox" checked={prefs.voice} onChange={(event) => updatePrefs({ voice: event.target.checked })} /><span>朗读回复<small>使用系统语音，仅在本机生效。</small></span></label>
    {prefs.voice && <label className="collab-field">语速 {prefs.rate.toFixed(1)}×<input type="range" min={0.5} max={2} step={0.1} value={prefs.rate} onChange={(event) => updatePrefs({ rate: Number(event.target.value) })} /></label>}
    </>}
    {onAdvanced && agent && <button className="aw-text-button" onClick={onAdvanced}>更多配置 · 能力与执行设置</button>}
    </div>
    {(agent || creating) && <div className="collab-toolbar aw-editor-actions"><button type="button" className="collab-send collab-editor__save" disabled={!dirty || !name.trim() || status === '保存中…'} onClick={() => void save()}>{creating ? '创建智能体' : '保存'}</button><span className="collab-muted" role="status">{status}</span></div>}
  </div>;
}

