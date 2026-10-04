import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteMessageStore, SqliteTeamStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class HandoffProvider extends FakeProvider {
  rounds = new Map<string,number>();
  constructor(readonly strict:boolean) { super(); }
  override async *call(request:ProviderCallRequest):AsyncIterable<AdapterEvent> {
    if (request.systemPrompt?.includes('You are the routing controller of this group')) {
      expect(request.tools ?? []).toEqual([]);
      const coordinator = request.systemPrompt.match(/"coordinatorMemberId":"([^"]+)"/)?.[1];
      expect(coordinator).toBeTruthy();
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: JSON.stringify({ mode: 'single', memberIds: [coordinator] }) };
      yield { type: 'finished', reason: 'stop' }; return;
    }

    const prompt=request.systemPrompt ?? '';const task=prompt.match(/taskId=([^；\n]+)/)?.[1] ?? request.idempotencyKey;
    const current=prompt.match(/当前请求：([^\n]+)/)?.[1] ?? '';const round=this.rounds.get(task) ?? 0;this.rounds.set(task,round+1);
    const names=request.tools?.map(t=>t.name) ?? [];
    const result=String(request.messages.filter(m=>m.role==='tool').at(-1)?.content ?? '');
    let tool:{name:string;args:object}|undefined;
    const send=(kind:string,recipientMemberId:string,text:string,work=false)=>({name:'collaboration_handoff',args:{kind,recipientMemberId,text,...(work?{title:'修改正文',deliverable:{kind:'document',title:'修改正文'}}:{})}});
    if(current==='[闲聊]讨论写作') {
      expect(names).not.toContain('collaboration_handoff');
      if(!round) tool=send('work','agent:writer','伪造派工',true);else expect(result).not.toContain('"ok":true');
    } else {
      expect(prompt).toContain(this.strict?'所有修改须先回主策划决定。':'审核可直接交给润色，润色后回审核。');
      expect(names).toContain('collaboration_handoff');
      if(round) expect(result).toContain('"ok":true');
      if(current==='[开始]交付一篇审核通过的正文') {
        if(!round) tool=send('work','agent:writer','[写作]完成初稿',true);
      } else if(current==='[写作]完成初稿' || current==='[润色]只修表达后送审') {
        if(!round) tool={name:'collaboration_submit_artifact',args:{content:'# 正文\n'+(current.startsWith('[润色]')?'修改后的正文。':'待审核的初稿。')}};
        else if(round===1) tool=send('review','agent:reviewer',current.startsWith('[润色]')?'[复审]审核修改版':'[初审]检查初稿');
      } else if(current==='[初审]检查初稿' || current==='[复审]审核修改版') {
        const ref=prompt.match(/"artifactIds":\["([^"]+)"\]/)?.[1];expect(ref).toBeTruthy();
        if(!round) tool={name:'collaboration_read_context',args:{kind:'artifact',id:ref}};
        else if(round===1) tool=current.startsWith('[复审]')?send('report','agent:leader','[通过]此版审核通过，请核对目标并交付'):
          this.strict?send('report','agent:leader','[决定]仅需表达润色，请决定下一步'):send('work','agent:polisher','[润色]只修表达后送审',true);
      } else if(current==='[决定]仅需表达润色，请决定下一步') {
        if(!round) tool=send('work','agent:polisher','[润色]只修表达后送审',true);
      } else expect(current).toBe('[通过]此版审核通过，请核对目标并交付');
    }
    if(tool) {yield {type:'tool-call',toolCall:{id:task+'-'+round,name:tool.name,argumentsJson:JSON.stringify(tool.args)}};yield {type:'finished',reason:'tool-requests'};}
    else {yield {type:'text-delta',text:'已核对目标与审核通过的正文，交付给用户。'};yield {type:'finished',reason:'stop'};}
  }
}
it.each([false,true])('runs native @handoffs with SQLite and actual tool guards (strict team boundary=%s)',async strict=>{
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'collab-handoff-')));const db=join(directory,'test.db');await runMigrations(db);const connection=await openDatabaseAsync({path:db});
  const workspaces=new SqliteWorkspaceStore(connection.raw);const workspace=workspaces.createWorkspace({id:'w' as WorkspaceId,name:'交接测试',folderPath:directory});
  const agents=new SqliteGlobalAgentStore(connection.raw);for(const id of ['leader','writer','reviewer','polisher']) agents.create({id:id as AgentId,name:id,writePolicy:'read-only',defaultModelId:'fake-mini' as ModelId});
  const teams=new SqliteTeamStore(connection.raw),conversations=new SqliteConversationStore(connection.raw),repository=new SqliteCollaborationStore(connection.raw),provider=new HandoffProvider(strict);
  const host:CollaborationChatHost=new CollaborationChatHost(repository,{ownerId:'test',conversations,agents,teams,workspaces,execute:input=>runtime.executeCollaborationTaskForHost(input),onChanged:()=>{}});
  const runtime:Runtime=new Runtime({installId:'test',allowNoToken:true,workspaceStore:workspaces,conversationStore:conversations,globalAgentStore:agents,teamStore:teams,messageStore:new SqliteMessageStore(connection.raw),stateStore:new SqliteEventCheckpointStore(connection.raw),collaborationChatHost:host,demoProvider:provider});
  try {
    const team=teams.create({name:'小队',mission:strict?'所有修改须先回主策划决定。':'审核可直接交给润色，润色后回审核。',strategy:'serial',coordinatorAgentId:'leader' as AgentId,members:['leader','writer','reviewer','polisher'].map(agentId=>({agentId:agentId as AgentId,role:agentId}))});
    const created=host.command({action:'create',clientRequestId:'create',kind:'group',title:'交接',workspaceId:workspace.id,agentIds:[],teamId:team.id}).snapshot!;
    const id=created.conversation.id;
    const settle=async()=>{for(let n=0;n<500;n++){await host.service.pump(workspace.id);await new Promise(r=>setTimeout(r,10));const s=repository.read(id)!;if(s.tasks.every(t=>['succeeded','failed','cancelled'].includes(s.attempts.find(a=>a.id===t.currentAttemptId)!.status)))return s;}throw Error('handoff did not settle');};
    host.command({action:'send',conversationId:id,clientRequestId:'chat',intent:'discussion',text:'[闲聊]讨论写作'});let s=await settle();expect(s.tasks.filter(t => !t.conversationPlanning)).toHaveLength(1);expect(s.tasks[0].purpose).toBe('discussion');
    host.command({action:'start-workflow',conversationId:id,clientRequestId:'start',goal:'[开始]交付一篇审核通过的正文'});s=await settle();
    expect(s.attempts.every(a=>a.status==='succeeded'),JSON.stringify(s.attempts.map(a=>({error:a.error,tools:a.tools})))).toBe(true);
    const routed=s.tasks.filter(t=>t.handoff).map(t=>t.assigneeMemberId);
    expect(routed).toEqual(strict?['agent:writer','agent:reviewer','agent:leader','agent:polisher','agent:reviewer','agent:leader']:['agent:writer','agent:reviewer','agent:polisher','agent:reviewer','agent:leader']);
    expect(s.attempts.flatMap(a=>a.artifacts ?? [])).toHaveLength(2);expect(s.conversation.room!.state).toBe('review');
    const user=s.members.find(m=>m.kind==='user')!;
    expect(s.messages.some(m=>m.kind==='task_result' && m.senderMemberId==='agent:leader' && m.recipientMemberIds.includes(user.id) && m.blocks.some(b=>b.type==='text' && b.text==='已核对目标与审核通过的正文，交付给用户。'))).toBe(true);
    const reviews=s.tasks.filter(t=>t.handoff?.kind==='review');expect(reviews).toHaveLength(2);
    expect(reviews[0].handoff!.artifactIds).not.toEqual(reviews[1].handoff!.artifactIds);
    for(const review of reviews) expect(s.attempts.some(a=>a.status==='succeeded' && a.artifacts?.some(x=>review.handoff!.artifactIds.includes(x.id)))).toBe(true);
    expect(s.tasks.some(t=>t.consultation)).toBe(false);expect(s.messages.filter(m=>m.kind==='task_result' && m.mentions.length).length).toBeGreaterThanOrEqual(5);
    expect(repository.read(id)!.attempts.filter(a=>a.workHandoff).length).toBe(routed.length);
    const origin=s.tasks.find(t=>t.handoff)!.handoff!;expect(()=>host.command({action:'handoff',conversationId:id,clientRequestId:'stale',handoff:{kind:'report',recipientMemberId:'agent:leader',text:'旧执行伪造交接'}},'agent:writer',{taskId:origin.sourceTaskId,attemptId:origin.sourceAttemptId})).toThrow('production_execution_required');
  } finally {await host.service.stop();await runtime.stop();connection.raw.close();if(directory.startsWith(realpathSync(tmpdir())) && directory.includes('collab-handoff-')) rmSync(directory,{recursive:true,force:true});}
},20000);
