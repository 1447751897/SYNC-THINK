export const PUBLIC_RUN_FIELDS = [
  'runId',
  'threadId',
  'kernelId',
  'modelId',
  'providerModelId',
  'providerId',
  'agentVersionId',
  'globalAgentId',
  'globalAgentName',
  'teamId',
  'teamName',
  'resolutionSource',
  'credentialRefId',
  'contextWindow',
  'modelContextWindow',
  'contextWindowOverride',
  'effectiveContextWindow',
  'contextWindowSource',
  'kernelContextWindowLimit',
  'kernelSessionPlan',
  'retryCount',
];

export function publicEventPayload(input: Record<string, unknown>): Record<string, unknown> {
  const { run, ...payload } = input;
  delete payload.runStateDelta;
  if (run && typeof run === 'object' && !Array.isArray(run)) {
    const fields = run as Record<string, unknown>;
    payload.run = Object.fromEntries(
      PUBLIC_RUN_FIELDS.flatMap((field) =>
        fields[field] === undefined ? [] : [[field, fields[field]]],
      ),
    );
  }
  return payload;
}
