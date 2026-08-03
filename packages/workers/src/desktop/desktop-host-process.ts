import readline from 'node:readline';
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  parseDesktopHostRequest,
  type DesktopHostFailureResponse,
} from './desktop-contract.js';
import { executeDesktopHostRequest } from './desktop-host-runtime.js';
import { KoffiUiaDriver } from './koffi-uia-driver.js';

const parentPid = parseParentPid(process.argv);
const parentMonitor = setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    process.exit(1);
  }
}, 1_000);
parentMonitor.unref();

writeMessage({
  type: 'ready',
  protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
  pid: process.pid,
});

const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let handled = false;
for await (const line of reader) {
  if (handled || !line.trim()) continue;
  handled = true;
  try {
    const request = parseDesktopHostRequest(JSON.parse(line));
    writeMessage(await executeDesktopHostRequest(request, new KoffiUiaDriver()));
  } catch {
    const failure: DesktopHostFailureResponse = {
      type: 'response',
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      requestId: 'invalid-request',
      ok: false,
      error: {
        code: 'desktop.protocol-malformed',
        message: 'Desktop host request was malformed',
        failureClass: 'acceptance',
      },
    };
    writeMessage(failure);
  }
  break;
}
reader.close();

function parseParentPid(args: readonly string[]): number {
  const index = args.indexOf('--parent-pid');
  const value = index >= 0 ? Number(args[index + 1]) : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) process.exit(2);
  return value;
}

function writeMessage(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
