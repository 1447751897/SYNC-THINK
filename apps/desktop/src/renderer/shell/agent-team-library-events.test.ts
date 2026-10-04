import { expect, it } from 'vitest';
import { isAgentTeamLibraryEvent } from './agent-team-library-events.js';
it.each(['globalAgent.created', 'globalAgent.updated', 'globalAgent.deleted', 'globalAgent.activationChanged', 'team.created', 'team.updated', 'team.deleted'])('refreshes catalog after %s', type => expect(isAgentTeamLibraryEvent(type)).toBe(true));
it.each(['team.run.started', 'tool.completed', 'message.created', 'globalAgent.created.fake', 'runtime.healthcheck'])('ignores unrelated progress: %s', type => expect(isAgentTeamLibraryEvent(type)).toBe(false));
