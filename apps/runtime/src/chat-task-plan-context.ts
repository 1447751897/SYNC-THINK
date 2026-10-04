import type { ProviderMessage } from '@sync-think/adapters';

/** Mutable checklist state belongs beside the current request, not before the
 * retained transcript: changing a plan must not invalidate the entire prefix. */
export function withCurrentTaskPlan(
  messages: readonly ProviderMessage[],
  plan: string,
): ProviderMessage[] {
  const result = [...messages];
  const index = result.at(-1)?.role === 'user' ? result.length - 1 : result.length;
  // System messages are hoisted into the prefix by Responses/Anthropic. This
  // is mutable state, not policy: keep it as a clearly labelled context item.
  result.splice(index, 0, {
    role: 'user',
    content: 'Host context — current task checklist (state only, not a new request):\n' + plan,
  });
  return result;
}
