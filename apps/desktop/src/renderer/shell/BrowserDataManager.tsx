import * as Dialog from '@radix-ui/react-dialog';
import { Cookie, Download, KeyRound, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserDataAction, BrowserDataSnapshot } from '../../browser-data.js';
import {
  loadEmbeddedBrowserSettings,
  saveEmbeddedBrowserSettings,
  type EmbeddedBrowserSettings,
} from './embedded-browser-settings.js';
import { ToggleControl } from './ToggleControl.js';
import './browser-data-manager.css';

/** NewMax opens the same dialog in either the password or the settings form. */
export type BrowserDataManagerView = 'passwords' | 'cookies' | 'import' | 'settings';

export interface BrowserDataManagerProps {
  webContentsId: number;
  currentUrl: string;
  initialView: BrowserDataManagerView;
  onClose(): void;
}

function loginOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
  } catch { return ''; }
}

export function BrowserDataManager(props: BrowserDataManagerProps) {
  const [view, setView] = useState<Exclude<BrowserDataManagerView, 'import'>>(
    props.initialView === 'import' ? 'passwords' : props.initialView,
  );
  const [settings, setSettings] = useState<EmbeddedBrowserSettings>(() => loadEmbeddedBrowserSettings());
  const [snapshot, setSnapshot] = useState<BrowserDataSnapshot>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => ({ origin: loginOrigin(props.currentUrl), username: '', password: '' }));
  const [confirm, setConfirm] = useState<{ action: 'delete-password'; id: string; label: string } | { action: 'clear-site'; domain: string; label: string }>();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = useCallback(async (request: BrowserDataAction) => {
    const api = window.syncThink?.runtime?.manageEmbeddedBrowserData;
    if (!api) { setError('当前桌面版本尚未接入浏览器资料管理，请更新并重启应用。'); return false; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api({ ...request, webContentsId: props.webContentsId });
      if (!live.current) return false;
      if (!result.ok) { setError(result.error); return false; }
      setSnapshot(result.snapshot); setMessage(result.message ?? ''); return true;
    } catch { if (live.current) setError('操作失败，请重试。'); return false; }
    finally { if (live.current) setBusy(false); }
  }, [props.webContentsId]);
  // NewMax reads credentials only in the password form; the settings form is
  // pure local preferences and never touches the guest. Opening the dialog in
  // settings mode and switching to a data tab loads the snapshot then.
  useEffect(() => {
    if (view !== 'settings' && !snapshot) void run({ action: 'list' });
  }, [run, snapshot, view]);
  const canSave = Boolean(snapshot?.persistent && snapshot.encryptionAvailable);
  const normalized = query.toLowerCase().trim();
  const passwords = snapshot?.passwords.filter(item => `${item.origin} ${item.username}`.toLowerCase().includes(normalized)) ?? [];
  const sites = snapshot?.sites.filter(item => item.domain.includes(normalized)) ?? [];
  const currentOrigin = loginOrigin(props.currentUrl);

  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) props.onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="browser-data__overlay" />
      <Dialog.Content className="browser-data__dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <header className="browser-data__header">
          <div><Dialog.Title>{view === 'passwords' ? '密码和自动填充' : '浏览器设置'}</Dialog.Title><Dialog.Description>此浏览器的登录状态与日常 Chrome / Edge 资料分开。</Dialog.Description></div>
          <Dialog.Close className="browser-data__close" disabled={busy} aria-label="关闭浏览器设置"><X size={18} /></Dialog.Close>
        </header>
        <nav className="browser-data__tabs" aria-label="浏览器设置分类">
          <button type="button" aria-pressed={view === 'passwords'} onClick={() => { setView('passwords'); setQuery(''); }}><KeyRound size={16} />密码管理器</button>
          <button type="button" aria-pressed={view === 'cookies'} onClick={() => { setView('cookies'); setQuery(''); }}><Cookie size={16} />Cookie 和站点数据</button>
          <button type="button" aria-pressed={view === 'settings'} onClick={() => { setView('settings'); setQuery(''); }}><SlidersHorizontal size={16} />浏览器设置</button>
        </nav>
        <div className="browser-data__body">
          {view === 'settings' ? <>
            <section className="browser-data__section-heading">
              <div><h3>内置浏览器偏好</h3><p>设置保存在本机，并作用于所有内嵌网页标签。</p></div>
            </section>
            <ul className="browser-data__settings">
              <li>
                <div><strong>默认自动适应网页</strong><p>新打开的网页根据可用宽度自动调整缩放比例。</p></div>
                <ToggleControl
                  checked={settings.autoFit}
                  label="默认自动适应网页"
                  onChange={value => setSettings(saveEmbeddedBrowserSettings({ autoFit: value }))}
                  className="browser-data__switch"
                  thumbClassName="browser-data__switch-thumb"
                />
              </li>
              <li>
                <div><strong>自动填充已保存密码</strong><p>页面加载完成后，为匹配的网站自动填入账号和密码。</p></div>
                <ToggleControl
                  checked={settings.autofill}
                  label="自动填充已保存密码"
                  onChange={value => setSettings(saveEmbeddedBrowserSettings({ autofill: value }))}
                  className="browser-data__switch"
                  thumbClassName="browser-data__switch-thumb"
                />
              </li>
              <li>
                <div><strong>拦截广告与追踪器</strong><p>在网络请求发出前拦截常见广告、追踪脚本和第三方同步页面。可在网页菜单中为当前网站关闭。</p></div>
                <ToggleControl
                  checked={settings.contentBlocking}
                  label="拦截广告与追踪器"
                  onChange={value => setSettings(saveEmbeddedBrowserSettings({ contentBlocking: value }))}
                  className="browser-data__switch"
                  thumbClassName="browser-data__switch-thumb"
                />
              </li>
            </ul>
            <p className="browser-data__hint">这些设置作用于所有内置浏览器 Profile，不影响应用登录态或已配对 Chrome。</p>
          </> : <>
          <section className="browser-data__import">
            <div><strong>导入 Cookie 和密码</strong><p>密码：Chrome / Edge 导出的 CSV。Cookie：JSON 数组或包含 cookies 的 JSON；仅导入 Cookie，不导入 localStorage。</p></div>
            <button type="button" disabled={busy || !snapshot?.persistent} onClick={() => void run({ action: 'import-file' })}><Download size={15} />选择文件</button>
          </section>
          {snapshot && !snapshot.persistent && <p className="browser-data__hint">当前是临时资料，退出后不保留 Cookie；密码保存和文件导入仅支持持久资料。</p>}
          {snapshot && !snapshot.encryptionAvailable && <p className="browser-data__hint">系统加密服务未就绪，密码保存已停用。</p>}
          <label className="browser-data__search"><Search size={15} /><input aria-label="搜索浏览器资料" placeholder={view === 'passwords' ? '搜索网站或用户名' : '搜索站点'} value={query} onChange={event => setQuery(event.target.value)} /></label>
          {view === 'passwords' ? <>
            <div className="browser-data__section-heading"><div><h3>已保存的密码</h3><p><ShieldCheck size={13} /> 本机系统加密保存；填充前需手动确认，不自动提交登录。</p></div><button type="button" disabled={busy || !canSave} onClick={() => setAdding(value => !value)}><Plus size={15} />添加</button></div>
            <button type="button" className="browser-data__capture" disabled={busy || !canSave || !/^https?:/.test(props.currentUrl)} onClick={() => void run({ action: 'save-from-page' })}>保存当前页面已填写的登录信息</button>
            {adding && <form className="browser-data__form" onSubmit={event => {
              event.preventDefault();
              void run({ action: 'save-password', ...form }).then(ok => { if (ok) { setForm(current => ({ ...current, password: '' })); setAdding(false); } });
            }}>
              <label>网站地址<input required type="url" aria-label="密码网站地址" value={form.origin} onChange={event => setForm(current => ({ ...current, origin: event.target.value }))} /></label>
              <label>用户名<input required autoComplete="off" aria-label="密码用户名" value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} /></label>
              <label>密码<input required type="password" autoComplete="new-password" aria-label="保存的密码" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} /></label>
              <div><button type="submit" disabled={busy}>加密保存</button><button type="button" onClick={() => { setAdding(false); setForm(current => ({ ...current, password: '' })); }}>取消</button></div>
            </form>}
            <ul className="browser-data__list">
              {passwords.map(item => <li key={item.id}><KeyRound size={17} /><div><strong>{item.origin}</strong><span>{item.username} · ••••••••</span></div><button type="button" disabled={busy || item.origin !== currentOrigin} title={item.origin !== currentOrigin ? '先打开相同网站再填充' : '填充到当前页面，不提交登录'} onClick={() => void run({ action: 'fill-password', id: item.id })}>填充</button><button type="button" disabled={busy} aria-label={`删除 ${item.username} 的密码`} onClick={() => setConfirm({ action: 'delete-password', id: item.id, label: `${item.origin} · ${item.username}` })}><Trash2 size={15} /></button></li>)}
            </ul>
            {!busy && !passwords.length && <p className="browser-data__empty">{query ? '没有匹配的密码' : '还没有保存的密码'}</p>}
          </> : <>
            <div className="browser-data__section-heading"><div><h3>Cookie 和站点数据</h3><p>清理会退出相应站点；域 Cookie 也可能影响其子域名。不清理其他域名的资料。</p></div></div>
            <ul className="browser-data__list">
              {sites.map(item => <li key={item.domain}><Cookie size={17} /><div><strong>{item.domain}</strong><span>{item.count} 个 Cookie · {item.persistentCount} 个持久 Cookie</span></div><button type="button" disabled={busy} onClick={() => setConfirm({ action: 'clear-site', domain: item.domain, label: item.domain })}>清除</button></li>)}
            </ul>
            {!busy && !sites.length && <p className="browser-data__empty">{query ? '没有匹配的站点' : '当前资料没有 Cookie'}</p>}
          </>}
          {confirm && <section className="browser-data__confirm" role="alertdialog" aria-label="确认删除浏览器数据"><strong>{confirm.action === 'clear-site' ? '清除该站点的 Cookie 和站点存储？' : '删除这条密码？'}</strong><p>{confirm.label}</p><div><button type="button" disabled={busy} onClick={() => void run(confirm).then(ok => { if (ok) setConfirm(undefined); })}>确认删除</button><button type="button" disabled={busy} onClick={() => setConfirm(undefined)}>取消</button></div></section>}
          {busy && <p role="status">正在处理…</p>}
          {message && <p role="status" className="browser-data__success">{message}</p>}
          {error && <div role="alert" className="browser-data__error">{error}<button type="button" disabled={busy} onClick={() => void run({ action: 'list' })}>重试读取</button></div>}
          </>}
        </div>
        <footer className="browser-data__footer"><span>浏览器资料目录</span><code>{snapshot?.storagePath ?? (view === 'settings' ? '打开密码或 Cookie 分类后读取' : snapshot && !snapshot.persistent ? '临时内存资料' : '读取中…')}</code><small>会话 Cookie 可能在退出后失效；网站登录过期后需重新登录。CSV / JSON 导出文件包含敏感信息，导入后请妥善处理原文件。</small></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
