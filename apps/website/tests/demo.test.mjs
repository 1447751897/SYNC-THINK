import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

test('demo imports the actual desktop cards instead of hand-drawn replicas', async () => {
  const source = await readFile(
    new URL('../../desktop/src/renderer/shell/WebsiteChatDemo.tsx', import.meta.url),
    'utf8',
  );
  for (const component of [
    'ComposerTaskPanel',
    'AskQuestionCard',
    'PlanApprovalCard',
    'ToolApprovalCard',
    'ComposerApprovalStack',
    'NewMaxComposerFrame',
    'ComposerEditor',
    'InlineProcessFlow',
    'CodeBlock',
    'DeferredFileDiff',
    'ComposeRequestQueue',
    'WebsiteDemoWorkbench',
    'WebsiteDemoToolbar',
    'BrowserHandoffCard',
    'DesktopWaitingCard',
  ]) {
    assert.match(source, new RegExp(`from './${component}\\.js'`));
  }
  assert.doesNotMatch(source, /TaskPlanHistoryPanel|readDemoHistory/);
  const html = await readFile(new URL('../demo.html', import.meta.url), 'utf8');
  assert.match(html, /assets\/chat-shell\.css/);
  assert.match(html, /assets\/chat-app\.js/);
  assert.doesNotMatch(html, /id="plan-steps"|src="\/demo.js"/);
  const capability = await readFile(
    new URL('../../desktop/src/renderer/shell/WebsiteCapabilityDemo.tsx', import.meta.url),
    'utf8',
  );
  for (const component of ['AgentLibrary', 'TeamLibrary', 'KernelUpdatePanel'])
    assert.match(capability, new RegExp(`from './${component}\\.js'`));
  const landing = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((landing.match(/src="\/demo\.html\?view=(?:kernels|agents|teams)"/g) ?? []).length, 3);
  assert.doesNotMatch(landing, /continuum-gallery|capability-card|night-lake|anime-lake/);
});

