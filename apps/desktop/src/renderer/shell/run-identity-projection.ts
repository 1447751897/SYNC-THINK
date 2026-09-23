import type { Event } from '@sync-think/shared';

export interface RunAgentIdentity {
  id?: string;
  name?: string;
}

export interface RunIdentityProjection {
  agentIdentities: Map<string, RunAgentIdentity>;
  kernels: Map<string, string>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Project immutable Agent and Kernel bindings stamped on run.started events. */
export function projectRunIdentities(events: readonly Event[]): RunIdentityProjection {
  const agentIdentities = new Map<string, RunAgentIdentity>();
  const kernels = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'run.started') continue;
    const payloadRun =
      event.payload.run && typeof event.payload.run === 'object'
        ? (event.payload.run as Record<string, unknown>)
        : undefined;
    const runId =
      (event.runId ? String(event.runId) : undefined) ??
      nonEmptyString(event.payload.runId) ??
      nonEmptyString(payloadRun?.id);
    if (!runId) continue;

    const id =
      nonEmptyString(event.payload.globalAgentId) ?? nonEmptyString(payloadRun?.globalAgentId);
    const name =
      nonEmptyString(event.payload.globalAgentName) ?? nonEmptyString(payloadRun?.globalAgentName);
    if (id || name) agentIdentities.set(runId, { id, name });

    const kernelId = nonEmptyString(event.payload.kernelId) ?? nonEmptyString(payloadRun?.kernelId);
    if (kernelId) kernels.set(runId, kernelId);
  }
  return { agentIdentities, kernels };
}

export function projectRunAgentIdentities(
  events: readonly Event[],
): Map<string, RunAgentIdentity> {
  return projectRunIdentities(events).agentIdentities;
}

export function projectRunKernels(events: readonly Event[]): Map<string, string> {
  return projectRunIdentities(events).kernels;
}
