import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_WEB_PAGE_SCHEME,
  LocalWebPageRegistry,
  registerLocalWebPageProtocol,
} from './local-web-page-registry.js';

async function withTempDirectory<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sync-think-local-web-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('LocalWebPageRegistry', () => {
  it('returns a token URL for an HTML file and serves relative assets', async () => {
    await withTempDirectory(async (root) => {
      await mkdir(path.join(root, 'assets'));
      await writeFile(path.join(root, 'index.html'), '<!doctype html><img src="assets/icon.svg">');
      await writeFile(path.join(root, 'assets', 'icon.svg'), '<svg></svg>');
      const registry = new LocalWebPageRegistry();

      const url = await registry.createUrl(path.join(root, 'index.html'));
      expect(url).toMatch(new RegExp(`^${LOCAL_WEB_PAGE_SCHEME}://[^/]+/index\\.html$`));

      const page = await registry.handle(new Request(url!));
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await page.text()).toContain('<img');

      const assetUrl = `${url!.replace(/\/[^/]+$/, '')}/assets/icon.svg`;
      const asset = await registry.handle(new Request(assetUrl));
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toBe('image/svg+xml');
      expect(await asset.text()).toBe('<svg></svg>');
    });
  });

  it('rejects non-HTML entries, unknown tokens, traversal, and unsupported MIME types', async () => {
    await withTempDirectory(async (root) => {
      await writeFile(path.join(root, 'index.html'), '<main>ok</main>');
      await writeFile(path.join(root, 'secret.bin'), 'secret');
      const registry = new LocalWebPageRegistry();
      expect(await registry.createUrl(path.join(root, 'secret.bin'))).toBeNull();
      const url = await registry.createUrl(path.join(root, 'index.html'));
      expect(
        (await registry.handle(new Request('newmax-local-web://unknown/index.html'))).status,
      ).toBe(404);
      expect(
        (await registry.handle(new Request(`${url!.replace(/\/[^/]+$/, '')}/%2e%2e/secret.bin`)))
          .status,
      ).toBe(404);
      expect(
        (await registry.handle(new Request(`${url!.replace(/\/[^/]+$/, '')}/secret.bin`))).status,
      ).toBe(404);
    });
  });

  it('does not serve a symlink that leaves the entry directory', async () => {
    await withTempDirectory(async (root) => {
      const outside = await mkdtemp(path.join(os.tmpdir(), 'sync-think-local-web-outside-'));
      try {
        await writeFile(path.join(root, 'index.html'), '<main>ok</main>');
        await writeFile(path.join(outside, 'secret.txt'), 'secret');
        try {
          await symlink(path.join(outside, 'secret.txt'), path.join(root, 'secret.txt'));
        } catch {
          return;
        }
        const registry = new LocalWebPageRegistry();
        const url = await registry.createUrl(path.join(root, 'index.html'));
        expect(
          (await registry.handle(new Request(`${url!.replace(/\/[^/]+$/, '')}/secret.txt`))).status,
        ).toBe(404);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('registers the handler on the requested session', async () => {
    const calls: Array<{ scheme: string; handler: unknown }> = [];
    const registry = new LocalWebPageRegistry();
    registerLocalWebPageProtocol(
      {
        protocol: {
          handle(scheme, handler) {
            calls.push({ scheme, handler });
          },
        },
      },
      registry,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.scheme).toBe(LOCAL_WEB_PAGE_SCHEME);
    expect(typeof calls[0]?.handler).toBe('function');
  });

  it('persists token mappings so a fresh registry serves a restored page', async () => {
    await withTempDirectory(async (root) => {
      const pageRoot = path.join(root, 'project');
      const statePath = path.join(root, 'user-data', 'browser', 'local-pages', 'partition.json');
      await mkdir(pageRoot);
      await writeFile(path.join(pageRoot, 'index.html'), '<main>restored</main>');

      const first = new LocalWebPageRegistry({ persistencePath: statePath });
      const firstUrl = await first.createUrl(path.join(pageRoot, 'index.html'));
      expect(firstUrl).toMatch(new RegExp(`^${LOCAL_WEB_PAGE_SCHEME}://[^/]+/index\\.html$`));
      expect(await readFile(statePath, 'utf8')).toContain('index.html');

      const restored = new LocalWebPageRegistry({ persistencePath: statePath });
      await restored.waitUntilReady();
      const page = await restored.handle(new Request(firstUrl!));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('restored');
      expect(await restored.createUrl(path.join(pageRoot, 'index.html'))).toBe(firstUrl);
    });
  });

  it('ignores invalid persisted entries without serving outside the recorded root', async () => {
    await withTempDirectory(async (root) => {
      const statePath = path.join(root, 'state.json');
      await writeFile(
        statePath,
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              token: 'too-short',
              entryPath: path.join(root, 'index.html'),
              rootPath: root,
            },
            {
              token: '12345678-1234-1234-1234-123456789012',
              entryPath: path.join(root, '..', 'secret.html'),
              rootPath: root,
            },
          ],
        }),
        'utf8',
      );
      const registry = new LocalWebPageRegistry({ persistencePath: statePath });
      await registry.waitUntilReady();
      expect(
        (
          await registry.handle(
            new Request(
              `${LOCAL_WEB_PAGE_SCHEME}://12345678-1234-1234-1234-123456789012/secret.html`,
            ),
          )
        ).status,
      ).toBe(404);
    });
  });
});
