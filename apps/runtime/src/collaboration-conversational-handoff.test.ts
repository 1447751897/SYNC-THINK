import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot, type CollaborationWorkHandoff, type TeamId } from '@sync-think/shared';
import { CollaborationChatService, type CollaborationExecutionInput, type CollaborationExecutionResult } from './collaboration-chat-service.js';
import { buildTaskRoomContext, createTaskRoom } from './task-room.js';

const time = '2026-10-03T00:00:00Z';
const services: CollaborationChatService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); });
const flush = async () => { for (let n=0;n<8;n++) await new Promise<void>(resolve => setImmediate(resolve)); };
function setup() {
  let current: CollaborationSnapshot = { conversation: { id:'c', workspaceId:'w', title:'小说小队', kind:'group', coordinatorMemberId:'leader', createdAt:time, policy:{...DEFAULT_COLLABORATION_CHAT_POLICY}, room:createTaskRoom(time) },
    members:[{id:'user',kind:'user',name:'用户',avatar:'',role:'',active:true}, ...['leader','world','writer','reviewer','polisher'].map(id => ({id,agentId:id,kind:'agent' as const,name:id,avatar:'',role:id,active:true}))], tasks:[],attempts:[],messages:[],deliveries:[],revision:0,receipts:{} };
  const repo = {read:()=>structuredClone(current), list:()=>[structuredClone(current)], save:(s:CollaborationSnapshot)=>{current=structuredClone(s);}, transaction:<T>(fn:()=>T)=>fn()};
  const active = new Map<string,{input:CollaborationExecutionInput, finish:(result:CollaborationExecutionResult)=>void}>();
  const make = () => { const s = new CollaborationChatService(repo,{ownerId:'owner',onChanged:()=>{},resourceClaims:()=>[],execute:input=>new Promise(resolve=>{active.set(input.task.assigneeMemberId,{input,finish:resolve});input.signal.addEventListener('abort',()=>resolve({output:''}),{once:true});})});services.push(s);return s; };
  const service=make();
  const start = async () => { service.dispatch({action:'dispatch',conversationId:'c',clientRequestId:'start',tasks:[{assigneeMemberId:'writer',title:'正文',instructions:'先写正文，再根据小队描述 @合适的人',deliverable:{kind:'document',title:'正文'}}]});await flush(); };
  const artifact = (actor:string) => { const {input}=active.get(actor)!; const art={id:'artifact-'+input.attempt.id,taskId:input.task.id,attemptId:input.attempt.id,kind:'document' as const,title:input.task.title,content:'实际成果 '+actor,sha256:'digest',bytes:20,createdAt:time}; input.onProgress({artifacts:[art]});return art; };
  const handoff = (actor:string,handoff:CollaborationWorkHandoff,key?:string) => { const {input}=active.get(actor)!;return service.handoff({action:'handoff',conversationId:'c',clientRequestId:key ?? 'handoff-'+input.attempt.id,handoff},actor,{taskId:input.task.id,attemptId:input.attempt.id}); };
  const finish = async (actor:string,error=false) => { const a=active.get(actor)!;active.delete(actor);const attempt=repo.read().attempts.find(x=>x.id===a.input.attempt.id)!;a.finish({output:error?'':'本轮完成',artifacts:attempt.artifacts,...(error?{error:{code:'provider.timeout',category:'timeout' as const,message:'实际超时',retryable:true,traceId:'trace'}}:{})});await flush(); };
  return {repo,service,make,active,start,artifact,handoff,finish};
}

