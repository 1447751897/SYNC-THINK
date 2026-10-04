import { describe, expect, it } from 'vitest';
import { embeddedBrowserSessionInfo } from './browser-session-info.js';
describe('embedded profile metadata',()=>{
  const guest={getType:()=> 'webview',hostWebContents:{id:10},session:{isPersistent:()=>true,getStoragePath:()=> 'C:/fixture/Partitions/browser-panel'}};
  it('returns the actual session directory and persistence, without reading cookies or credentials',()=>{
    expect(embeddedBrowserSessionInfo(guest,10)).toEqual({engine:'electron-webview',persistent:true,storagePath:'C:/fixture/Partitions/browser-panel'});
  });
  it('identifies a legacy in-memory session instead of claiming a disk profile',()=>{
    expect(embeddedBrowserSessionInfo({...guest,session:{isPersistent:()=>false,getStoragePath:()=>null}},10)).toMatchObject({persistent:false,storagePath:null});
  });
  it('rejects a guest belonging to a different window',()=>expect(()=>embeddedBrowserSessionInfo(guest,11)).toThrow('does not belong'));
});
