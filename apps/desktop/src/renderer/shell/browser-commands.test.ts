/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReadScript, buildResolveClickScript } from './browser-command-scripts.js';
import { activateBrowserWebview, executeBrowserCommand, findRegisteredBrowserWebview, getOwnedBrowserWebview, navigateOwnedBrowserWebview, registerBrowserWebview, unregisterBrowserWebview, type BrowserWebviewElement } from './browser-commands.js';

const nextUrl = 'https://fixture.test/onboarding';
function page() {
  document.body.innerHTML = `<button id="phone">使用手机继续</button><button id="google">使用 Google 继续</button><button id="apple">使用 Apple 继续</button><input id="account" placeholder="电子邮箱或用户名" value="private-fixture-value"><button id="next"><span>继续</span></button>`;
  const elements = Array.from(document.querySelectorAll('button,input,span'));
  for (const [i, el] of elements.entries()) {
    Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 20, y: 30+i*50, left: 20, top: 30+i*50, width: 220, height: 40, right: 240, bottom: 70+i*50 }) });
  }
  vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) => elements.find(el => {const r=el.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}) ?? null);
}
function guest(ownerId = 'thread-a') {
  const el = document.createElement('div') as unknown as BrowserWebviewElement;
  el.src = nextUrl;
  const execute = vi.fn(async (script: string) => window.eval(script) as unknown);
  Object.assign(el, { getURL: () => nextUrl, isLoading: () => false, getWebContentsId: () => 42, executeJavaScript: execute });
  registerBrowserWebview(el, true, 'https://fixture.test/login', ownerId);
  return { el, execute };
}
beforeEach(() => {
  registerBrowserWebview(null);
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null, writable: true });
  vi.stubGlobal('CSS', { escape: (text: string) => text.replace(/([^\w-])/g, '\\$1') });
  page();
});
afterEach(() => { registerBrowserWebview(null); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('embedded browser targeting and conversation ownership', () => {
  it.each([{text:'继续'}, {selector:'button:text-is("继续"), [role="button"]:text-is("继续")'}, {selector:'#next'}])('prefers the exact continuation target with %j', async args => {
    guest(); const sent = vi.fn(async () => ({ok:true}));
    const result = await executeBrowserCommand({action:'browser_click',args,ownerId:'thread-a',sendTrustedClick:sent});
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.resultJson!).text).toBe('继续');
    expect(sent).toHaveBeenCalledOnce();
  });
  it('rejects ambiguous, disabled, covered and invalid targets without clicking', async () => {
    const {execute} = guest(); const sent = vi.fn(async () => ({ok:true}));
    const call = (args: Record<string,unknown>) => executeBrowserCommand({action:'browser_click',args,ownerId:'thread-a',sendTrustedClick:sent});
    expect(JSON.parse((await call({selector:'button'})).resultJson!).code).toBe('browser.ambiguous-target');
    expect(JSON.parse((await call({selector:'button:unsupported()'})).resultJson!).code).toBe('browser.invalid-selector');
    document.querySelector<HTMLButtonElement>('#next')!.disabled = true;
    expect(JSON.parse((await call({text:'继续'})).resultJson!).code).toBe('browser.disabled-target');
    document.querySelector<HTMLButtonElement>('#next')!.disabled = false;
    vi.mocked(document.elementFromPoint).mockReturnValue(document.querySelector('#phone'));
    expect(JSON.parse((await call({selector:'#next'})).resultJson!).code).toBe('browser.occluded-target');
    expect(sent).not.toHaveBeenCalled();
    expect(execute.mock.calls.every(([script])=>!script.includes('dispatchEvent(new PointerEvent'))).toBe(true);
  });
  it('returns every scoped control with a unique selector and no input value', () => {
    const result = window.eval(buildReadScript({selector:'button, input'})) as {projection:string;controls:{selector:string;name:string}[]};
    expect(result.projection).toBe('browser_read.v1');
    expect(result.controls).toHaveLength(5);
    for(const control of result.controls) expect(document.querySelectorAll(control.selector)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('private-fixture-value');
    expect(result.controls.some(c=>c.selector==='#next'&&c.name==='继续')).toBe(true);
  });
  it('does not report unsuccessful reads or writes as successful actions', async () => {
    guest();
    expect((await executeBrowserCommand({action:'browser_read',args:{selector:'#missing'},ownerId:'thread-a'})).ok).toBe(false);
    expect((await executeBrowserCommand({action:'browser_type',args:{selector:'#missing',text:'test'},ownerId:'thread-a'})).ok).toBe(false);
    expect((await executeBrowserCommand({action:'browser_type',args:{selector:'button',text:'test'},ownerId:'thread-a'})).ok).toBe(false);
  });
  it('preserves link URLs in the readable result while adding stable selectors', () => {
    const link=document.createElement('a');link.id='help';link.href='https://fixture.test/help';link.textContent='帮助';
    Object.defineProperty(link,'getBoundingClientRect',{value:()=>document.querySelector('#phone')!.getBoundingClientRect()});
    document.body.append(link);
    expect(window.eval(buildReadScript({})).links).toContainEqual({text:'帮助',href:'https://fixture.test/help',selector:'#help'});
  });
  it('does not send a second synthetic click after a trusted input failure', async () => {
    const {execute}=guest();
    const result=await executeBrowserCommand({action:'browser_click',args:{selector:'#next'},ownerId:'thread-a',sendTrustedClick:async()=>({ok:false})});
    expect(JSON.parse(result.resultJson!).code).toBe('browser.trusted-click-failed');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('reuses an already redirected page without waiting ten seconds or reloading it', async () => {
    const {el}=guest(); let navigations=0;
    Object.defineProperty(el,'src',{configurable:true,get:()=>nextUrl,set:()=>{navigations+=1;}});
    expect(navigateOwnedBrowserWebview('thread-a','https://fixture.test/login')).toBe(true);
    const started=Date.now();
    const opened=await executeBrowserCommand({action:'browser_open',args:{url:'https://fixture.test/login'},ownerId:'thread-a'});
    expect(opened.ok).toBe(true); expect(Date.now()-started).toBeLessThan(250); expect(navigations).toBe(0);
  });
  it('rebinds a remounted guest to the same conversation without stealing another conversation', async () => {
    const first=guest(); unregisterBrowserWebview(first.el);
    const replacement=guest(); const other=guest('thread-b');
    expect(getOwnedBrowserWebview('thread-a')).toBe(replacement.el);
    expect((await executeBrowserCommand({action:'browser_read',args:{},ownerId:'thread-a'})).ok).toBe(true);
    expect(replacement.execute).toHaveBeenCalledOnce(); expect(other.execute).not.toHaveBeenCalled();
  });
  it('does not silently take over another conversation when its own page has not opened', async () => {
    const other=guest('thread-b');
    const result=await executeBrowserCommand({action:'browser_read',args:{},ownerId:'thread-a'});
    expect(JSON.parse(result.resultJson!).code).toBe('browser.page-not-ready');
    expect(other.execute).not.toHaveBeenCalled();
  });
  it('does not mistake an invalid query for a successful read', () => {
    expect(window.eval(buildReadScript({selector:'button:unsupported()'}))).toMatchObject({found:false,reason:'invalid-selector'});
    expect(window.eval(buildResolveClickScript({selector:'button:text-is("不存在")'}))).toMatchObject({found:false,reason:'target-not-found'});
  });
  it('never falls back to a containing label when exact selector text is absent', () => {
    document.querySelector('#next')!.remove();
    document.querySelector('#google')!.remove();
    document.querySelector('#apple')!.remove();
    expect(window.eval(buildResolveClickScript({selector:'button:text-is("继续"), [role="button"]:text-is("继续")',text:'继续'}))).toMatchObject({found:false,reason:'target-not-found'});
  });
  it('keeps explicit guest viewport coordinates instead of shifting to the element center', () => {
    expect(window.eval(buildResolveClickScript({x:40,y:40}))).toMatchObject({found:true,x:40,y:40,text:'使用手机继续'});
  });
  it('waits for a new navigation rather than reporting the previous page as loaded', async () => {
    const {el}=guest(); let current=nextUrl;
    el.getURL=()=>current;
    navigateOwnedBrowserWebview('thread-a','https://fixture.test/another');
    let finished=false;
    const opening=executeBrowserCommand({action:'browser_open',args:{url:'https://fixture.test/another'},ownerId:'thread-a'}).then(result=>{finished=true;return result;});
    await new Promise(resolve=>setTimeout(resolve,65));
    expect(finished).toBe(false);
    current='https://fixture.test/another/redirect';
    expect((await opening).ok).toBe(true);
  });
});


describe('retained conversation browser ownership', () => {
  it('keeps inactive tabs owned without replacing their conversation focused guest', () => {
    const first = guest('thread-a');
    const hidden = guest('thread-a');
    activateBrowserWebview(first.el);
    registerBrowserWebview(hidden.el, false, nextUrl, 'thread-a');
    expect(getOwnedBrowserWebview('thread-a')).toBe(first.el);
    expect(findRegisteredBrowserWebview(nextUrl, 'thread-b')).toBeNull();
    activateBrowserWebview(hidden.el);
    expect(getOwnedBrowserWebview('thread-a')).toBe(hidden.el);
  });

  it('does not borrow any retained tab from another conversation even when URLs match', () => {
    const first = guest('thread-a');
    const second = guest('thread-a');
    activateBrowserWebview(first.el);
    expect(findRegisteredBrowserWebview(nextUrl, 'thread-b')).toBeNull();
    unregisterBrowserWebview(first.el);
    expect(findRegisteredBrowserWebview(nextUrl, 'thread-b')).toBeNull();
    expect(findRegisteredBrowserWebview(nextUrl, 'thread-a')).toBe(second.el);
  });
});


it('rejects a stale draft owner after its guest is assigned to the persisted conversation', () => {
  const previous = guest('draft:a');
  registerBrowserWebview(previous.el, false, nextUrl, 'saved-a');
  expect(getOwnedBrowserWebview('saved-a')).toBe(previous.el);
  expect(getOwnedBrowserWebview('draft:a')).toBeUndefined();
  expect(navigateOwnedBrowserWebview('draft:a', 'https://other.test')).toBe(false);
});
