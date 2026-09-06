import type { KernelEvent } from '@sync-think/shared';

export interface CodexVerificationEvidence {
  first: readonly KernelEvent[];
  second: readonly KernelEvent[];
  third: readonly KernelEvent[];
  memoryToken: string;
  spawnPids: readonly number[];
  sameProcessSpawnCount: number;
  toolFlow: boolean | undefined;
  requireReasoning?: boolean;
}

type VerificationStatus = 'pass' | 'fail' | 'not-required' | 'not-requested';

function sessionId(events: readonly KernelEvent[]): string | undefined {
  return events.find(
    (event): event is Extract<KernelEvent, { type: 'session-started' }> =>
      event.type === 'session-started',
  )?.sessionId;
}

function completed(events: readonly KernelEvent[]): boolean {
  const terminal = events.at(-1);
  return terminal?.type === 'terminal' && terminal.status === 'completed';
}

function containsMemory(events: readonly KernelEvent[], memoryToken: string): boolean {
  return (
    Boolean(memoryToken) &&
    events
      .filter((event): event is Extract<KernelEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('')
      .includes(memoryToken)
  );
}

export function evaluateCodexVerification(evidence: CodexVerificationEvidence) {
  const initialSession = sessionId(evidence.first);
  const reasoningObserved = evidence.first.some(
    (event) => event.type === 'reasoning' && event.text.trim().length > 0,
  );
  const status = (passed: boolean): VerificationStatus => (passed ? 'pass' : 'fail');
  const checks: Record<string, VerificationStatus> = {
    initialSession: status(Boolean(initialSession)),
    firstCompleted: status(completed(evidence.first)),
    firstUsage: status(
      evidence.first.some(
        (event) =>
          event.type === 'usage' && Number.isFinite(event.usage.real) && event.usage.real > 0,
      ),
    ),
    tools: evidence.toolFlow === undefined ? 'not-requested' : status(evidence.toolFlow),
    reasoning: evidence.requireReasoning ? status(reasoningObserved) : 'not-required',
    secondCompleted: status(completed(evidence.second)),
    thirdCompleted: status(completed(evidence.third)),
    sameProcessSession: status(
      Boolean(initialSession) && sessionId(evidence.second) === initialSession,
    ),
    sameProcessMemory: status(containsMemory(evidence.second, evidence.memoryToken)),
    sameProcessReuse: status(evidence.sameProcessSpawnCount === 1),
    reopenedSession: status(
      Boolean(initialSession) && sessionId(evidence.third) === initialSession,
    ),
    reopenedMemory: status(containsMemory(evidence.third, evidence.memoryToken)),
    reopenedProcess: status(
      evidence.spawnPids.length === 2 &&
        new Set(evidence.spawnPids).size === 2 &&
        evidence.spawnPids.every((processId) => Number.isSafeInteger(processId) && processId > 0),
    ),
  };
  const failures = Object.entries(checks)
    .filter(([, value]) => value === 'fail')
    .map(([name]) => name);
  return { ok: failures.length === 0, checks, failures, reasoningObserved };
}
