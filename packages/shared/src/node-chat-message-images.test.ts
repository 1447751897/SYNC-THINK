import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveChatMessageImageDirectories } from './node-chat-message-images.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-image-roots-')); roots.push(root);
  const desktop = join(root, 'apps', 'desktop'); mkdirSync(desktop, {recursive:true});
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []');
  writeFileSync(join(desktop, 'package.json'), '{}');
  mkdirSync(join(desktop, '.data'), {recursive:true});
  return {root,desktop};
}
describe('durable chat image directories', () => {
  it('uses the same root from repository, Desktop, and Runtime working directories', () => {
    const {root,desktop} = fixture();
    const expected = [join(root,'.data','SYNC-THINK','message-images'),join(desktop,'.data','SYNC-THINK','message-images')];
    for (const cwd of [root,desktop,join(root,'apps','runtime')]) expect(resolveChatMessageImageDirectories({},cwd)).toEqual(expected);
  });
  it('honors an explicit image root before a database root and retains the known legacy directory', () => {
    const {root,desktop} = fixture();
    const images = join(root,'configured-images');
    expect(resolveChatMessageImageDirectories({SYNC_THINK_CHAT_MESSAGE_IMAGES:images,SYNC_THINK_DB_PATH:join(root,'db','state.db')},desktop)).toEqual([images,join(desktop,'.data','SYNC-THINK','message-images')]);
  });
  it('uses the database directory when configured', () => {
    const {root,desktop} = fixture();
    expect(resolveChatMessageImageDirectories({SYNC_THINK_DB_PATH:join(root,'db','state.db')},desktop)[0]).toBe(join(root,'db','message-images'));
  });
  it('finds the compatibility directory from the configured database when a daemon has an unrelated cwd', () => {
    const {root,desktop} = fixture();
    expect(resolveChatMessageImageDirectories({SYNC_THINK_DB_PATH:join(root,'.data','SYNC-THINK','state.db')},join(parse(tmpdir()).root,'unrelated-runtime-cwd'))).toEqual([join(root,'.data','SYNC-THINK','message-images'),join(desktop,'.data','SYNC-THINK','message-images')]);
  });
  it('does not search arbitrary package-local directories outside a monorepo', () => {
    const root = mkdtempSync(join(tmpdir(),'sync-think-installed-image-roots-')); roots.push(root);
    expect(resolveChatMessageImageDirectories({LOCALAPPDATA:root},join(parse(root).root,'installed-app-cwd'))).toEqual([join(root,'SYNC-THINK','message-images')]);
  });
});
