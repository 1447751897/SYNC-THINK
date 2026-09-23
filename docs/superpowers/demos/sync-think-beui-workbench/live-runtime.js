(function () {
  'use strict';

  window.installLiveRuntime = function installLiveRuntime(api) {
    const {root, state, wb, wbConversations, wbCurrent, wbSession, wbOpen, esc, icon, render, persist, paint, toast} = api;
    const KEY = 'sync-think-live-runs-v1';
    const local = {connected: false, runs: new Map(), opened: new Set(), timer: null};
    const finalStates = new Set(['completed', 'failed', 'cancelled']);
    const statusText = {queued: '排队中', running: '执行中', waiting_approval: '等待审批', completed: '已完成', failed: '失败', cancelled: '已取消'};

    function save() {
      const conversations = wbConversations.filter(c => c.scenario === 'live');
      const sessions = Object.fromEntries(conversations.map(c => [c.id, {
        ...wbSession(c), live: {turns: wbSession(c).live?.turns || []}, timer: undefined
      }]));
      try { localStorage.setItem(KEY, JSON.stringify({conversations, sessions, selected: wb.id})); } catch (_) {}
    }
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const c of saved.conversations || []) if (!wbConversations.some(existing => existing.id === c.id)) wbConversations.push(c);
      for (const [id, s] of Object.entries(saved.sessions || {})) wb.session[id] = s;
    } catch (_) {}
    for (const c of wbConversations) if (c.scenario !== 'live' && !c.title.startsWith('样例 · ')) c.title = '样例 · ' + c.title;

    async function request(path, body) {
      const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '本地服务返回错误 ' + response.status);
      return data;
    }
    request('/api/health').then(() => { local.connected = true; updateStatus(); }).catch(() => { local.connected = false; updateStatus(); });
    function updateStatus() {
      const badge = root.querySelector('#live-service-badge');
      if (badge) badge.textContent = local.connected ? '本地执行服务已连接' : '本地执行服务未连接 · 请运行 server.py';
    }
    function present(run) {
      const current = wbCurrent();
      if (current?.scenario === 'live' && wbSession(current).live?.turns.some(t => t.runId === run.id)) paint();
      save();
    }
    async function poll() {
      const active = [...local.runs.entries()];
      for (const [id, turn] of active) {
        try {
          const snapshot = await request('/api/runs/' + id);
          turn.run = snapshot;
          present(snapshot);
          if (finalStates.has(snapshot.status)) local.runs.delete(id);
        } catch (error) {
          turn.error = error.message;
          local.runs.delete(id);
          paint();
        }
      }
      local.timer = setTimeout(poll, local.runs.size ? 350 : 1700);
    }
    poll();

    function currentModel() {
      return root.querySelector('#be-compose [name="chatModel"]')?.value || state.chatModel || 'deepseek-flash';
    }
    async function startTurn(c, prompt) {
      const s = wbSession(c);
      const turn = {prompt, run: null, runId: null, createdAt: new Date().toISOString()};
      s.live ||= {turns: []};
      s.live.turns.push(turn);
      s.draft = '';
      s.mode = 'running';
      c.model = currentModel();
      paint(); save();
      try {
        const created = await request('/api/runs', {prompt, workspace: c.workspace, model: c.model, thinking: wb.thinking || '中'});
        turn.runId = created.id;
        turn.run = created;
        local.runs.set(created.id, turn);
        paint(); save();
      } catch (error) {
        turn.error = error.message;
        s.mode = 'failed';
        paint(); save();
      }
    }
    async function send() {
      const field = root.querySelector('#be-compose textarea');
      const prompt = field?.value.trim();
      if (!prompt) return;
      if (!local.connected) { toast('本地执行服务未连接。请运行 python server.py --port 8775'); return; }
      let c = state.page === 'chat' ? wbCurrent() : null;
      if (!c) {
        const kind = state.chatKind || 'model';
        c = {id: 'live-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          title: prompt.slice(0, 26), workspace: state.workspace === '全部工作区' ? 'SYNC-THINK' : state.workspace,
          kind, scenario: 'live', model: currentModel(), agent: kind === 'agent' ? wb.newExecutor || '全能助手' : undefined};
        wbConversations.push(c);
        wb.right = ''; wb.bottom = ''; wb.terminalLines = [];
        wbOpen(c.id);
      } else if (c.scenario !== 'live') {
        c.scenario = 'live';
        c.title = c.title.replace(/^样例 · /, '');
        wb.session[c.id] = {step: 0, mode: 'running', extras: [], draft: '', live: {turns: []}};
        wb.right = ''; wb.bottom = ''; wb.terminalLines = [];
      }
      await startTurn(c, prompt);
    }
    const oldMessages = api.getMessages();
    const oldBar = api.getBar();
    const oldTerminal = api.getTerminal();
    const oldPanel = api.getPanel();
    function clock(iso) { return iso ? new Date(iso).toLocaleTimeString('zh-CN', {hour12: false}) : ''; }
    function elapsed(event) { return event.durationMs == null ? '运行中' : event.durationMs < 1000 ? event.durationMs + ' ms' : (event.durationMs / 1000).toFixed(1) + ' s'; }
    function toolCard(event) {
      const opened = local.opened.has(event.id) || event.status === 'running';
      const result = event.status === 'running' ? '<span class="live-pulse">运行中</span>' :
        `<span class="live-exit ${event.exitCode === 0 ? 'ok' : event.exitCode === 1 ? 'neutral' : 'error'}">退出码 ${event.exitCode}</span>`;
      return `<details class="live-tool" data-event="${esc(event.id)}" ${opened ? 'open' : ''}>
        <summary><span class="live-tool-icon">${icon(event.name === 'terminal.exec' ? 'terminal' : event.name === 'workspace.search' ? 'search' : event.name === 'file.patch' ? 'file-pen' : 'file-text')}</span>
          <span class="live-tool-heading"><strong>${esc(event.name)}</strong><small>${esc(event.command)}</small></span>
          ${result}<time>${elapsed(event)}</time>${icon('chevron-down')}</summary>
        <div class="live-tool-body"><div class="live-tool-meta"><span>调用 · ${clock(event.startedAt)}</span><button data-live="copy" data-text="${esc(event.command)}">复制命令</button></div>
          <pre class="live-command">${esc(event.command)}</pre><div class="live-tool-meta"><span>返回 · ${event.status === 'running' ? '等待输出' : '退出码 ' + event.exitCode}</span><button data-live="copy-output" data-event="${esc(event.id)}">复制输出</button></div>
          <pre class="live-output">${esc(event.output || (event.status === 'running' ? '等待进程输出…' : '（没有输出）'))}</pre>
          ${event.output?.includes('… 已截断') ? `<button class="live-full" data-live="full-output" data-event="${esc(event.id)}">查看完整输出 ${icon('arrow-up-right')}</button>` : ''}
        </div></details>`;
    }
    function liveMessages(c, s) {
      if (c.scenario !== 'live') return oldMessages(c, s);
      const turns = s.live?.turns || [];
      if (!turns.length) return '<div class="live-empty">输入任务后，本地执行事件会在这里逐条出现。</div>';
      return turns.map((turn, index) => {
        const r = turn.run;
        const events = r?.events || [];
        const body = events.map(toolCard).join('');
        const approval = r?.status === 'waiting_approval' ? `<div class="live-approval"><div class="live-approval-icon">${icon('shield-check')}</div><div><strong>${esc(r.approval?.title || '等待审批')}</strong><p>${esc(r.approval?.description)}</p><code>${esc(r.approval?.path)}</code><div class="live-approval-actions"><button data-live="approve" data-run="${r.id}" data-value="true">允许本次写入</button><button data-live="approve" data-run="${r.id}" data-value="false">跳过写入</button></div></div></div>` : '';
        const answer = r?.answer ? `<div class="live-answer"><p>${esc(r.answer)}</p>${r.sources?.length ? `<div class="live-sources"><span>来源</span>${r.sources.map((source, i) => `<button data-live="source" data-path="${esc(source)}">${i + 1} · ${esc(source)}</button>`).join('')}</div>` : ''}</div>` : '';
        const status = r?.status || (turn.error ? 'failed' : 'queued');
        return `<div class="wb-message user">${esc(turn.prompt)}</div><div class="wb-message live-message">
          <div class="wb-author"><span class="live-author-icon">${icon('terminal')}</span><strong>本地执行</strong><small>目标模型 ${esc(r?.requestedModel || c.model)}${r?.executor === 'local-tools' ? ' · 未调用模型' : ''}</small></div>
          <div class="live-run-meta"><span class="live-status live-${status}">${esc(statusText[status])}</span><span>${clock(r?.createdAt || turn.createdAt)}</span><span>${events.length} 次工具调用</span><span>思考强度：${esc(r?.thinking || wb.thinking || '中')}</span></div>
          <div class="live-timeline">${body || '<p class="live-wait">正在准备本地工作区…</p>'}</div>${approval}${answer}
          ${turn.error ? `<p class="live-error">${esc(turn.error)}</p>` : ''}
          ${status === 'cancelled' ? '<p class="live-muted">执行已取消。</p>' : ''}
        </div>`;
      }).join('');
    }
    function liveBar(c, s) {
      if (c.scenario !== 'live') return oldBar(c, s).replace('完整流程', '样例回放 · 非实际执行');
      const turns = s.live?.turns || [];
      const last = turns.at(-1)?.run;
      const busy = last && !finalStates.has(last.status);
      return `<div class="live-runbar"><span class="live-connection" id="live-service-badge">${local.connected ? '本地执行服务已连接' : '连接中…'}</span><span class="live-runbar-hint">真实工具事件 · ${last ? esc(statusText[last.status]) : '等待输入'}</span><span class="be-grow"></span>${busy ? `<button data-live="cancel" data-run="${last.id}">${icon('square')}停止</button>` : ''}<button data-live="new">${icon('plus')}新对话</button></div>`;
    }
    function liveTerminal(c, s) {
      if (c.scenario !== 'live') return oldTerminal(c, s);
      return `<div class="live-terminal-help">在项目根目录执行有限的只读命令。推荐：<code>git status --short</code>、<code>rg --files</code>、<code>pwd</code></div><pre class="wb-terminal" aria-live="polite">${esc(wb.terminalLines.join('\n') || '等待命令…')}${wb.terminalRunning ? '\n运行中…' : ''}</pre><div class="wb-term-input"><span class="be-muted">❯</span><input id="wb-command" aria-label="终端命令" value="git status --short"><button data-live="terminal">运行</button></div>`;
    }
    function livePanel(tab, place, c, s) {
      if (c.scenario !== 'live') return oldPanel(tab, place, c, s);
      const labels = {files: ['files', '文件'], review: ['git-pull-request', '审阅'], terminal: ['terminal', '终端'], browser: ['globe', '浏览器'], document: ['file-text', '文档']};
      const run = s.live?.turns.at(-1)?.run;
      const sources = run?.sources || [];
      const body = tab === 'terminal' ? liveTerminal(c, s) : tab === 'files' ?
        `<div class="live-terminal-help">本次运行读取的工作区文件</div>${sources.length ? sources.map(path => `<button class="wb-file-row" data-live="source" data-path="${esc(path)}">${icon('file-text')}<span>${esc(path)}</span></button>`).join('') : '<p class="live-muted">运行完成后显示文件来源。</p>'}` :
        tab === 'review' ? '<div class="live-terminal-help">当前执行只读。写入审批仅会生成 Demo 报告，不会修改 Sync-Think 源码，因此没有源码差异。</div>' :
        tab === 'browser' ? '<div class="live-terminal-help">本地执行服务未连接浏览器自动化。浏览器任务仍可在左侧样例页面查看界面交互。</div>' :
        `<div class="live-terminal-help">${esc(run?.answer || '运行完成后显示执行记录。')}</div>`;
      return `<aside class="wb-panel ${place === 'bottom' ? 'bottom' : ''}" aria-label="${place === 'bottom' ? '底部' : '右侧'}工作台">${place === 'bottom' ? '<div class="wb-bottom-resize" aria-hidden="true"></div>' : ''}<div class="wb-panel-tabs">${Object.entries(labels).map(([key, [glyph, label]]) => `<button class="wb-panel-tab ${tab === key ? 'active' : ''}" data-wb="panel" data-panel="${key}" data-place="${place}" aria-pressed="${tab === key}">${icon(glyph)}${label}</button>`).join('')}<div class="wb-panel-actions"><button data-wb="move-panel" data-place="${place}" aria-label="移动面板">${icon(place === 'bottom' ? 'panel-right' : 'panel-bottom')}</button><button data-wb="close-panel" data-place="${place}" aria-label="关闭面板">${icon('x')}</button></div></div><div class="wb-panel-body">${body}</div></aside>`;
    }
    api.setHooks({send, messages: liveMessages, bar: liveBar, terminal: liveTerminal, panel: livePanel});
    const oldNew = api.getNew();
    api.setNew(function () {
      oldNew();
      const target = root.querySelector('#be-content .be-page, #be-content .wb-new, #be-content > div');
      const note = root.querySelector('.be-chat-note'); if (note) note.textContent = '本地运行 · 工具输入和输出由实际命令生成；旧对话已标记为样例';
      if (target && !root.querySelector('.live-intro')) target.insertAdjacentHTML('afterbegin', `<div class="live-intro"><span class="live-intro-dot"></span><div><strong>在本地真实运行一个任务</strong><p>输入“检查执行过程输出”，将调用工作区搜索、文件读取和终端命令；包含“创建 / 修改 / 修复”的任务会出现写入审批。模型选择是目标配置，未连接模型时由本地工具执行。</p></div><span id="live-service-badge">${local.connected ? '本地执行服务已连接' : '连接中…'}</span></div>`);
    });
    root.addEventListener('toggle', event => {
      const details = event.target.closest?.('.live-tool');
      if (details) { details.open ? local.opened.add(details.dataset.event) : local.opened.delete(details.dataset.event); }
    }, true);
    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-live]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const action = button.dataset.live;
      const c = wbCurrent();
      const turn = wbSession(c)?.live?.turns.at(-1);
      try {
        if (action === 'new') { state.page = 'new'; render(); return; }
        if (action === 'cancel') await request('/api/runs/' + button.dataset.run + '/cancel', {});
        if (action === 'approve') await request('/api/runs/' + button.dataset.run + '/decision', {approved: button.dataset.value === 'true'});
        if (action === 'terminal') await terminalRun();
        if (action === 'copy') { await navigator.clipboard.writeText(button.dataset.text); toast('已复制命令'); }
        if (action === 'copy-output') { const text = button.closest('.live-tool')?.querySelector('.live-output')?.textContent || ''; await navigator.clipboard.writeText(text); toast('已复制输出'); }
        if (action === 'source') {
          const path = button.dataset.path;
          const matching = turn?.run?.events.find(e => e.command.includes(path));
          api.openModal(`<div class="be-modal-head"><div><h2>来源 · ${esc(path)}</h2><p>本次执行读取的工作区内容</p></div><button data-action="close" aria-label="关闭">${icon('x')}</button></div><div class="be-modal-body"><pre class="live-modal-output">${esc(matching?.output || '该路径来自搜索结果。可展开 workspace.search 查看命中行。')}</pre></div>`);
        }
        if (action === 'full-output') {
          const run = wbSession(c)?.live?.turns.find(t => t.run?.events.some(e => e.id === button.dataset.event))?.run;
          const full = await request('/api/runs/' + run.id + '/events/' + button.dataset.event + '/output');
          api.openModal(`<div class="be-modal-head"><div><h2>完整输出</h2><p>${esc(full.name)} · ${esc(full.command)}</p></div><button data-action="close" aria-label="关闭">${icon('x')}</button></div><div class="be-modal-body"><pre class="live-modal-output">${esc(full.output)}</pre></div>`);
        }
        if (['approve', 'cancel'].includes(action) && turn?.runId) {
          turn.run = await request('/api/runs/' + turn.runId);
          paint(); save();
        }
      } catch (error) { toast(error.message); }
    }, true);
    async function terminalRun() {
      const input = root.querySelector('#wb-command');
      const command = input?.value.trim();
      if (!command || wb.terminalRunning) return;
      wb.terminalLines.push('$ ' + command);
      wb.terminalRunning = true;
      paint();
      try {
        const result = await request('/api/terminal', {command});
        wb.terminalLines.push(result.output || '（没有输出）', '退出码 ' + result.exitCode + ' · ' + result.durationMs + ' ms', '');
      } catch (error) { wb.terminalLines.push('错误：' + error.message, ''); }
      wb.terminalRunning = false;
      paint();
    }
    api.setTerminalRun(terminalRun);
    state.page = 'new';
    render();
    updateStatus();
  };
})();
