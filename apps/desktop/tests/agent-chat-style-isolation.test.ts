/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const rules = ['board-chat.css', 'workbench-design.css'].flatMap((file) => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/shell/' + file),
    'utf8',
  );
  return css
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith(':root') && line.includes('{'))
    .map((line) => ({
      file,
      selector: line.slice(0, line.indexOf('{')).trim(),
      declarations: line.slice(line.indexOf('{') + 1),
    }));
});

beforeEach(() => {
  document.documentElement.dataset.shellDesign = 'agent';
  document.body.innerHTML = `<main class="shell-normal-workspace">
    <section class="agent-chat-workspace agent-chat-workspace--embedded">
      <div class="aw-legacy"><div class="shell-chat-column">
        <div class="shell-chat-content-wrap shell-chat-message-scroller"><div class="shell-chat-content">消息</div></div>
        <div class="shell-chat-content-wrap"><div class="shell-chat-content shell-chat-content--composer">输入框</div></div>
        <div class="shell-user-bubble">用户消息</div>
      <div class="shell-newmax-composer-frame"><div class="shell-newmax-composer shell-compose"><div class="shell-compose__bar">输入操作</div></div></div>
        <div class="shell-streaming-response" data-variant="bubble"><div class="shell-response__content">智能体回复</div><div class="shell-response__footer">操作栏</div></div>
      </div></div>
    </section>
    <section data-testid="workbench-chat"><div class="shell-chat-column">
      <div class="shell-chat-content-wrap shell-chat-message-scroller"><div class="shell-chat-content">消息</div></div>
      <div class="shell-chat-content-wrap"><div class="shell-chat-content shell-chat-content--composer">输入框</div></div>
      <div class="shell-user-bubble">用户消息</div>
      <div class="shell-newmax-composer-frame"><div class="shell-newmax-composer shell-compose"><div class="shell-compose__bar">输入操作</div></div></div>
      <div class="shell-streaming-response" data-variant="bubble"><div class="shell-response__content">模型回复</div><div class="shell-response__footer">操作栏</div></div>
    </div></section>
  </main>`;
});
afterEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.shellDesign;
});

describe('embedded agent chat style isolation', () => {
  it('explicitly restores a full-width group composer after shared attachment styles', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/shell/agent-workspace.css'),
      'utf8',
    );
    const scoped = css
      .split(/\r?\n/)
      .find((line) =>
        line.includes(
          '.agent-chat-workspace form.collab-composer[data-composer-style=attachments]',
        ),
      )!;
    expect(scoped).toBeTruthy();
    expect(scoped).toContain('max-width: none;');
    expect(scoped).toContain('width: calc(100% - 8px);');
  });

  it.each(['.shell-chat-content', '.shell-chat-content--composer'])(
    'does not cap embedded %s at the workbench width',
    (target) => {
      const widthRules = rules.filter(
        (rule) =>
          rule.selector.includes('.shell-chat-content') && rule.declarations.includes('max-width:'),
      );
      const embedded = document.querySelector('.agent-chat-workspace ' + target)!;
      const workbench = document.querySelector('[data-testid="workbench-chat"] ' + target)!;
      expect(widthRules.some((rule) => workbench.matches(rule.selector))).toBe(true);
      expect(
        widthRules.filter((rule) => embedded.matches(rule.selector)).map((rule) => rule.selector),
      ).toEqual([]);
    },
  );

  it.each(['board-chat.css', 'workbench-design.css'])(
    'isolates %s reply surfaces from agent bubbles when Board design is active on the surrounding shell',
    (file) => {
      const flatten = rules.find(
        (rule) =>
          rule.file === file &&
          rule.selector.includes('.shell-response__content') &&
          !rule.selector.includes('data-image-theme'),
      )!;
      expect(flatten).toBeTruthy();
      expect(
        document
          .querySelector('[data-testid="workbench-chat"] .shell-response__content')!
          .matches(flatten.selector),
      ).toBe(true);
      expect(
        document
          .querySelector('.agent-chat-workspace .shell-response__content')!
          .matches(flatten.selector),
      ).toBe(false);
    },
  );

  it.each([
    '.shell-chat-content-wrap',
    '.shell-chat-message-scroller',
    '.shell-user-bubble',
    '.shell-response__footer',
    '.shell-newmax-composer',
    '.shell-compose__bar',
  ])('keeps workbench spacing out of embedded %s', (target) => {
    const embedded = document.querySelector('.agent-chat-workspace ' + target)!;
    const workbench = document.querySelector('[data-testid="workbench-chat"] ' + target)!;
    const workbenchRules = rules.filter(
      (rule) => rule.selector.includes(target) && workbench.matches(rule.selector),
    );
    expect(workbenchRules.length).toBeGreaterThan(0);
    expect(
      workbenchRules.filter((rule) => embedded.matches(rule.selector)).map((rule) => rule.selector),
    ).toEqual([]);
  });
});