describe('goal-bound conversational @handoffs',()=>{
  it('commits writer → review → polish → review → leader as real addressed conversation without a forced leader at every step',async()=>{
    const f=setup();await f.start();const art=f.artifact('writer');
    f.handoff('writer',{kind:'review',recipientMemberId:'reviewer',text:'正文已交付，请审核。'});
    expect(f.repo.read().tasks).toHaveLength(1);expect(f.active.has('reviewer')).toBe(false);
    await f.finish('writer');
    let s=f.repo.read();const result=s.messages.find(m=>m.kind==='task_result')!;
    expect(result.mentions).toEqual([{memberId:'reviewer',label:'reviewer'}]);expect(result.taskId).toBe(s.tasks[0].id);
    expect(f.active.get('reviewer')!.input.task.handoff?.artifactIds).toEqual([art.id]);
    f.handoff('reviewer',{kind:'work',recipientMemberId:'polisher',text:'内容成立，只修表达，完成后请送我复审。',title:'润色正文',deliverable:{kind:'document',title:'润色正文'}});
    await f.finish('reviewer');expect(f.active.has('polisher')).toBe(true);expect(f.active.has('leader')).toBe(false);
    const polished=f.artifact('polisher');f.handoff('polisher',{kind:'review',recipientMemberId:'reviewer',text:'润色版已完成，请复审。'});await f.finish('polisher');
    expect(f.active.get('reviewer')!.input.task.handoff?.artifactIds).toEqual([polished.id]);
    f.handoff('reviewer',{kind:'report',recipientMemberId:'leader',text:'正文新版审核通过，请核对目标并交付。'});await f.finish('reviewer');
    expect(f.active.has('leader')).toBe(true);await f.finish('leader');s=f.repo.read();
    expect(s.tasks.map(t=>t.assigneeMemberId)).toEqual(['writer','reviewer','polisher','reviewer','leader']);
    expect(s.conversation.room!.state).toBe('review');
    expect(s.messages.filter(m=>m.kind==='task_result').map(m=>m.recipientMemberIds[0])).toEqual(['reviewer','polisher','reviewer','leader','user']);
    expect(s.deliveries.every(d=>d.status==='processed')).toBe(true);
    expect(new Set(s.deliveries.map(d=>d.messageId+':'+d.recipientMemberId)).size).toBe(s.deliveries.length);
  });
  it('accepts a strict return-to-leader route instead of hardcoding reviewer/polisher order',async()=>{
    const f=setup();await f.start();f.artifact('writer');f.handoff('writer',{kind:'report',recipientMemberId:'leader',text:'按小队描述交主策划决定下一步。'});await f.finish('writer');
    f.handoff('leader',{kind:'review',recipientMemberId:'reviewer',text:'请审核此版正文。'});await f.finish('leader');
    expect(f.repo.read().tasks.map(t=>t.assigneeMemberId)).toEqual(['writer','leader','reviewer']);
  });
  it('does not publish a selected next step when its producer fails, and retry has no stale automatic handoff',async()=>{
    const f=setup();await f.start();f.artifact('writer');f.handoff('writer',{kind:'review',recipientMemberId:'reviewer',text:'成功后再审核。'});await f.finish('writer',true);
    expect(f.repo.read().tasks).toHaveLength(1);expect(f.active.has('reviewer')).toBe(false);
    const task=f.repo.read().tasks[0];f.service.retry({action:'retry',conversationId:'c',taskId:task.id,clientRequestId:'retry'});await flush();
    expect(f.repo.read().attempts.at(-1)?.workHandoff).toBeUndefined();
  });
  it('rejects missing deliveries, self/cross-room targets and invented artifacts without side effects',async()=>{
    const f=setup();await f.start();const before=f.repo.read();
    expect(()=>f.handoff('writer',{kind:'review',recipientMemberId:'reviewer',text:'还没交付'})).toThrow('deliver_before_handoff');expect(f.repo.read()).toEqual(before);
    f.artifact('writer');const submitted=f.repo.read();
    for(const recipient of ['writer','foreign','user']) expect(()=>f.handoff('writer',{kind:'review',recipientMemberId:recipient,text:'请审'})).toThrow();
    expect(()=>f.handoff('writer',{kind:'review',recipientMemberId:'reviewer',text:'请审',artifactIds:['fake']})).toThrow('handoff_artifact_not_delivered');expect(f.repo.read()).toEqual(submitted);
  });
  it('is idempotent and records one decision per active attempt',async()=>{
    const f=setup();await f.start();f.artifact('writer');const intent={kind:'review' as const,recipientMemberId:'reviewer',text:'请审核'};
    const first=f.handoff('writer',intent);expect(f.handoff('writer',intent)).toEqual(first);
    expect(()=>f.handoff('writer',{...intent,recipientMemberId:'leader'},'different')).toThrow('handoff_already_selected');await f.finish('writer');expect(f.repo.read().tasks).toHaveLength(2);
  });
  it('keeps ordinary discussion and consultation recipients from acquiring production authority',async()=>{
    const f=setup();f.service.send({action:'send',conversationId:'c',clientRequestId:'chat',intent:'discussion',recipientMemberIds:['writer'],text:'请聊一下'});await flush();
    expect(()=>f.handoff('writer',{kind:'work',recipientMemberId:'polisher',text:'派工',title:'润色',deliverable:{kind:'document',title:'润色'}})).toThrow('production_execution_required');
  });
  it('persists a selected handoff across shutdown but never dispatches it from an interrupted attempt',async()=>{
    const f=setup();await f.start();f.artifact('writer');f.handoff('writer',{kind:'review',recipientMemberId:'reviewer',text:'请审核'});await f.service.stop();await flush();
    expect(f.repo.read().attempts[0].workHandoff?.kind).toBe('review');expect(f.repo.read().attempts[0].status).toBe('interrupted');expect(f.repo.read().tasks).toHaveLength(1);
  });
  it.each(['所有成果必须先 @主策划，由主策划派给审核。','成员可根据目标自主 @审核和 @润色，无需每步回主策划。'])('injects the actual team boundary into each worker/decision context: %s',async mission=>{
    const f=setup();await f.start();const {input}=f.active.get('writer')!;const team={id:'team' as TeamId,name:'测试小队',avatar:'',mission,strategy:'serial' as const,members:[],createdAt:time,updatedAt:time};
    input.snapshot.members.push({id:'team',kind:'team',name:'测试小队',avatar:'',role:'',active:true,teamSnapshot:team});input.snapshot.members.find(m=>m.id==='writer')!.teamParticipantId='team';
    const context=buildTaskRoomContext(input.snapshot,input.task,input.attempt);
    expect(context).toContain(mission);expect(context).toContain('未作限制处允许');expect(context).not.toContain('不再次派工');expect(context).toContain('collaboration_handoff');
  });
});

it('returns failed polishing to its actual reviewer once, without inserting a global leader round',async()=>{
  const f=setup();await f.start();f.artifact('writer');f.handoff('writer',{kind:'review',recipientMemberId:'reviewer',text:'请审'});await f.finish('writer');
  f.handoff('reviewer',{kind:'work',recipientMemberId:'polisher',text:'仅修表达',title:'润色',deliverable:{kind:'document',title:'润色'}});await f.finish('reviewer');
  await f.finish('polisher',true);expect(f.active.has('reviewer')).toBe(true);expect(f.active.has('leader')).toBe(false);expect(f.repo.read().tasks).toHaveLength(4);
  await f.finish('reviewer');await f.service.pump('w');expect(f.repo.read().tasks).toHaveLength(4);expect(f.repo.read().conversation.room!.state).toBe('blocked');
  const deliveries=f.repo.read().deliveries;expect(new Set(deliveries.map(d=>d.messageId+':'+d.recipientMemberId)).size).toBe(deliveries.length);
});
