import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MAX_PROJECT_IMAGE_BYTES, readProjectImage } from './project-image-preview.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yVIAAAAASUVORK5CYII=', 'base64');
let base: string; let root: string;
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'sync-think-image-')); root = join(base, 'workspace'); await mkdir(root); await writeFile(join(root,'input.png'), png); });
afterEach(async () => { if (dirname(resolve(base)) !== resolve(tmpdir()) || !basename(base).startsWith('sync-think-image-')) throw new Error('Invalid test cleanup path'); await rm(base, { recursive:true, force:true }); });
describe('scoped project image preview', () => {
  it('reads a verified workspace PNG as raster bytes', async () => expect(await readProjectImage({root,path:'input.png'})).toEqual({dataUrl:'data:image/png;base64,'+png.toString('base64')}));
  it('supports absolute paths inside the same workspace', async () => expect((await readProjectImage({root,path:join(root,'input.png')})).dataUrl).toBeTruthy());
  it.each([undefined, null, {}, {root:1,path:'x'}, {root:'',path:'x'}, {root:'x',path:''}])('rejects malformed input %j', async value => expect(await readProjectImage(value)).toEqual({error:'invalid_request'}));
  it('rejects traversal outside the workspace', async () => { await writeFile(join(base,'outside.png'),png); expect(await readProjectImage({root,path:'../outside.png'})).toEqual({error:'outside_workspace'}); });
  it('rejects symlink/junction escapes', async () => { const outside=join(base,'outside'); await mkdir(outside); await writeFile(join(outside,'image.png'),png); await symlink(outside,join(root,'link'),'junction'); expect(await readProjectImage({root,path:'link/image.png'})).toEqual({error:'outside_workspace'}); });
  it('rejects renamed non-image content and mismatched extensions', async () => { await writeFile(join(root,'not-image.png'),'secret text'); await writeFile(join(root,'mismatch.jpg'),png); expect(await readProjectImage({root,path:'not-image.png'})).toEqual({error:'unsupported_image'}); expect(await readProjectImage({root,path:'mismatch.jpg'})).toEqual({error:'unsupported_image'}); });
  it('rejects excessive size before reading', async () => { await writeFile(join(root,'large.png'),Buffer.alloc(MAX_PROJECT_IMAGE_BYTES+1)); expect(await readProjectImage({root,path:'large.png'})).toEqual({error:'image_too_large'}); });
  it('reports missing images without revealing a stack or file contents', async () => expect(await readProjectImage({root,path:'missing.png'})).toEqual({error:'image_not_found'}));
});
