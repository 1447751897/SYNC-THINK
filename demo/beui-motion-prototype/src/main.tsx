import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Command,
  FileCode2,
  Folder,
  Gauge,
  Globe2,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
  Users,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';

const workspaces = ['全部工作区', 'SYNC-THINK', 'Cuitaliao', 'ai驱动开发skill', 'mail-helper'];
const conversations = [
  { id: 'phoenix', title: '产品周报与发布计划', preview: '我已经整理了本周的发布节奏…', time: '刚刚', tone: 'violet' },
  { id: 'review', title: '审阅浏览器签到流程', preview: '发现 2 个需要确认的权限节点…', time: '10:24', tone: 'blue' },
  { id: 'frontend', title: '前端动效评估', preview: 'Be UI 的共享布局可以用于…', time: '昨天', tone: 'peach' },
  { id: 'research', title: '竞品研究', preview: '已生成引用来源与摘要…', time: '周一', tone: 'mint' },
  { id: 'inbox', title: '收件箱 · 自动化任务', preview: '3 个任务等待你的处理', time: '周一', tone: 'slate' },
];
const steps = [
  { icon: Search, label: '搜索项目上下文', detail: 'workspace.search · 0.8s', status: 'success' },
  { icon: TerminalSquare, label: '读取任务执行器', detail: 'terminal.exec · 1.1s', status: 'success' },
  { icon: FileCode2, label: '修复模型绑定与对话跳转', detail: 'file.patch · 1.2s', status: 'active' },
  { icon: Activity, label: '复核改动并生成结果', detail: 'git.diff · 等待执行', status: 'pending' },
];

