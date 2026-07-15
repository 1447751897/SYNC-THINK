const CATALOG = [
  { id: 'codex', label: 'Codex', providers: [
    { id: 'p-kmk-codex', name: 'KMKAPI-CODEX', models: ['gpt-5.4-mini','gpt-5.3-codex','o3-mini','gpt-4.1'] },
    { id: 'p-official', name: 'Official', models: ['gpt-5.2-codex','o4-mini'] },
  ]},
  { id: 'claude', label: 'Claude Code', providers: [
    { id: 'p-unity', name: 'Unity2.Ai', models: ['claude-sonnet-4','claude-opus-4','claude-haiku-4'] },
    { id: 'p-kmk-claude', name: 'KMKAPI-CLAUDE', models: ['claude-sonnet-4-5'] },
  ]},
  { id: 'kiro', label: 'Kiro', providers: [
    { id: 'p-kiro', name: 'Kiro-Proxy', models: ['kiro-auto'] },
  ]},
  { id: 'other', label: '其他', providers: [
    { id: 'p-glm', name: 'GLM-Chat', models: ['glm-4-flash','glm-4-plus'] },
    { id: 'p-ds', name: 'DeepSeek', models: ['deepseek-chat','deepseek-reasoner'] },
  ]},
];
function mid(g,p,m){return g+'/'+p+'/'+m}
function parseMid(id){const [groupId,providerId,modelName]=String(id||'').split('/');return {groupId,providerId,modelName}}
function pathLabel(runtimeId){
  const {groupId,providerId,modelName}=parseMid(runtimeId);
  const g=CATALOG.find(x=>x.id===groupId);
  const p=g&&g.providers.find(x=>x.id===providerId);
  if(!g||!p||!modelName) return '未配置';
  return g.label+' → '+p.name+' → '+modelName;
}
const AGENTS = [
  { id:'a1', name:'产品设计师', role:'规划与方案', version:3,
    work:'负责需求拆解、方案草案与跨模型协作时的计划输出。对话默认入口之一。',
    instructions:'你是产品设计师智能体。输出结构清晰的方案，标注假设与风险。不要直接改代码。',
    skills:[{name:'prd-outline',ver:'1.2'},{name:'user-story',ver:'0.9'},{name:'risk-checklist',ver:'1.0'}],
    tools:'MCP：browser（只读）、docs-search。无 shell。',
    tasks:[{id:'t1',title:'SYNC-THINK 模型选择体验',status:'进行中'},{id:'t2',title:'智能体中心信息架构',status:'草稿'}],
    runtime: mid('codex','p-kmk-codex','gpt-5.4-mini') },
  { id:'a2', name:'代码执行官', role:'实现与修补', version:5,
    work:'在任务中写补丁、跑测试、解释失败原因。通常绑定强 coding 模型。',
    instructions:'你是代码执行官。优先小步提交；说明改动范围；不碰密钥。',
    skills:[{name:'repo-map',ver:'2.0'},{name:'test-runner-notes',ver:'1.1'}],
    tools:'MCP：filesystem、git-status（示意）。审批后可用 shell。',
    tasks:[{id:'t3',title:'修复 Provider 导入后无法连接',status:'进行中'},{id:'t1',title:'SYNC-THINK 模型选择体验',status:'协作中'}],
    runtime: mid('claude','p-unity','claude-sonnet-4') },
  { id:'a3', name:'评审员', role:'验收与找茬', version:2,
    work:'对照验收标准审查产物，输出通过/驳回与证据。',
    instructions:'你是评审员。只基于标准与产物发言；驳回必须给可执行修改点。',
    skills:[{name:'acceptance-rubric',ver:'1.0'}],
    tools:'无外呼工具；只读任务产物。',
    tasks:[{id:'t4',title:'M1 软门禁回归',status:'排队'}],
    runtime: mid('other','p-ds','deepseek-reasoner') },
  { id:'a4', name:'默认助手', role:'通用对话', version:1,
    work:'未指定专业智能体时的兜底对话 Agent。',
    instructions:'你是默认助手。简洁回答；不确定时说明需要哪个专业智能体。',
    skills:[], tools:'未绑定 MCP。',
    tasks:[{id:'t5',title:'日常问答',status:'空闲'}],
    runtime: mid('other','p-glm','glm-4-flash') },
];
const drafts={}; AGENTS.forEach(a=>{drafts[a.id]={runtime:a.runtime,savedRuntime:a.runtime,instructions:a.instructions,savedInstructions:a.instructions}});
let selectedId=AGENTS[0].id, tab='overview', qAgent='', qRuntime='';
let nav={groupId:null,providerId:null};
const $=id=>document.getElementById(id);
const agent=()=>AGENTS.find(a=>a.id===selectedId);
const draft=()=>drafts[selectedId];
function isDirty(){const d=draft();return d.runtime!==d.savedRuntime||d.instructions!==d.savedInstructions}
function syncNavFromRuntime(runtimeId){const p=parseMid(runtimeId);nav.groupId=p.groupId||CATALOG[0].id;nav.providerId=p.providerId||(CATALOG.find(g=>g.id===nav.groupId)||CATALOG[0]).providers[0].id}
function renderAgentList(){
  const qq=qAgent.trim().toLowerCase();
  const list=AGENTS.filter(a=>!qq||a.name.toLowerCase().includes(qq)||a.role.toLowerCase().includes(qq));
  $('agentScroll').innerHTML=list.map(a=>{
    const path=pathLabel(drafts[a.id].savedRuntime);
    return '<button type="button" class="agent-card" data-id="'+a.id+'" data-active="'+(a.id===selectedId?'1':'0')+'">'
      +'<div class="name"><span>'+a.name+'</span><span class="pill">v'+a.version+'</span></div>'
      +'<div class="role">'+a.role+'</div><div class="runtime">'+path+'</div>'
      +'<div class="meta"><span class="pill">Task '+a.tasks.length+'</span><span class="pill">Skill '+a.skills.length+'</span></div></button>';
  }).join('')||'<div class="empty">无匹配智能体</div>';
}
function renderTabs(){
  document.querySelectorAll('.tab').forEach(el=>{el.dataset.active=el.dataset.tab===tab?'1':'0'});
  document.querySelectorAll('.panel').forEach(el=>{el.dataset.show=el.dataset.panel===tab?'1':'0'});
}
function renderDetailChrome(){
  const a=agent(), dirty=isDirty();
  $('detailName').textContent=a.name;
  $('detailRole').textContent=a.role+' · 页签：工作 / 任务 / 指令 / Skills / 运行时';
  $('verBadge').textContent='v'+a.version;
  $('dirtyBadge').textContent=dirty?'未保存':'已同步';
  $('dirtyBadge').dataset.tone=dirty?'warn':'ok';
  $('btnSave').disabled=!dirty;
}
function renderOverview(){
  const a=agent(), d=draft();
  $('ovRuntime').textContent=pathLabel(d.savedRuntime);
  $('ovCaps').textContent='Skill '+a.skills.length+' · 任务 '+a.tasks.length+' · 工具已声明';
  $('ovWork').textContent=a.work;
  $('ovTaskCount').textContent=String(a.tasks.length);
  $('ovTasks').innerHTML=a.tasks.slice(0,3).map(t=>'<div class="task-row"><div><strong>'+t.title+'</strong><div class="muted-sub">'+t.id+'</div></div><span class="pill">'+t.status+'</span></div>').join('');
}
function renderTasks(){
  $('taskList').innerHTML=agent().tasks.map(t=>'<div class="task-row"><div><strong>'+t.title+'</strong><div class="muted-sub">关联 · '+t.id+'</div></div><span class="pill">'+t.status+'</span></div>').join('');
}
function renderInstructions(){$('instrBox').value=draft().instructions}
function renderSkills(){
  const a=agent(); $('skillCount').textContent=String(a.skills.length);
  $('skillList').innerHTML=a.skills.length?a.skills.map(s=>'<div class="skill-row"><div><strong>'+s.name+'</strong><div class="muted-sub">version '+s.ver+'</div></div><span class="pill">已允许</span></div>').join(''):'<div class="empty">尚未绑定 Skill</div>';
}
function renderTools(){$('toolsText').textContent=agent().tools}
function renderRuntime(){
  const d=draft(); if(!nav.groupId) syncNavFromRuntime(d.runtime);
  const g=CATALOG.find(x=>x.id===nav.groupId)||CATALOG[0];
  let providers=g.providers.slice();
  const qq=qRuntime.trim().toLowerCase();
  if(qq) providers=providers.filter(pr=>pr.name.toLowerCase().includes(qq)||pr.models.some(m=>m.toLowerCase().includes(qq)));
  let prov=providers.find(x=>x.id===nav.providerId)||providers[0]||g.providers[0];
  if(prov) nav.providerId=prov.id;
  let models=prov?prov.models.slice():[];
  if(qq&&prov&&!prov.name.toLowerCase().includes(qq)) models=models.filter(m=>m.toLowerCase().includes(qq));
  const p=parseMid(d.runtime);
  $('runtimePath').innerHTML='<span>'+g.label+'</span><span class="sep">→</span><span>'+(prov?prov.name:'选供应商')+'</span><span class="sep">→</span><b>'+(p.modelName||'点选模型')+'</b>';
  $('groupCol').innerHTML=CATALOG.map(gr=>{
    const count=gr.providers.reduce((n,pr)=>n+pr.models.length,0);
    return '<button type="button" class="row app-row" data-group="'+gr.id+'" data-active="'+(gr.id===g.id?'1':'0')+'"><span class="t">'+gr.label+'</span><span class="n">'+count+'</span></button>';
  }).join('');
  $('provHint').textContent='· '+g.label;
  $('provCol').innerHTML=providers.length?providers.map(pr=>'<button type="button" class="row" data-prov="'+pr.id+'" data-active="'+(pr.id===(prov&&prov.id)?'1':'0')+'"><span class="t">'+pr.name+'</span><span class="s">'+pr.models.length+' 个模型</span></button>').join(''):'<div class="empty">无匹配供应商</div>';
  $('modelHint').textContent=prov?'· '+prov.name:'';
  $('modelCol').innerHTML=models.length?models.map(m=>{
    const id=mid(g.id,prov.id,m); const selected=d.runtime===id; const isDefault=d.savedRuntime===id;
    return '<button type="button" class="row model-row" data-model="'+m+'" data-active="'+(selected?'1':'0')+'"><span class="t">'+m+'</span><span class="s">'+g.label+' / '+prov.name+'</span>'+(isDefault?'<span class="tag tag-ok">默认</span>':selected?'<span class="tag">已选</span>':'')+'</button>';
  }).join(''):'<div class="empty">该供应商下无模型</div>';
  const dirty=d.runtime!==d.savedRuntime;
  $('runtimeDirty').textContent=dirty?'运行时未保存':'运行时已同步';
  $('btnSaveRuntime').disabled=!dirty;
}
function renderAll(){renderAgentList();renderDetailChrome();renderTabs();renderOverview();renderTasks();renderInstructions();renderSkills();renderTools();if(tab==='runtime')renderRuntime()}
$('agentScroll').addEventListener('click',e=>{const btn=e.target.closest('[data-id]');if(!btn)return;selectedId=btn.getAttribute('data-id');tab='overview';syncNavFromRuntime(draft().runtime);qRuntime='';$('runtimeSearch').value='';renderAll()});
$('tabs').addEventListener('click',e=>{const t=e.target.closest('.tab');if(!t)return;tab=t.dataset.tab;if(tab==='runtime'){syncNavFromRuntime(draft().runtime);renderRuntime()}renderTabs();renderDetailChrome()});
$('agentSearch').addEventListener('input',()=>{qAgent=$('agentSearch').value;renderAgentList()});
$('instrBox').addEventListener('input',()=>{draft().instructions=$('instrBox').value;renderDetailChrome()});
$('groupCol').addEventListener('click',e=>{const btn=e.target.closest('[data-group]');if(!btn)return;nav.groupId=btn.getAttribute('data-group');const g=CATALOG.find(x=>x.id===nav.groupId);nav.providerId=g.providers[0].id;renderRuntime()});
$('provCol').addEventListener('click',e=>{const btn=e.target.closest('[data-prov]');if(!btn)return;nav.providerId=btn.getAttribute('data-prov');renderRuntime()});
$('modelCol').addEventListener('click',e=>{const btn=e.target.closest('[data-model]');if(!btn)return;draft().runtime=mid(nav.groupId,nav.providerId,btn.getAttribute('data-model'));renderRuntime();renderDetailChrome();renderAgentList()});
$('runtimeSearch').addEventListener('input',()=>{qRuntime=$('runtimeSearch').value;renderRuntime()});
function saveAll(){const d=draft(),a=agent();d.savedRuntime=d.runtime;d.savedInstructions=d.instructions;a.runtime=d.savedRuntime;a.instructions=d.savedInstructions;renderAll();$('toast').textContent='已保存「'+a.name+'」';$('toast').dataset.show='1';setTimeout(()=>{$('toast').dataset.show='0'},1600)}
$('btnSave').addEventListener('click',saveAll);
$('btnSaveRuntime').addEventListener('click',saveAll);
$('btnResetRuntime').addEventListener('click',()=>{const d=draft();d.runtime=d.savedRuntime;syncNavFromRuntime(d.runtime);qRuntime='';$('runtimeSearch').value='';renderRuntime();renderDetailChrome()});
$('btnNew').addEventListener('click',()=>{$('toast').textContent='新建智能体：后续接 createAgent（Demo）';$('toast').dataset.show='1';setTimeout(()=>{$('toast').dataset.show='0'},1800)});
syncNavFromRuntime(draft().runtime);renderAll();