test(
  'ChatApp iframe interactive coverage',
  { skip: !process.env.SYNC_THINK_DEMO_TEST_URL, timeout: 120000 },
  async (suite) => {
    const require = createRequire(
      new URL('../../../packages/workers/package.json', import.meta.url),
    );
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({
      headless: true,
      ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(6000);
      const errors = [];
      const forbiddenRequests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          /Content Security Policy|Refused to|form submission/i.test(message.text())
        )
          errors.push(message.text());
      });
      page.on('request', (request) => {
        if (
          request.frame().url().includes('/demo') &&
          ['fetch', 'xhr', 'websocket'].includes(request.resourceType())
        )
          forbiddenRequests.push(request.url());
      });
      await page.goto(process.env.SYNC_THINK_DEMO_TEST_URL);
      const iframe = page.locator('iframe[src="/demo.html"]');
      await iframe.scrollIntoViewIfNeeded();
      assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
      const frame = page.frameLocator('iframe[src="/demo.html"]');
      await frame.getByTestId('website-chat-app').waitFor();
      const select = async (scene) => {
        await frame.getByTestId(`scene-${scene}`).click();
      };
      const fillPrompt = async (text) => {
        await frame.locator('.cm-content[contenteditable="true"]').fill(text);
      };

      await suite.test('task panel matches desktop location, collapses and completes', async () => {
        assert.equal(await frame.locator('.shell-composer-task-panel').count(), 1);
        assert.equal(
          await frame.locator('.demo-composer-surfaces > .shell-composer-task-panel').count(),
          1,
        );
        await frame.getByRole('button', { name: '任务进度 0/4', exact: true }).click();
        assert.equal(await frame.getByTestId('composer-task-list').count(), 0);
        await frame.getByRole('button', { name: '任务进度 0/4', exact: true }).click();
        assert.equal(await frame.getByTestId('composer-task-list').isVisible(), true);
        await frame.getByRole('button', { name: '清除任务清单' }).click();
        assert.equal(await frame.getByTestId('composer-task-panel').count(), 0);
        await frame.getByRole('button', { name: '重新开始当前场景' }).click();
        for (let index = 0; index < 4; index++) await frame.getByTestId('demo-next').click();
        await frame.getByTestId('demo-result').waitFor();
        assert.equal(await frame.getByTestId('composer-task-panel').count(), 0);
      });

      await suite.test('full send, questions, plan and tool approval flow', async () => {
        await select('flow');
        await fillPrompt('请把任务、提问与审批串成一个完整流程。');
        await frame.getByTestId('demo-send').click();
        await frame.getByTestId('ask-question-card').waitFor();
        await frame.getByLabel('首次使用者', { exact: true }).click();
        await frame.getByLabel('任务进度', { exact: true }).click();
        await frame.getByLabel('提问与审批', { exact: true }).click();
        await frame.getByRole('button', { name: '提交', exact: true }).click();
        await frame.getByTestId('plan-approval-card').waitFor();
        await frame.getByTestId('plan-view-details').click();
        assert.equal(
          await frame.getByTestId('plan-view-details').getAttribute('aria-expanded'),
          'true',
        );
        await frame.getByRole('button', { name: '批准并执行', exact: true }).click();
        await frame.getByTestId('tool-approval-demo-write').waitFor();
        await frame.getByRole('button', { name: '本会话允许', exact: true }).click();
        for (let index = 0; index < 4; index++) await frame.getByTestId('demo-next').click();
        await frame.getByTestId('demo-result').waitFor();
      });

      await suite.test(
        'editable plan revisions remain visible and enforce save before approval',
        async () => {
          await select('plan');
          await frame.getByRole('button', { name: '要求修改', exact: true }).click();
          const dialog = frame.getByRole('dialog', { name: '编辑执行方案' });
          await dialog.getByLabel('计划标题', { exact: true }).fill('修订后的演示计划');
          assert.equal(
            await dialog.getByRole('button', { name: /^批准并执行 v/ }).isDisabled(),
            true,
          );
          await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
          await page.waitForFunction(() =>
            document
              .querySelector('iframe')
              .contentDocument.querySelector('[data-testid="demo-status"]')
              .textContent.includes('v2'),
          );
          await dialog.getByRole('button', { name: '关闭方案编辑' }).click();
          await frame.getByRole('button', { name: '取消', exact: true }).click();
          await frame.getByTestId('plan-approval-card').waitFor({ state: 'detached' });
          assert.match(await frame.getByTestId('demo-status').textContent(), /取消/);
        },
      );

      await suite.test(
        'question custom answer, skip, cancel, and denied tool remain non-executing',
        async () => {
          await select('question');
          await frame.getByPlaceholder('输入你的答案').fill('设计验收团队');
          await frame.getByRole('button', { name: '下一题', exact: true }).last().click();
          await frame.getByRole('button', { name: '跳过本题', exact: true }).click();
          await frame.getByTestId('plan-approval-card').waitFor();
          assert.match(await frame.getByTestId('demo-status').textContent(), /设计验收团队/);
          await select('question');
          await frame.getByRole('button', { name: '放弃整组问题' }).click();
          assert.match(await frame.getByTestId('demo-status').textContent(), /取消/);
          await select('tool');
          await frame.getByRole('button', { name: '拒绝', exact: true }).click();
          assert.match(await frame.getByTestId('demo-status').textContent(), /拒绝/);
          assert.equal(await frame.getByTestId('demo-result').count(), 0);
          assert.equal(await frame.getByTestId('demo-next').count(), 0);
        },
      );

      await suite.test('generated files use real code and diff components', async () => {
        await select('result');
        await frame.getByRole('button', { name: '打开文件产物' }).click();
        const files = frame.locator('[data-workspace-panel-placement="right"]');
        assert.equal(await frame.getByRole('dialog', { name: '示例文件' }).count(), 0);
        const chatBox = await frame.getByRole('region', { name: '对话工作台' }).boundingBox();
        const filesBox = await files.boundingBox();
        assert.ok(chatBox.x + chatBox.width <= filesBox.x + 1);
        const resize = files.getByRole('separator', { name: '调整右侧工作台宽度' });
        await resize.focus();
        await resize.press('ArrowRight');
        await page.waitForTimeout(250);
        assert.ok((await files.boundingBox()).width < filesBox.width);
        await files.getByRole('tab', { name: 'task.ts', exact: false }).click();
        assert.match(await files.textContent(), /describeTask/);
        await files.getByRole('tab', { name: /审阅/ }).click();
        await files.getByRole('button', { name: '读取差异', exact: true }).click();
        await files.getByRole('button', { name: '重新读取差异', exact: true }).waitFor();
        await files.getByRole('button', { name: '修改前', exact: true }).click();
        assert.match(await files.textContent(), /return '进行中'/);
        await files.getByRole('button', { name: '修改后', exact: true }).click();
        assert.match(await files.textContent(), /completed === total/);
        await files.getByRole('button', { name: '工作台更多操作' }).click();
        await files.getByRole('menuitem', { name: '关闭工作台' }).click();
      });

      await suite.test('toolbar menus retain selected permissions, skills and models', async () => {
        await select('flow');
        await frame.getByRole('button', { name: '权限模式', exact: true }).click();
        await frame.getByRole('menuitemradio', { name: /^完全访问/ }).click();
        assert.match(
          await frame.getByRole('button', { name: '权限模式', exact: true }).textContent(),
          /完全访问/,
        );
        await frame.getByRole('button', { name: '本轮 Skill', exact: true }).click();
        await frame.getByRole('menuitemcheckbox', { name: /^界面检查/ }).click();
        await page.keyboard.press('Escape');
        await frame.getByRole('button', { name: '移除 Skill 界面检查' }).click();
        await frame.getByRole('button', { name: '对话对象', exact: true }).click();
        await frame.getByRole('menuitemradio', { name: /^产品协作小队/ }).click();
        assert.match(
          await frame.getByRole('button', { name: '对话对象', exact: true }).getAttribute('title'),
          /产品协作小队/,
        );
        await frame.getByTitle('切换模型，思考强度：自动', { exact: true }).click();
        await frame.getByTestId('model-provider-示例模型').click();
        await frame.getByRole('menuitemradio', { name: 'Claude', exact: true }).click();
        assert.match(await frame.locator('.shell-compose__model-btn').textContent(), /Claude/);
        await frame.getByTitle('切换模型，思考强度：自动', { exact: true }).click();
        await frame.getByTestId('model-reasoning-trigger').click();
        await frame.getByTestId('model-reasoning-option-high').click();
        await frame.getByTitle('切换模型，思考强度：高', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await frame.getByRole('button', { name: '添加文件和更多', exact: true }).click();
        const add = frame.getByRole('listbox', { name: '添加文件和更多' });
        await add.getByText('规划模式', { exact: true }).click();
        await frame.getByTestId('composer-plan-banner').waitFor();
        await frame.getByRole('button', { name: '添加文件和更多', exact: true }).click();
        await add.getByText('联网搜索', { exact: true }).click();
        await page.keyboard.press('Escape');
        await fillPrompt('@task');
        await add.getByText('task.ts', { exact: true }).click();
        await page.keyboard.press('Escape');
        assert.match(await frame.locator('.shell-newmax-composer').textContent(), /task.ts/);
        assert.equal(
          await frame
            .locator('.demo-composer-surfaces')
            .evaluate((el) => getComputedStyle(el).scrollbarWidth),
          'none',
        );
      });

      await suite.test('queued follow-ups can be inserted or deleted', async () => {
        await select('queue');
        await fillPrompt('随后检查审批卡');
        await frame.getByTestId('demo-send').click();
        await frame.getByTestId('compose-request-queue').waitFor();
        await frame.getByRole('button', { name: '插话', exact: true }).click();
        assert.match(await frame.getByTestId('demo-status').textContent(), /插话/);
        await fillPrompt('这条先不要做');
        await frame.getByTestId('demo-send').click();
        await frame.getByRole('button', { name: '删除待处理需求 1' }).click();
        assert.equal(await frame.getByTestId('compose-request-queue').count(), 0);
      });

      await suite.test('failure retry, handoffs and goal banner are interactive', async () => {
        await select('error');
        await frame.getByRole('button', { name: '重试检查' }).click();
        await frame.getByTestId('composer-task-panel').waitFor();
        assert.equal(await frame.getByTestId('scene-history').count(), 0);
        await select('browser');
        await frame.getByTestId('browser-handoff-demo-browser').waitFor();
        await select('desktop');
        await frame.getByTestId('desktop-waiting-demo-desktop').waitFor();
        await select('goal');
        await frame.getByTestId('composer-goal-banner').waitFor();
      });

      await suite.test(
        'stream output can stop and restart without background work leaking across scenes',
        async () => {
          await select('streaming');
          await frame.getByRole('button', { name: '停止生成', exact: true }).first().click();
          const stopped = await frame.locator('.demo-stream').textContent();
          await page.waitForTimeout(180);
          assert.equal(await frame.locator('.demo-stream').textContent(), stopped);
          await frame.getByRole('button', { name: '继续生成', exact: true }).click();
          await select('tasks');
          assert.equal(await frame.locator('.demo-stream').count(), 0);
        },
      );

      const capabilityIframe = page.locator('iframe[src="/demo.html?view=kernels"]');
      const capability = page.frameLocator('iframe[src="/demo.html?view=kernels"]');
      await suite.test('capability embed separates kernel and model selection', async () => {
        await capabilityIframe.scrollIntoViewIfNeeded();
        await capability.getByTestId('website-capability-app').waitFor();
        if (!(await capability.getByTestId('kernel-option-codex').isVisible()))
          await capability.locator('.shell-compose__model-btn').click();
        await capability.getByTestId('kernel-option-codex').click();
        assert.match(await capability.locator('.demo-kernel-selection').textContent(), /Codex/);
        await capability.locator('.shell-compose__model-btn').click();
        assert.equal(
          await capability.getByTestId('kernel-option-codex').getAttribute('aria-checked'),
          'true',
        );
        await capability.getByTestId('model-provider-示例模型').click();
        await capability.getByRole('menuitemradio', { name: 'DeepSeek', exact: true }).click();
        assert.match(
          await capability.locator('.demo-kernel-selection').textContent(),
          /Codex.*DeepSeek/,
        );
      });
      await suite.test(
        'embedded agent library edits the real detail pages and starts a conversation',
        async () => {
          await capability.getByRole('tab', { name: '智能体库', exact: true }).click();
          await capability.getByRole('searchbox', { name: '搜索智能体' }).fill('界面');
          assert.equal(await capability.locator('.shell-library-card').count(), 1);
          await capability.getByText('界面检查助手', { exact: true }).click();
          await capability.getByTestId('agent-drawer-tab-abilities').click();
          await capability.getByTestId('agent-ability-subtab-mcp').click();
          assert.match(
            await capability.getByTestId('agent-ability-content').textContent(),
            /工作区文件/,
          );
          await capability.getByTestId('agent-drawer-tab-settings').click();
          await capability.getByPlaceholder('前端小张').fill('界面验收助手');
          await capability.getByRole('button', { name: '保存', exact: true }).click();
          await capability.getByText('界面验收助手', { exact: true }).waitFor();
          await capability.getByRole('button', { name: '开始对话', exact: true }).click();
          assert.match(
            await capability
              .getByRole('button', { name: '对话对象', exact: true })
              .getAttribute('title'),
            /界面验收助手/,
          );
          await capability.getByRole('button', { name: '返回能力展示' }).click();
        },
      );
      await suite.test(
        'embedded team library saves collaboration strategy and preserves members',
        async () => {
          await capability.getByRole('tab', { name: '小队库', exact: true }).click();
          await capability.getByText('产品协作小队', { exact: true }).click();
          await capability.getByRole('button', { name: /并行/ }).click();
          assert.match(
            await capability.getByTestId('team-detail-drawer').textContent(),
            /界面验收助手/,
          );
          await capability.getByRole('button', { name: '保存', exact: true }).click();
          assert.match(
            await capability.locator('.shell-library-card').textContent(),
            /3 名成员.*并行/s,
          );
          await capability.getByRole('button', { name: '开始小队对话', exact: true }).click();
          assert.match(
            await capability
              .getByRole('button', { name: '对话对象', exact: true })
              .getAttribute('title'),
            /产品协作小队/,
          );
          await capability.getByRole('button', { name: '返回能力展示' }).click();
          await capability.getByRole('button', { name: '重置示例工作区' }).click();
          await capability.getByRole('tab', { name: '小队库', exact: true }).click();
          assert.match(await capability.locator('.shell-library-card').textContent(), /串行/);
        },
      );

      await suite.test('mobile and dark OS preserve light styling without overflow', async () => {
        for (const width of [390, 360]) {
          await page.setViewportSize({ width, height: 844 });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          assert.equal(
            await frame
              .locator('body')
              .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          assert.equal(
            await frame
              .locator('html')
              .evaluate((element) => getComputedStyle(element).colorScheme),
            'light',
          );
          await frame.getByRole('button', { name: '切换场景导航' }).click();
          await select('question');
          await frame.getByTestId('ask-question-card').waitFor();
          assert.equal(await frame.getByRole('button', { name: '跳过本题' }).isVisible(), true);
          await frame.getByRole('button', { name: '切换场景导航' }).click();
          await select('tasks');
          await frame.getByRole('button', { name: '切换场景导航' }).click();
          await select('result');
          await frame.getByRole('button', { name: '打开文件产物' }).click();
          const dock = frame.locator('[data-workspace-panel-placement="bottom"]');
          const dockBounds = await dock.boundingBox();
          const contentBounds = await dock.locator('.demo-workbench-content').boundingBox();
          assert.ok(contentBounds.height > 100);
          assert.ok(contentBounds.y + contentBounds.height <= dockBounds.y + dockBounds.height + 1);
          assert.equal(await frame.getByTestId('demo-send').isVisible(), true);
          await page.keyboard.press('Escape');
          await capabilityIframe.scrollIntoViewIfNeeded();
          await capability.getByRole('tab', { name: '智能体库', exact: true }).click();
          await capability.getByText('界面检查助手', { exact: true }).click();
          assert.equal(
            await capability.getByRole('button', { name: '保存', exact: true }).isVisible(),
            true,
          );
          assert.equal(
            await capability
              .locator('html')
              .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await capability.getByRole('button', { name: '关闭', exact: true }).click();
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(forbiddenRequests, []);
      });
    } finally {
      await browser.close();
    }
  },
);
