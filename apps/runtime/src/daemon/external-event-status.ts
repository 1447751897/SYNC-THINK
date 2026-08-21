import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDaemonBootstrap } from './bootstrap.js';
import { getExternalEventStatusFromDaemon } from './external-event-client.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bootstrapIndex = args.indexOf('--bootstrap');
  const bootstrapPath =
    process.env.SYNC_THINK_DAEMON_BOOTSTRAP ??
    (bootstrapIndex >= 0 ? args[bootstrapIndex + 1] : undefined);
  if (bootstrapPath) await applyDaemonBootstrap(bootstrapPath);
  const eventId = args.find((value, index) => {
    if (value.startsWith('--')) return false;
    return bootstrapIndex < 0 || index !== bootstrapIndex + 1;
  });
  if (!eventId) throw new Error('event id is required');
  const result = await getExternalEventStatusFromDaemon(
    {
      installId: process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001',
      helloSecret: process.env.SYNC_THINK_PIPE_SECRET,
      appVersion: 'sync-think-external-event-cli',
      timeoutMs: 10_000,
      handshakeTimeoutMs: 5_000,
    },
    { eventId },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
