/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ToolImagePreview from './ToolImagePreview.js';
import { ConversationContentScope } from './DeferredToolContent.js';
import { deferredContentReader } from './deferred-content-reader.js';
import type { InlineProcessItem } from './conversation-types.js';
const src = 'data:image/png;base64,AAAA';
const tool: Extract<InlineProcessItem, {kind:'tool'}> = {kind:'tool',name:'browser_screenshot',status:'completed',argumentsJson:'{}',result:JSON.stringify({ok:true,embedUrl:src,url:'https://example.test/page'})};
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function bridge(readProjectImage = vi.fn().mockResolvedValue({dataUrl:src})) { vi.stubGlobal('syncThink',{runtime:{readProjectImage}}); return readProjectImage; }

describe('tool image preview', () => {
  it('shows only an image and supports click-to-zoom and Escape', () => {
    render(<ToolImagePreview item={tool} />);
    expect(screen.getByRole('img',{name:'浏览器截图'}).getAttribute('src')).toBe(src);
    expect(screen.queryByText('JSON')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'放大查看浏览器截图'}));
    expect(screen.getByRole('dialog',{name:'图片预览'})).toBeTruthy();
    fireEvent.keyDown(window,{key:'Escape'});
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows multiple structured MCP images', () => {
    render(<ToolImagePreview item={{...tool,name:'read_image',result:JSON.stringify({content:[{type:'image',data:'AAAA',mimeType:'image/png'},{type:'image',data:'BBBB',mimeType:'image/jpeg'}]})}} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });
  it('reads local image inputs through the scoped bridge rather than a file URL', async () => {
    const read = bridge();
    render(<ToolImagePreview root="D:/workspace" item={{...tool,name:'view_image',argumentsJson:'{"path":"assets/avatar.png"}',result:'Image opened'}} />);
    expect((await screen.findByRole('img',{name:'图片输入'})).getAttribute('src')).toBe(src);
    expect(read).toHaveBeenCalledWith({root:'D:/workspace',path:'assets/avatar.png'});
  });
  it('previews raw image_input paths and supports click-to-zoom', async () => {
    const read = bridge();
    const path = '.sync-think/conversations/conv-1/images/attachment.jpg';
    render(<ToolImagePreview root="D:/workspace" item={{...tool,name:'image_input',argumentsJson:path,result:'MIME：image/jpeg；通过模型原生视觉输入发送'}} />);
    expect((await screen.findByRole('img',{name:'图片输入'})).getAttribute('src')).toBe(src);
    expect(read).toHaveBeenCalledWith({root:'D:/workspace',path});
    expect(screen.queryByText('图片预览暂不可用。技术详情中保留了原始结果。')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'放大查看图片输入'}));
    expect(screen.getByRole('dialog',{name:'图片预览'})).toBeTruthy();
    fireEvent.keyDown(window,{key:'Escape'});
    expect(screen.queryByRole('dialog',{name:'图片预览'})).toBeNull();
  });
  it('supports describe_image input paths without displaying the receipt JSON', async () => {
    bridge();
    render(<ToolImagePreview root="D:/workspace" item={{...tool,name:'describe_image',argumentsJson:'{"path":"input.png"}',result:'{"ok":true,"content":"图片的描述"}'}} />);
    expect(await screen.findByRole('img',{name:'图片输入'})).toBeTruthy();
    expect(screen.queryByText('图片的描述')).toBeNull();
  });
  it('shows unavailable-file feedback and re-reads on retry', async () => {
    const read = bridge(vi.fn().mockResolvedValueOnce({error:'image_not_found'}).mockResolvedValueOnce({dataUrl:src}));
    render(<ToolImagePreview root="D:/workspace" item={{...tool,name:'view_image',argumentsJson:'{"path":"input.png"}',result:'Image opened'}} />);
    fireEvent.click(await screen.findByRole('button',{name:'重试预览'}));
    expect(await screen.findByRole('img')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('never reads an arbitrary local path without a workspace scope', async () => {
    const read=bridge();
    render(<ToolImagePreview item={{...tool,name:'view_image',argumentsJson:'{"path":"C:/secret.png"}',result:'Image opened'}} />);
    expect(await screen.findByRole('button',{name:'重试预览'})).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('handles image network/protocol failures with a visible retry instead of broken-image metadata', () => {
    render(<ToolImagePreview item={tool} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'重试预览'}));
    expect(screen.getByRole('img')).toBeTruthy();
  });
  it('ignores a stale local read after the conversation workspace changes', async () => {
    let resolveOld!: (value:{dataUrl:string}) => void;
    const read = bridge(vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce({dataUrl:'data:image/png;base64,BBBB'}));
    const item={...tool,name:'view_image',argumentsJson:'{"path":"input.png"}',result:'Image opened'};
    const {rerender}=render(<ToolImagePreview root="D:/old" item={item} />);
    rerender(<ToolImagePreview root="D:/new" item={item} />);
    await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,BBBB'));
    await act(async()=>resolveOld({dataUrl:src}));
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,BBBB');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('assembles deferred result content before rendering the screenshot', async () => {
    const text=tool.result!;
    const read=vi.spyOn(deferredContentReader,'read').mockResolvedValue({content:{text,offset:0,utf16Length:text.length,utf8Bytes:text.length,version:'a'.repeat(64),format:'json'}});
    render(<ConversationContentScope.Provider value="image-conversation"><ToolImagePreview item={{...tool,result:'{"ok":true,',resultRef:{reference:{source:'event',id:'image-event',path:['result']},utf8Bytes:text.length,utf16Length:text.length,format:'json'}}} /></ConversationContentScope.Provider>);
    expect(await screen.findByRole('img',{name:'浏览器截图'})).toBeTruthy();
    expect(read).toHaveBeenCalledOnce();
    expect(screen.queryByText('JSON')).toBeNull();
  });
  it('assembles deferred input paths for read-image receipts', async () => {
    bridge();
    const text='{"path":"input.png"}';
    vi.spyOn(deferredContentReader,'read').mockResolvedValue({content:{text,offset:0,utf16Length:text.length,utf8Bytes:text.length,version:'b'.repeat(64),format:'json'}});
    render(<ConversationContentScope.Provider value="image-input-conversation"><ToolImagePreview root="D:/workspace" item={{...tool,name:'view_image',result:'Image opened',argumentsJson:'{"path":',argumentsRef:{reference:{source:'event',id:'image-input-event',path:['argumentsJson']},utf8Bytes:text.length,utf16Length:text.length,format:'json'}}} /></ConversationContentScope.Provider>);
    expect(await screen.findByRole('img',{name:'图片输入'})).toBeTruthy();
  });
});
