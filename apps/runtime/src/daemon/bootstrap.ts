import { readFile } from 'node:fs/promises';
import { createPowerShellDpapiBridge } from '@sync-think/secure-store';

export interface DaemonBootstrap {
  version: 1;
  installId: string;
  dbPath: string;
  allowNoToken: boolean;
  /** DPAPI ciphertext encoded as base64; the plaintext secret never lives in the file. */
  pipeSecretCiphertext?: string;
}

/** Load the protected login-task configuration into the daemon process environment. */
export async function applyDaemonBootstrap(path: string): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const value = JSON.parse(raw) as Partial<DaemonBootstrap>;
  if (
    value.version !== 1 ||
    typeof value.installId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(value.installId) ||
    typeof value.dbPath !== 'string' ||
    value.dbPath.length === 0 ||
    typeof value.allowNoToken !== 'boolean'
  ) {
    throw new Error('invalid daemon bootstrap');
  }

  process.env.SYNC_THINK_INSTALL_ID = value.installId;
  process.env.SYNC_THINK_DB_PATH = value.dbPath;
  process.env.SYNC_THINK_DEV_NO_TOKEN = value.allowNoToken ? '1' : '0';
  delete process.env.SYNC_THINK_PIPE_SECRET;
  if (value.pipeSecretCiphertext) {
    const bridge = createPowerShellDpapiBridge();
    process.env.SYNC_THINK_PIPE_SECRET = (await bridge.unprotect(value.pipeSecretCiphertext)).toString('utf8');
  }
}
