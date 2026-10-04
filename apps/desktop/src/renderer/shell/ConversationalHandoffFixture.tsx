import { useState } from 'react';
import { COLLABORATION_EXECUTION_VERSION, DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot, type GlobalAgent, type Conversation } from '@sync-think/shared';
import { CollaborationChatView } from './CollaborationChatView.js';
import { DialogProvider } from './Dialog.js';
import { botAvatarSeed } from './bot-avatar.js';
import './agent-workspace.css';

const id='conversational-handoff-fixture', date='2026-10-03T08:00:00Z';
const roles=[['leader','主策划','violet'],['writer','正文编写','cyan'],['reviewer','内容审核','blue'],['polisher','文章润色','orange'],['world','世界观设定','orange']] as const;
const conversation={id,track:'team',targetRef:'fixture',title:'小说小队 · @协作',executionMode:'read-only',interactionMode:'execute',createdAt:date,updatedAt:date} as Conversation;
const agents=roles.map(([agentId,name])=>({id:agentId,name,description:'',enabled:true,archived:false})) as GlobalAgent[];
function snapshot(phase:number,strict:boolean,revision:number):CollaborationSnapshot {
  const path = strict?['writer','reviewer','leader','polisher','reviewer','leader']:['writer','reviewer','polisher','reviewer','leader'];
  const available=Math.min(phase+1,path.length), done=phase>=path.length;
  const tasks:CollaborationSnapshot['tasks']=[],attempts:CollaborationSnapshot['attempts']=[],messages:CollaborationSnapshot['messages']=[{id:'human',conversationId:id,senderMemberId:'user',recipientMemberIds:['leader'],mentions:[],kind:'chat',blocks:[{type:'text',text:'请基于已有世界观完成正文，按小队描述自行协作，审核通过后交付。'}],expectsResponse:true,correlationId:'goal',hopCount:0,sequence:1,createdAt:date}];
  const initial={id:'assignment',conversationId:id,senderMemberId:'leader',recipientMemberIds:['writer'],mentions:[{memberId:'writer',label:'正文编写'}],kind:'task_assignment' as const,blocks:[{type:'text' as const,text:'请完成初稿。'}],taskId:'task-0',attemptId:'attempt-0',expectsResponse:true,correlationId:'goal',hopCount:0,sequence:2,createdAt:date};messages.push(initial);
  let latestArtifact='';
  for(let n=0;n<available;n++) {
    const actor=path[n], taskId='task-'+n,attemptId='attempt-'+n,isDone=done || n<phase;
    const work=actor==='writer'||actor==='polisher';
    const title=actor==='writer'?'《示例小说》正文初稿':actor==='polisher'?'《示例小说》正文润色版':actor==='reviewer'?'审核当前正文版本':'核对成果并决定下一步';
    const sourceArtifact=latestArtifact;
    if(work&&isDone) latestArtifact='artifact-'+n;
    const target=path[n+1]??'user';
    const nextKind=target==='reviewer'?'review':target==='polisher'?'work':'report';
    const text=actor==='writer'?'初稿已交付，请审核当前版本。':actor==='polisher'?'表达已润色，未改动情节，请复审新版。':actor==='reviewer'&&target==='polisher'?'内容成立，只需调整表达。请润色后 @我复审。':actor==='reviewer'&&strict&&target==='leader'&&n===1?'初审认为需要表达润色，按小队描述先请主策划决定。':actor==='reviewer'?'正文新版审核通过，请核对目标并交付。':target==='polisher'?'同意做表达润色，请完成后交内容审核复审。':'目标与审核均已核对，交付此版正文。';
    tasks.push({id:taskId,rootTaskId:'task-0',parentTaskId:n?'task-'+(n-1):undefined,originMessageId:n?'result-'+(n-1):'assignment',assigneeMemberId:actor,coordinatorMemberId:'leader',goalRevision:1,purpose:work?'work':'coordination',workStatus:isDone?'done':'in_progress',title,instructions:title,expectedOutput:'',dependsOnTaskIds:[],contextRefs:sourceArtifact?[sourceArtifact]:[],resourceClaims:[],returnTo:{conversationId:id,replyToMessageId:'human'},timeoutSeconds:7200,currentAttemptId:attemptId,kind:'task',createdAt:date,...(work?{deliverable:{kind:'document' as const,title}}:{}),...(n?{handoff:{kind:actor==='reviewer'?'review' as const:work?'work' as const:'report' as const,sourceTaskId:'task-'+(n-1),sourceAttemptId:'attempt-'+(n-1),artifactIds:sourceArtifact?[sourceArtifact]:[]}}:{})});
    attempts.push({id:attemptId,taskId,number:1,status:isDone?'succeeded':'running',startedAt:date,updatedAt:date,contextSequence:messages.length,output:isDone?text:'',resourceClaims:[],tools:[],checklist:[],...(work&&isDone?{artifacts:[{id:latestArtifact,taskId,attemptId,kind:'document' as const,title,content:'# '+title+'\n\n已提交的正文版本。',sha256:'fixture',bytes:80,createdAt:date}]}:{}),...(isDone&&n<path.length-1?{workHandoff:{kind:nextKind,recipientMemberId:target,text,artifactIds:latestArtifact?[latestArtifact]:[],...(nextKind==='work'?{title:'正文润色',deliverable:{kind:'document' as const,title:'正文润色'}}:{})}}:{})});
    if(isDone) messages.push({id:'result-'+n,conversationId:id,senderMemberId:actor,recipientMemberIds:[target],mentions:[{memberId:target,label:roles.find(r=>r[0]===target)?.[1]??'你'}],kind:'task_result',blocks:[{type:'text',text}],taskId,attemptId,expectsResponse:false,correlationId:'goal',hopCount:0,sequence:messages.length+1,createdAt:date});
  }
  return {conversation:{id,workspaceId:'fixture',kind:'group',title:'小说小队 · @协作',coordinatorMemberId:'leader',createdAt:date,policy:{...DEFAULT_COLLABORATION_CHAT_POLICY},room:{version:1,state:done?'review':'running',goal:'基于已有世界观交付一篇审核通过的正文。',goalRevision:1,sourceSequence:1,checkpoint:{version:revision,savedAt:date,pendingTaskIds:tasks.filter((_,n)=>attempts[n].status==='running').map(t=>t.id),completedTaskIds:tasks.filter((_,n)=>attempts[n].status==='succeeded').map(t=>t.id),artifactIds:attempts.flatMap(a=>a.artifacts?.map(x=>x.id)??[]),note:''}}},members:[{id:'user',kind:'user',name:'你',avatar:'',role:'用户',active:true},...roles.map(([memberId,name,color])=>({id:memberId,agentId:memberId,kind:'agent' as const,name,avatar:botAvatarSeed('drop',color),role:name,active:true}))],messages,tasks,attempts,deliveries:[],revision,receipts:{}};
}
function store() {
  let current=snapshot(0,false,1);const listeners=new Set<(event:{type:string;payload:{conversationId:string}})=>void>();
  return {runtime:{onEvent:(listener:(event:{type:string;payload:{conversationId:string}})=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},collaboration:async()=>({snapshot:current,executionVersion:COLLABORATION_EXECUTION_VERSION}),listWaitingBrowserHandoffs:async()=>({handoffs:[]}),listPendingToolApprovals:async()=>({approvals:[]})},advance(phase:number,strict:boolean){current=snapshot(phase,strict,current.revision+1);for(const listener of listeners)listener({type:'collaboration.updated',payload:{conversationId:id}});}};
}
export default function ConversationalHandoffFixture() {
  const [state]=useState(()=>{const s=store();Object.defineProperty(window,'syncThink',{configurable:true,value:{runtime:s.runtime}});return s;});const [phase,setPhase]=useState(0),[strict,setStrict]=useState(false);
  const labels=strict?['正文编写中','初稿送审','先回主策划','主策划派润色','润色后复审','审核通过回报','最终交付']:['正文编写中','初稿送审','审核直接派润色','润色后复审','审核通过回报','最终交付'];
  const query=new URLSearchParams(location.search);
  if(query.get('viewport')==='mobile'){query.delete('viewport');return <main style={{padding:12,background:'var(--surface-base)',minHeight:'100vh'}}><iframe title="@协作窄屏验收" src={'/?'+query.toString()} style={{display:'block',width:390,height:844,border:0,margin:'0 auto'}}/></main>;}
  return <DialogProvider><main className="agent-chat-workspace" style={{height:'100vh',display:'flex',flexDirection:'column',gap:10,padding:12}}><nav aria-label="@协作验收" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,padding:10,borderBottom:'1px solid var(--border-subtle)'}}><button style={{border:"1px solid var(--border-subtle)",borderRadius:999,padding:"5px 10px"}} aria-pressed={strict} onClick={()=>{setStrict(!strict);setPhase(0);state.advance(0,!strict);}}>小队描述：{strict?'先回主策划':'自主接力'}</button>{labels.map((label,n)=><button key={label} style={{border:"1px solid var(--border-subtle)",borderRadius:999,padding:"5px 10px"}} aria-pressed={phase===n} onClick={()=>{setPhase(n);state.advance(n,strict);}}>{label}</button>)}<small>离线真实聊天组件 · 不调用外部模型</small></nav><p style={{margin:'0 12px',fontSize:13,color:'var(--text-secondary)'}}>{strict?'小队描述：所有修改须先回主策划决定。':'小队描述：审核可直接交给润色，润色后回审核。'} 世界观已具备，本轮无需重新派工。</p><div style={{flex:1,minHeight:0,display:'flex'}}><CollaborationChatView conversation={conversation} agents={agents} onOpenConversation={()=>{}} workspace/></div></main></DialogProvider>;
}
