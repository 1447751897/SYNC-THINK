import { writeFileSync } from 'node:fs';

const markerPath = process.argv[2];
if (!markerPath) process.exit(2);
writeFileSync(markerPath, String(process.pid), 'utf8');
setInterval(() => {}, 60_000);
