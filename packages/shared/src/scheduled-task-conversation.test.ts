import { describe, expect, it } from 'vitest';
import { parseScheduledTaskAutomation } from './types/scheduled-task.js';
describe('scheduled conversation destination',()=>{
  it.each([{mode:'task'},{mode:'new'},{mode:'existing',conversationId:'conversation-a'}])('preserves %j',conversation=>{
    expect(parseScheduledTaskAutomation({conversation})).toEqual({executionMode:'workspace',conversation});
  });
  it.each([{mode:'existing'},{mode:'existing',conversationId:''},{mode:'new',conversationId:'ignored'},{mode:'unknown'},{mode:'existing',conversationId:'a',extra:true}])('rejects invalid %j',conversation=>expect(parseScheduledTaskAutomation({conversation})).toBeUndefined());
});
