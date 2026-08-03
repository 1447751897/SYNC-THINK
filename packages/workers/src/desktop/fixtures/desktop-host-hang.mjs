console.log(JSON.stringify({ type: 'ready', protocolVersion: 1, pid: process.pid }));
process.stdin.resume();
setInterval(() => {}, 1_000);
