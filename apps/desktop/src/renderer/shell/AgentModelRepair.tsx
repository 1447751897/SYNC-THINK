import { useState } from 'react';
import type { GlobalAgent } from '@sync-think/shared';
import type { ModelOption } from './NewConversationDialog.js';

/** A missing catalog binding is a configuration error, never a demo-model fallback. */
export function AgentModelRepair({ agents, models, onSaved, onSettings }: {
  agents: readonly GlobalAgent[]; models?: readonly ModelOption[];
  onSaved(agent: GlobalAgent): void; onSettings(): void;
}) {
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const missing = models === undefined ? [] : agents.filter(a => (!a.defaultKernelId || a.defaultKernelId === 'native') && !models.some(m => m.modelId === a.defaultModelId));
  if (!missing.length) return null;
  const save = async () => {
    if (saving || !models?.some(m => m.modelId === choice)) return;
    setSaving(true); setError('');
    try {
      for (const agent of missing) {
        const result = await window.syncThink!.runtime.updateGlobalAgent({ agentId: agent.id, defaultModelId: choice as GlobalAgent['defaultModelId'] });
        onSaved(result.agent);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型更新失败，请重试'); }
    finally { setSaving(false); }
  };
  return <section className="aw-model-repair" aria-label="修复智能体模型">
    <div role="status"><strong>{missing.length} 位智能体的模型已失效</strong><span>{missing.map(a => a.name).join('、')}。请重新选择可用模型；不会使用测试模型代答。</span></div>
    <div className="aw-model-repair__actions"><select aria-label="替换失效模型" value={choice} onChange={e => setChoice(e.target.value)} disabled={saving}><option value="">选择模型</option>{models?.map(m => <option key={m.modelId} value={m.modelId}>{m.displayName} · {m.providerName}</option>)}</select><button className="collab-pill" disabled={saving || !models?.some(m => m.modelId === choice)} onClick={() => void save()}>{saving ? '保存中…' : '应用到以上成员'}</button><button className="aw-text-button" onClick={onSettings}>模型设置</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
