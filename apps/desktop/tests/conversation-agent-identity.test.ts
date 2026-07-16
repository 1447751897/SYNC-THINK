import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');
const messageSource = readFileSync(
  new URL('../../../packages/ui-kit/src/components/MessageBubble.tsx', import.meta.url),
  'utf8',
);
const uiCss = readFileSync(
  new URL('../../../packages/ui-kit/src/styles/components.css', import.meta.url),
  'utf8',
);
const rendererCss = readFileSync(new URL('../src/renderer/renderer.css', import.meta.url), 'utf8');

describe('conversation Agent identity composition', () => {
  it('uses a plain task breadcrumb and one actionable next step on the beginner surface', () => {
    expect(source).toContain('data-testid="beginner-next-step"');
    expect(source).toContain('<strong>需要你处理</strong>');
    expect(source).not.toContain('className="st-task-overview__next"');
    expect(source).toContain('<span>{active.workspaceName}</span>');
    expect(source).toContain('<span>任务</span>');
    expect(source).not.toContain("categoryLabel: '上下文'");
    expect(rendererCss).toContain('.st-demo-header-tools .st-demo-mode > button');
    expect(rendererCss).toContain('word-break: keep-all');
  });

  it('keeps the completed M1 workbench out of the normal product surface', () => {
    expect(source).toContain('const SHOW_M1_VALIDATION_WORKBENCH = false');
    expect(source).toMatch(/SHOW_M1_VALIDATION_WORKBENCH\s*\?\s*\(\s*<details/);
  });

  it('resolves exact message Agent versions and opens their Agent drawer', () => {
    expect(source).toContain('message.agentVersionId');
    expect(source).toContain('agentVersionById.get');
    expect(source).toContain('agentLabel={agentIdentity.name}');
    expect(source).toContain('agentIcon={agentIdentity.icon}');
    expect(source).toContain('agentColor={agentIdentity.color}');
    expect(source).toContain('onAgentActivate=');
    expect(source).toContain("navigateToInstrument('agent')");
  });

  it('renders a stable round avatar gutter without restoring execution metadata', () => {
    expect(messageSource).toContain('message-agent-avatar');
    expect(messageSource).toContain('message-agent-identity');
    expect(uiCss).toContain('.st-message-bubble__avatar');
    expect(uiCss).toContain('border-radius: 50%');
    expect(messageSource).not.toContain('{props.meta}');
  });
});
