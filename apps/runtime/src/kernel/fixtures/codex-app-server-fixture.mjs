import readline from 'node:readline';

let turnCount = 0;
let threadId = 'thread-app-fixture';
let threadPolicy;

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (
    ['thread/start', 'thread/resume', 'turn/start'].includes(request.method) &&
    request.params?.model === 'codex-default'
  ) {
    write({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32602, message: 'codex-default is a host sentinel, not a provider model' },
    });
    return;
  }
  if (request.method === 'initialize') {
    write({ jsonrpc: '2.0', id: request.id, result: {} });
    return;
  }
  if (request.method === 'thread/start') {
    threadPolicy = request.params;
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: { thread: { id: threadId }, model: 'gpt-5', modelProvider: 'fixture' },
    });
    return;
  }
  if (request.method === 'thread/resume') {
    threadId = request.params.threadId;
    threadPolicy = request.params;
    write({
      jsonrpc: '2.0',
      id: request.id,
      result: { thread: { id: threadId }, model: 'gpt-5', modelProvider: 'fixture' },
    });
    return;
  }
  if (request.method === 'turn/start') {
    turnCount += 1;
    const turnId = `turn-${turnCount}`;
    write({ jsonrpc: '2.0', id: request.id, result: { turn: { id: turnId } } });
    write({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
    if (turnCount === 1) {
      write({
        method: 'error',
        params: {
          threadId,
          turnId,
          willRetry: true,
          error: { message: 'Reconnecting... 1/5', additionalDetails: null },
        },
      });
    }
    // Reasoning items that were never streamed arrive only via item/completed,
    // and app-server has shipped three different shapes for the same payload.
    if (request.params?.input?.some?.((item) => item?.text === 'reasoning fixture')) {
      write({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: { id: 'r-1', type: 'reasoning', text: '完整正文', summary: ['短摘要'] },
        },
      });
      write({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: { id: 'r-2', type: 'reasoning', summary: ['只有摘要'] },
        },
      });
      write({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: {
            id: 'r-3',
            type: 'reasoning',
            content: [{ type: 'reasoning_text', text: '内容部件正文' }],
          },
        },
      });
    }
    // Streamed reasoning from current app-server builds can advance
    // summaryIndex without a summaryPartAdded notification.
    if (request.params?.input?.some?.((item) => item?.text === 'streamed reasoning fixture')) {
      const delta = (itemId, summaryIndex, text) => ({
        method: 'item/reasoning/summaryTextDelta',
        params: { threadId, turnId, itemId, summaryIndex, delta: text },
      });
      write(delta('s-1', 0, '**分析**'));
      write(delta('s-1', 0, '正文A'));
      write(delta('s-1', 1, '**验证**'));
      write(delta('s-2', 0, '**新思考**'));
    }
    const sawInlineImage = request.params?.input?.some?.(
      (item) => item?.type === 'image' && item?.url === 'data:image/png;base64,QUJDRA==',
    );
    const sawLocalImage = request.params?.input?.some?.(
      (item) => item?.type === 'localImage' && typeof item?.path === 'string',
    );
    const permissionFixture = request.params?.input?.some?.(
      (item) => item?.text === 'permission fixture',
    );
    const progressFixture = request.params?.input?.some?.(
      (item) => item?.text === 'progress fixture',
    );
    const effortFixture = request.params?.input?.some?.((item) => item?.text === 'effort fixture');
    const collaborationFixture = request.params?.input?.some?.(
      (item) => item?.text === 'collaboration fixture',
    );
    const nativePlanFixture = request.params?.input?.some?.(
      (item) => item?.text === 'native plan fixture',
    );
    const compactionFixture = request.params?.input?.some?.(
      (item) => item?.text === 'compaction lifecycle fixture',
    );
    const compactionFailureFixture = request.params?.input?.some?.(
      (item) => item?.text === 'compaction failure fixture',
    );
    const planFixture = request.params?.input?.some?.((item) => item?.text === 'plan fixture');
    if (planFixture) {
      write({
        method: 'turn/plan/updated',
        params: {
          threadId,
          turnId,
          explanation: 'Three-step fixture plan',
          plan: [
            { step: '读取 package.json', status: 'completed' },
            { step: '运行 typecheck', status: 'inProgress' },
            { step: '汇总结果', status: 'pending' },
          ],
        },
      });
    }
    if (nativePlanFixture) {
      write({
        method: 'item/started',
        params: { threadId, turnId, item: { id: 'native-plan', type: 'plan' } },
      });
      write({
        method: 'item/plan/delta',
        params: { threadId, turnId, itemId: 'native-plan', delta: '非规范增量' },
      });
      write({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: { id: 'native-plan', type: 'plan', text: '# 原生方案\n\n1. 读取\n2. 验证' },
        },
      });
    }
    if (compactionFixture) {
      write({
        method: 'item/started',
        params: { threadId, turnId, item: { id: 'compact-1', type: 'contextCompaction' } },
      });
      write({
        method: 'item/completed',
        params: { threadId, turnId, item: { id: 'compact-1', type: 'contextCompaction' } },
      });
      write({ method: 'thread/compacted', params: { threadId, turnId } });
    }
    if (compactionFailureFixture) {
      write({
        method: 'item/started',
        params: { threadId, turnId, item: { id: 'compact-fail', type: 'contextCompaction' } },
      });
      write({
        method: 'error',
        params: {
          threadId,
          turnId,
          willRetry: false,
          error: { message: 'context compaction failed' },
        },
      });
      return;
    }
    if (progressFixture) {
      write({
        method: 'item/started',
        params: {
          threadId,
          turnId,
          item: { id: 'cmd-progress', type: 'commandExecution', command: 'echo progress' },
        },
      });
      write({
        method: 'item/commandExecution/outputDelta',
        params: { threadId, turnId, itemId: 'cmd-progress', delta: 'progress line 1\n' },
      });
      write({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: {
            id: 'cmd-progress',
            type: 'commandExecution',
            command: 'echo progress',
            aggregatedOutput: 'progress line 1\n',
            exitCode: 0,
          },
        },
      });
    }
    write({
      method: 'item/agentMessage/delta',
      params: {
        threadId,
        turnId,
        itemId: `item-${turnCount}`,
        delta: permissionFixture
          ? JSON.stringify({
              threadApprovalPolicy: threadPolicy?.approvalPolicy,
              threadSandboxPolicy: threadPolicy?.sandboxPolicy,
              turnApprovalPolicy: request.params?.approvalPolicy,
              turnSandboxPolicy: request.params?.sandboxPolicy,
            })
          : collaborationFixture
            ? JSON.stringify(request.params?.collaborationMode)
            : effortFixture
              ? JSON.stringify({
                  hasEffort: Object.prototype.hasOwnProperty.call(request.params, 'effort'),
                  effort: request.params?.effort,
                })
              : sawLocalImage
                ? 'local image forwarded'
                : sawInlineImage
                  ? 'inline image forwarded'
                  : `answer ${turnCount}`,
      },
    });
    if (request.params?.input?.some?.((item) => item?.text === 'hang fixture')) return;
    write({
      method: 'turn/completed',
      params: {
        threadId,
        turn: { id: turnId, status: 'completed', items: [] },
      },
    });
  }
});
