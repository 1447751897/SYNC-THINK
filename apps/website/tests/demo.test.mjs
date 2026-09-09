import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoState, transitionDemo, scenarios } from '../demo.js';

test('plan mode waits for approval and never produces artifacts before the last step', () => {
  let state = createDemoState('website');
  state = transitionDemo(state, { type: 'submit', prompt: '为我的本地产品整理介绍页。' });
  assert.equal(state.phase, 'approval');
  assert.equal(transitionDemo(state, { type: 'next' }), state);
  assert.equal(state.artifact, null);
  state = transitionDemo(state, { type: 'approve' });
  for (let index = 0; index < scenarios.website.steps.length; index++) {
    state = transitionDemo(state, { type: 'next' });
    assert.equal(state.completed, index + 1);
    assert.equal(Boolean(state.artifact), index === scenarios.website.steps.length - 1);
  }
  assert.equal(state.phase, 'complete');
  assert.equal(state.artifact.name, '产品介绍页.md');
  assert.equal(transitionDemo(state, { type: 'next' }), state);
});

test('execute mode advances directly and preserves the model used for the run', () => {
  let state = transitionDemo(createDemoState('release'), { type: 'model', value: 'ClaudeCode' });
  state = transitionDemo(state, { type: 'mode', value: 'execute' });
  state = transitionDemo(state, { type: 'submit', prompt: '核对下一版的发布清单' });
  assert.equal(state.phase, 'active');
  assert.equal(state.runModel, 'ClaudeCode');
  assert.equal(transitionDemo(state, { type: 'model', value: 'GPT' }), state);
  while (state.phase === 'active') state = transitionDemo(state, { type: 'next' });
  assert.match(state.artifact.text, /安装包/);
  assert.match(state.messages.at(-1).text, /演示已完成/);
  assert.equal(state.messages.filter((message) => message.kind === 'tool').length, 3);
});

test('switching scenario clears previous work while keeping chosen model and mode', () => {
  let state = transitionDemo(createDemoState('website'), { type: 'model', value: 'GPT' });
  state = transitionDemo(state, { type: 'submit', prompt: '<script>sample</script>' });
  assert.equal(
    state.messages.find((message) => message.role === 'user').text,
    '<script>sample</script>',
  );
  state = transitionDemo(state, { type: 'scenario', value: 'release' });
  assert.equal(state.model, 'GPT');
  assert.equal(state.phase, 'ready');
  assert.equal(state.completed, 0);
  assert.equal(state.artifact, null);
  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0].text, /发布/);
});

test('blank submissions use the selected sample and active runs reject duplicate submissions', () => {
  const state = createDemoState('release');
  const started = transitionDemo(state, { type: 'submit', prompt: '   ' });
  assert.equal(
    started.messages.find((message) => message.role === 'user').text,
    scenarios.release.prompt,
  );
  assert.equal(transitionDemo(started, { type: 'submit', prompt: 'duplicate' }), started);
  assert.equal(transitionDemo(started, { type: 'approve' }).completed, 0);
  const reset = transitionDemo(started, { type: 'reset' });
  assert.equal(reset.phase, 'ready');
  assert.equal(reset.scenarioId, 'release');
});

test('invalid selections are ignored and long prompts are bounded', () => {
  const state = createDemoState();
  for (const action of [
    { type: 'model', value: 'unknown' },
    { type: 'mode', value: 'unknown' },
    { type: 'scenario', value: 'unknown' },
  ]) {
    assert.equal(transitionDemo(state, action), state);
  }
  assert.equal(
    transitionDemo(state, { type: 'submit', prompt: 'a'.repeat(5000) }).messages[1].text.length,
    1000,
  );
});

test(
  'homepage sandboxed iframe sends, approves, and completes without form permission',
  {
    skip: !process.env.SYNC_THINK_DEMO_TEST_URL,
    timeout: 30000,
  },
  async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(
      new URL('../../../packages/workers/package.json', import.meta.url),
    );
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({
      headless: true,
      ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' && /form submission|sandboxed/i.test(message.text()))
          errors.push(message.text());
      });
      await page.goto(process.env.SYNC_THINK_DEMO_TEST_URL);
      const iframe = page.locator('iframe[src="/demo"]');
      assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
      await iframe.scrollIntoViewIfNeeded();
      const frame = page.frameLocator('iframe[src="/demo"]');
      await frame.locator('#prompt').fill('在嵌入的演示中整理产品介绍。');
      await frame.locator('#send-prompt').click();
      await frame.locator('#advance-run').waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(await frame.locator('#plan-state').textContent(), '等待确认');
      await frame.locator('#advance-run').click();
      for (let index = 0; index < 3; index++) await frame.locator('#advance-run').click();
      assert.equal(await frame.locator('#run-status').textContent(), '演示已完成');
      assert.equal(await frame.locator('#artifact-name').textContent(), '产品介绍页.md');
      assert.equal(await frame.locator('.tool-result').count(), 3);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
