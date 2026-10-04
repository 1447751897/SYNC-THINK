import { describe, expect, it } from 'vitest';
import { parseToolImages, toolImageUrl } from './tool-image-content.js';
import { isImagePreviewTool } from './tool-image-kind.js';
const dataUrl = 'data:image/png;base64,AAAA';

describe('tool image content', () => {
  it.each(['browser_screenshot', 'mcp__browser__browser_screenshot', 'functions.view_image', 'view_image', 'mcp__vision__describe_image', 'read_image', 'image_input'])('recognizes %s', name => expect(isImagePreviewTool(name)).toBe(true));
  it.each(['read_file', 'generate_image', 'browser_read', 'not_browser_screenshot', 'view_image_extra'])('leaves %s unchanged', name => expect(isImagePreviewTool(name)).toBe(false));
  it('prefers embedUrl and never treats a page URL or duplicate file path as another image', () => {
    expect(parseToolImages(JSON.stringify({ ok: true, embedUrl: 'sync-think-image://screenshot/capture.png', absolutePath: 'D:/p/.sync-think/screenshots/capture.png', url: 'https://yucoder.cn/index' }), '{}', '浏览器截图')).toEqual([{ src: 'sync-think-image://screenshot/capture.png', alt: '浏览器截图' }]);
    expect(parseToolImages(JSON.stringify({ url: 'https://yucoder.cn/index' }))).toEqual([]);
  });
  it('unwraps MCP images, text-envelope JSON, markdown and multimodal image URLs without duplicates', () => {
    expect(parseToolImages(JSON.stringify({content:[{type:'image',data:'AAAA',mimeType:'image/png'}, {type:'text',text:JSON.stringify({embedUrl:'sync-think-image://media/test'})}, {type:'text',text:'![截图](sync-think-image://media/test)'}, {type:'image_url', image_url:{url:'https://images.test/preview'}}]}))).toEqual([{src:dataUrl,alt:'图片输入'},{src:'sync-think-image://media/test',alt:'图片输入'},{src:'https://images.test/preview',alt:'图片输入'}]);
  });
  it('recognizes Claude-style base64 input blocks', () => {
    expect(parseToolImages(JSON.stringify([{type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}}]))).toEqual([{src:dataUrl,alt:'图片输入'}]);
  });
  it('uses the image input path when the tool only returned a receipt', () => {
    expect(parseToolImages('Image opened', '{"path":"assets/avatar.webp"}')).toEqual([{path:'assets/avatar.webp',alt:'图片输入'}]);
  });
  it.each([
    '.sync-think/conversations/conv-1/images/attachment.jpg',
    'D:/项目/.sync-think/conversations/conv-1/images/attachment.png',
    String.raw`D:\workspace\images\avatar.webp`,
  ])('uses raw image-input paths from execution-process steps: %s', path => {
    expect(parseToolImages('MIME：image/jpeg；通过模型原生视觉输入发送', path)).toEqual([{path,alt:'图片输入'}]);
  });
  it('trims raw local image paths without changing internal spaces', () => {
    expect(parseToolImages('Image opened', '  assets/my avatar.JPEG  ')).toEqual([{path:'assets/my avatar.JPEG',alt:'图片输入'}]);
  });
  it('prefers structured image output over a raw input path', () => {
    expect(parseToolImages(JSON.stringify({embedUrl:dataUrl}), 'assets/input.png')).toEqual([{src:dataUrl,alt:'图片输入'}]);
  });
  it.each(['https://example.test/image.png', '  https://example.test/image.png  ', 'file:///C:/secret.png', 'assets/avatar.svg', '{"path":"image.png"', '{"path":"image.png'])('does not treat unsupported sources or malformed JSON as raw paths: %s', input => {
    expect(parseToolImages('Image opened', input)).toEqual([]);
  });
  it('uses one preferred screenshot path when older output has no embedUrl', () => {
    expect(parseToolImages('{"absolutePath":"D:/p/.sync-think/screenshots/a.png","relativePath":".sync-think/screenshots/a.png"}')).toEqual([{path:'D:/p/.sync-think/screenshots/a.png',alt:'图片输入'}]);
  });
  it('ignores malformed JSON and plain web links instead of creating broken images', () => {
    expect(parseToolImages('{"embedUrl":')).toEqual([]);
    expect(parseToolImages('https://example.test/page')).toEqual([]);
  });
  it.each(['javascript:alert(1)', 'file:///C:/secret.png', 'sync-think-image://local/secret.png', 'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'https://user:pass@example.test/image.png', 'data:image/png;base64,bad$$'])('rejects unsafe image source %s', src => expect(toolImageUrl(src)).toBeUndefined());
  it('bounds image lists', () => {
    expect(parseToolImages(JSON.stringify({images:Array.from({length:100}, (_,i)=>({embedUrl:'https://images.test/'+i}))}))).toHaveLength(16);
  });
});
