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
    // Streamed reasoning: summary sections stream via summaryTextDelta and a
    // summaryPartAdded announces each new section (including before the first).
    if (request.params?.input?.some?.((item) => item?.text === 'streamed reasoning fixture')) {
      const part = (itemId) => ({
        method: 'item/reasoning/summaryPartAdded',
        params: { threadId, turnId, itemId },
      });
      const delta = (itemId, text) => ({
        method: 'item/reasoning/summaryTextDelta',
        params: { threadId, turnId, itemId, delta: text },
      });
      write(part('s-1'));
      write(delta('s-1', '**分析**'));
      write(delta('s-1', '正文A'));
      write(part('s-1'));
      write(delta('s-1', '**验证**'));
      write(delta('s-2', '**新思考**'));
    }
    const sawImage = request.params?.input?.some?.(
      (item) => item?.type === 'image' && item?.url === 'data:image/png;base64,QUJDRA==',
    );
    const permissionFixture = request.params?.input?.some?.(
      (item) => item?.text === 'permission fixture',
    );
    const progressFixture = request.params?.input?.some?.(
      (item) => item?.text === 'progress fixture',
    );
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
          : sawImage
            ? 'image forwarded'
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
