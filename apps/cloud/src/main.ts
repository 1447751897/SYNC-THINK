import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readCloudConfig } from './config.js';
import { startCloudServer } from './server.js';

async function main(): Promise<void> {
  const envFile = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envFile)) loadEnvFile(envFile);
  const config = readCloudConfig();
  const server = await startCloudServer(config, {
    onLog: (event) => console.error(`[cloud] ${event}`),
  });
  console.log(`[cloud] listening at ${server.url}`);
  console.log(`[cloud] public origin ${config.origin}`);
  if (!config.secret)
    console.log('[cloud] website preview; account service awaits CLOUD_AUTH_SECRET');
  else if (!config.smtp)
    console.log('[cloud] account service ready; email actions await SMTP configuration');
  else
    console.log(
      `[cloud] account service ready; registration ${config.allowSignup ? 'open' : 'closed'}`,
    );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server
      .close()
      .then(() => process.exit(0))
      .catch(() => {
        console.error('[cloud] shutdown_failed');
        process.exit(1);
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error && /^(CLOUD_|SMTP requires)/.test(error.message)
      ? error.message
      : 'Check configuration, database access, and installed dependencies.';
  console.error(`[cloud] startup_failed: ${message}`);
  process.exitCode = 1;
});
