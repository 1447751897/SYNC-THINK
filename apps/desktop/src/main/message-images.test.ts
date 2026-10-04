import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistMessageImages, readMessageImage, resolveChatMessageImageDir, resolveMessageImagePath } from './message-images.js';
let root: string;
let desktop: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(),'sync-think-desktop-message-images-'));
  desktop = join(root,'apps','desktop'); mkdirSync(desktop,{recursive:true});
  writeFileSync(join(root,'pnpm-workspace.yaml'),'packages: []');
  writeFileSync(join(desktop,'package.json'),'{}');
  mkdirSync(join(desktop,'.data','SYNC-THINK','message-images'),{recursive:true});
  vi.spyOn(process,'cwd').mockReturnValue(desktop);
  vi.stubEnv('SYNC_THINK_DB_PATH',''); vi.stubEnv('SYNC_THINK_CHAT_MESSAGE_IMAGES','');
});
afterEach(() => {vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
describe('durable Desktop message images', () => {
  it('writes new attachments into the shared repository data root, not package-local .data', () => {
    const input = join(root,'input.jpg'); writeFileSync(input,Buffer.from([1,2,3]));
    const image = persistMessageImages('message-new',[{name:'image.jpg',mimeType:'image/jpeg',stagingPath:input}])[0]!;
    expect(resolveChatMessageImageDir()).toBe(join(root,'.data','SYNC-THINK','message-images'));
    expect(image.stagingPath).toBe(join(root,'.data','SYNC-THINK','message-images','message-new-1.jpg'));
    expect(readMessageImage(image.storageRef)?.data).toEqual(Buffer.from([1,2,3]));
  });
  it('keeps old package-local attachments readable without moving or deleting them', () => {
    const old = join(desktop,'.data','SYNC-THINK','message-images','message-old-1.jpg');
    writeFileSync(old,Buffer.from([4,5,6]));
    expect(resolveMessageImagePath('message-old-1.jpg')).toBe(old);
    expect(readMessageImage('message-old-1.jpg')?.data).toEqual(Buffer.from([4,5,6]));
    expect(resolveMessageImagePath('../message-old-1.jpg')).toBeUndefined();
  });
});
