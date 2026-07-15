import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const requiredMajor = 20;
const actualMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (actualMajor !== requiredMajor) {
  throw new Error(
    `Workspace lifecycle scripts require Node ${requiredMajor}; received ${process.version}`,
  );
}

const nodeDir = dirname(process.execPath);
const pnpmShim = join(nodeDir, process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm');
if (!existsSync(pnpmShim)) {
  const corepackCli = join(nodeDir, 'node_modules', 'corepack', 'dist', 'corepack.js');
  if (!existsSync(corepackCli)) {
    throw new Error(`Corepack is unavailable in the managed Node installation: ${nodeDir}`);
  }
  const result = spawnSync(
    process.execPath,
    [corepackCli, 'enable', '--install-directory', nodeDir, 'pnpm'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`Could not enable the pnpm shim in the managed Node installation: ${nodeDir}`);
  }
}