function MotionButton({ children, className = '', onClick, variant = 'ghost', ...props }) {
  return <motion.button whileTap={{ scale: 0.94 }} whileHover={{ y: -1 }} transition={{ type: 'spring', stiffness: 500, damping: 28 }} className={`motion-button motion-button--${variant} ${className}`} onClick={onClick} {...props}>{children}</motion.button>;
}

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [workspace, setWorkspace] = useState('全部工作区');
  const [selectedConversation, setSelectedConversation] = useState('phoenix');
  const [activeView, setActiveView] = useState('chat');
  const [processOpen, setProcessOpen] = useState(true);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('gpt-6-a​​stra'.replace('​​', ''));
  const [approval, setApproval] = useState('pending');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [message, setMessage] = useState('');

  const currentConversation = useMemo(() => conversations.find((item) => item.id === selectedConversation) ?? conversations[0], [selectedConversation]);
  const showToast = (text, tone = 'success') => { setToast({ text, tone }); window.setTimeout(() => setToast(null), 2600); };
  const sendMessage = () => { if (!message.trim()) return; showToast('已加入执行队列'); setMessage(''); };

  return <LayoutGroup>
    <div className="prototype-shell">
      <aside className={`prototype-rail ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="rail-brand"><div className="brand-mark"><Sparkles size={16} /></div><AnimatePresence initial={false}>{!collapsed && <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>SYNC-THINK</motion.span>}</AnimatePresence></div>
        <nav className="rail-nav" aria-label="主导航">
          {[['chat', MessageSquare, '对话'], ['workspace', LayoutDashboard, '工作区'], ['files', Folder, '文件'], ['activity', Activity, '后台活动'], ['agents', Bot, '智能体']].map(([id, Icon, label]) => <button key={id} className={`rail-nav-item ${activeView === id ? 'is-active' : ''}`} onClick={() => setActiveView(id)} aria-label={label}>
            {activeView === id && <motion.span layoutId="rail-active" className="rail-active-pill" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
            <Icon size={17} /><AnimatePresence initial={false}>{!collapsed && <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}>{label}</motion.span>}</AnimatePresence>
          </button>)}
        </nav>
        <div className="rail-spacer" />
        <MotionButton className="rail-settings" onClick={() => setModal('settings')} aria-label="打开设置"><Settings2 size={17} />{!collapsed && <span>设置</span>}</MotionButton>
        <button className="rail-collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}><PanelLeft size={16} /></button>
      </aside>

      <section className="conversation-column">
        <header className="column-header"><div><div className="eyebrow">WORKSPACE</div><h1>对话</h1></div><MotionButton variant="icon" onClick={() => showToast('新对话已创建')} aria-label="新建对话"><Plus size={17} /></MotionButton></header>
        <div className="workspace-switcher"><Folder size={14} /><select value={workspace} onChange={(event) => setWorkspace(event.target.value)} aria-label="选择工作区">{workspaces.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div>
        <label className="search-box"><Search size={15} /><input placeholder="搜索对话…" /><kbd>⌘ K</kbd></label>
        <div className="filter-tabs"><button className="is-active">全部 <span>12</span></button><button>共享 <span>4</span></button><button>私有 <span>8</span></button></div>
        <div className="conversation-list">
          {conversations.map((item) => <motion.button key={item.id} layout onClick={() => setSelectedConversation(item.id)} className={`conversation-row ${selectedConversation === item.id ? 'is-selected' : ''}`} whileHover={{ x: 2 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            {selectedConversation === item.id && <motion.span layoutId="conversation-active" className="conversation-active-bg" transition={{ type: 'spring', stiffness: 360, damping: 30 }} />}
            <span className={`conversation-avatar tone-${item.tone}`}><MessageSquare size={15} /></span><span className="conversation-copy"><strong>{item.title}</strong><small>{item.preview}</small></span><time>{item.time}</time><span className="unread-dot" />
          </motion.button>)}
        </div>
        <div className="column-footer"><MotionButton variant="outline" onClick={() => setModal('inbox')}><Inbox size={15} /> 收件箱 <span className="count-badge">3</span></MotionButton><MotionButton variant="icon" aria-label="更多"><MoreHorizontal size={17} /></MotionButton></div>
      </section>

      <main className="chat-surface">
        <header className="chat-header"><div className="chat-title"><span className="agent-avatar"><Bot size={18} /></span><div><strong>{currentConversation.title}</strong><small><span className="live-dot" /> SYNC-THINK · {workspace}</small></div></div><div className="chat-actions"><div className="model-picker"><MotionButton variant="soft" onClick={() => setModelOpen((value) => !value)}><Sparkles size={14} /> {model} <ChevronDown size={13} /></MotionButton><AnimatePresence>{modelOpen && <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} className="model-menu"><div className="menu-caption">本轮模型</div>{['gpt-6-astra', 'gpt-5.6-sol', 'deepseek-flash'].map((item) => <button key={item} className={item === model ? 'is-selected' : ''} onClick={() => { setModel(item); setModelOpen(false); showToast(`已切换到 ${item}`); }}>{item}{item === model && <Check size={14} />}</button>)}</motion.div>}</AnimatePresence></div><MotionButton variant="icon" aria-label="打开设置" onClick={() => setModal('settings')}><Settings2 size={17} /></MotionButton><MotionButton variant="icon" aria-label="更多"><MoreHorizontal size={17} /></MotionButton></div></header>
        <div className="chat-body">
          <div className="date-divider"><span>今天 10:42</span></div>
          <motion.div className="message message--user" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><span>请复核一下最近的浏览器自动化任务，并把执行过程中的命令、文件和审批节点整理出来。</span></motion.div>
          <motion.div className="message message--agent" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}><div className="message-meta"><span className="agent-avatar small"><Bot size={14} /></span><strong>全能助手</strong><span className="status-chip"><span className="live-dot" /> working</span><time>10:43</time></div><p>我先读取任务上下文，然后复核模型绑定、浏览器执行和对话跳转。下面的过程面板会实时展开。</p>
            <div className="process-card"><button className="process-summary" onClick={() => setProcessOpen((value) => !value)}><span className="process-icon"><Activity size={15} /></span><span className="process-title">执行过程</span><span className="process-count">3 个命令 · 1 个浏览器动作</span><span className="process-time">2.8s</span><ChevronDown size={15} className={processOpen ? 'rotate' : ''} /></button><AnimatePresence initial={false}>{processOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }} className="process-list">{steps.map((step, index) => <motion.div layout key={step.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }} className={`process-row is-${step.status}`}><span className="process-step-dot">{step.status === 'success' ? <Check size={12} /> : step.status === 'active' ? <motion.span animate={{ scale: [1, 1.35, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}><CircleDot size={12} /> </motion.span> : <step.icon size={12} />}</span><span className="process-step-copy"><strong>{step.label}</strong><small>{step.detail}</small></span><ChevronRight size={14} /></motion.div>)}</motion.div>}</AnimatePresence></div>
            <div className={`approval-card ${approval !== 'pending' ? `is-${approval}` : ''}`}><span className="approval-icon"><Zap size={16} /></span><div><strong>{approval === 'pending' ? '需要审批' : approval === 'approved' ? '已批准继续执行' : '已暂停执行'}</strong><p>接下来会打开本地浏览器并写入 1 个任务草稿。</p></div>{approval === 'pending' ? <div className="approval-actions"><MotionButton variant="primary" onClick={() => { setApproval('approved'); showToast('审批已通过'); }}>批准</MotionButton><MotionButton variant="outline" onClick={() => { setApproval('cancelled'); showToast('任务已暂停', 'warning'); }}>暂停</MotionButton></div> : <Check size={18} className="approval-done" />}</div>
          </motion.div>
          <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} className={`toast toast--${toast.tone}`}><Check size={15} />{toast.text}</motion.div>}</AnimatePresence>
        </div>
        <div className="composer-wrap"><div className="composer"><div className="composer-tools"><MotionButton variant="icon" aria-label="附件"><Paperclip size={16} /></MotionButton><MotionButton variant="icon" aria-label="提及"><AtSign size={16} /></MotionButton><MotionButton variant="icon" aria-label="命令"><Command size={16} /></MotionButton><span className="composer-hint">输入 / 调用能力，@ 引用文件</span></div><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="继续告诉我你想完成什么…" rows={2} /><div className="composer-bottom"><span><Gauge size={14} /> 思考强度 · 高</span><span className="composer-shortcut">Enter 发送 · Shift Enter 换行</span><MotionButton variant="primary" className="send-button" onClick={sendMessage} aria-label="发送"><ArrowUp size={17} /></MotionButton></div></div></div>
      </main>

      <aside className="inspector"><div className="inspector-header"><div><div className="eyebrow">LIVE CONTEXT</div><h2>执行摘要</h2></div><MotionButton variant="icon" aria-label="关闭右栏"><X size={16} /></MotionButton></div><section className="inspector-card accent-card"><div className="card-heading"><Sparkles size={15} /><strong>浏览器自动化</strong><span className="status-badge">进行中</span></div><p>去 yucoder.cn 帮我签到</p><div className="metric-grid"><span><small>模型</small><strong>{model}</strong></span><span><small>步骤</small><strong>4 / 6</strong></span><span><small>浏览器</small><strong>默认环境</strong></span><span><small>耗时</small><strong>00:14</strong></span></div></section><section className="inspector-card"><div className="card-heading"><Activity size={15} /><strong>实时状态</strong><button onClick={() => setProcessOpen((value) => !value)} className="link-button">查看过程</button></div><div className="mini-timeline">{['任务已创建','模型已确认','打开浏览器','等待审批'].map((item, index) => <div className={index < 3 ? 'is-done' : ''} key={item}><span>{index < 3 ? <Check size={11} /> : index + 1}</span>{item}</div>)}</div></section><section className="inspector-card"><div className="card-heading"><Users size={15} /><strong>协作上下文</strong></div><div className="member-row"><span className="member-stack"><i>全</i><i>审</i><i>浏</i></span><span>全能助手 · 审阅员 · 浏览器</span></div></section><MotionButton variant="outline" className="inspector-button" onClick={() => setModal('details')}><Archive size={15} /> 查看完整运行记录</MotionButton></aside>

      <AnimatePresence>{modal && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal(null)}><motion.div layoutId="modal-card" className="modal-card" initial={{ opacity: 0, y: 26, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 26, scale: 0.96 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }} onClick={(event) => event.stopPropagation()}>{modal === 'settings' ? <><div className="modal-heading"><div><div className="eyebrow">PREFERENCES</div><h2>本轮设置</h2></div><MotionButton variant="icon" onClick={() => setModal(null)} aria-label="关闭"><X size={16} /></MotionButton></div><div className="settings-list"><label>默认模型<select value={model} onChange={(event) => setModel(event.target.value)}><option>gpt-6-astra</option><option>gpt-5.6-sol</option><option>deepseek-flash</option></select></label><label>思考强度<select defaultValue="高"><option>高</option><option>中</option><option>低</option></select></label><label className="toggle-row">动画强度<span className="switch is-on"><i /></span></label></div><MotionButton variant="primary" className="modal-submit" onClick={() => { setModal(null); showToast('设置已保存'); }}>保存设置</MotionButton></> : <><div className="modal-heading"><div><div className="eyebrow">RUN HISTORY</div><h2>{modal === 'inbox' ? '收件箱' : '完整运行记录'}</h2></div><MotionButton variant="icon" onClick={() => setModal(null)} aria-label="关闭"><X size={16} /></MotionButton></div><div className="history-list">{['workspace.search · 成功','terminal.exec · 成功','browser.read · 已完成','agent.result · 生成中'].map((item, index) => <div key={item} className="history-row"><span className={`history-dot dot-${index}`} /><div><strong>{item.split(' · ')[0]}</strong><small>{item.split(' · ')[1]}</small></div><time>{index + 1}.2s</time></div>)}</div></>}</motion.div></motion.div>}</AnimatePresence>
    </div>
  </LayoutGroup>;
}

export default App;
