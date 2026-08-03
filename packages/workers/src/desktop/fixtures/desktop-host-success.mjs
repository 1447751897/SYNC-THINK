import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocolVersion: 1, pid: process.pid }));
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of reader) {
  const request = JSON.parse(line);
  console.log(
    JSON.stringify({
      type: 'response',
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: {
        kind: 'probe',
        backend: 'uia-com',
        platform: 'win32',
        architecture: 'x64',
        rootAvailable: true,
      },
    }),
  );
  break;
}
