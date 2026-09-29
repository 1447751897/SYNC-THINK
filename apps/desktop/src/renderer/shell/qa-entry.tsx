import { lazy, Suspense } from 'react';
const AgentWorkspaceFixture = lazy(() => import('./AgentWorkspaceFixture.js'));
import { createRoot } from 'react-dom/client';
import { Phase3VisualFixture, resolvePhase3VisualCase } from './Phase3VisualFixture.js';

const params = new URLSearchParams(window.location.search);
const visualCase = resolvePhase3VisualCase(window.location.search);
const agentWorkspaceCase = params.get('phase3-visual') === 'agent-workspace';
if (!visualCase && !agentWorkspaceCase) throw new Error('Missing or invalid Phase 3 visual case');
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.toggle('dark', theme === 'dark');
document.documentElement.dataset.phase3Theme = theme;
document.documentElement.toggleAttribute('data-reduced-motion', params.get('motion') !== 'full');
const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(agentWorkspaceCase ? <Suspense fallback={<p>正在载入智能体 UI 验收…</p>}><AgentWorkspaceFixture /></Suspense> : <Phase3VisualFixture visualCase={visualCase!} />);
