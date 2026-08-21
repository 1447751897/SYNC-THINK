import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExternalEventEnvelope } from '@sync-think/shared';
import { applyDaemonBootstrap } from './bootstrap.js';
import { submitExternalEventToDaemon } from './external-event-client.js';
import { encodeExternalEventSubmit, parseExternalEventFrame } from './external-event-protocol.js';

export function parseExternalEventDocument(value: unknown): ExternalEventEnvelope {
  const parsed = parseExternalEventFrame({
    id: 'external-event-cli-validate',
    kind: 'request',
    type: 'external.event.submit',
    payload: value,
  });
  if (!parsed.ok || parsed.frame.type !== 'external.event.submit') {
    throw new Error(parsed.ok ? 'invalid external event document' : parsed.error);
  }
  return parsed.frame.payload;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bootstrapIndex = args.indexOf('--bootstrap');
  const bootstrapPath =
    process.env.SYNC_THINK_DAEMON_BOOTSTRAP ??
    (bootstrapIndex >= 0 ? args[bootstrapIndex + 1] : undefined);
  if (bootstrapPath) await applyDaemonBootstrap(bootstrapPath);

  const fileArg = args.find((value, index) => {
    if (value.startsWith('--')) return false;
    return bootstrapIndex < 0 || index !== bootstrapIndex + 1;
  });
  const raw = fileArg ? await readFile(resolve(fileArg), 'utf8') : await readStdin();
  const event = parseExternalEventDocument(JSON.parse(raw) as unknown);
  // Build once locally as an additional assertion that the document remains
  // encodable before touching the daemon pipe.
  encodeExternalEventSubmit(event);
  const result = await submitExternalEventToDaemon(
    {
      installId: process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001',
      helloSecret: process.env.SYNC_THINK_PIPE_SECRET,
      appVersion: 'sync-think-external-event-cli',
      timeoutMs: 10_000,
      handshakeTimeoutMs: 5_000,
    },
    event,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok || !result.accepted) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
