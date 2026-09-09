import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const MACOS_APP_ID = 'com.syncthink.desktop';
export const MACOS_ARCH = 'arm64';

export function macosLaunchAgentPath(home = homedir()) {
  return join(home, 'Library', 'LaunchAgents', `${MACOS_APP_ID}.daemon.plist`);
}

export function createMacosLaunchAgentPlist(input) {
  const values = [input.nodePath, input.daemonEntry, '--bootstrap', input.bootstrapPath];
  const xml = values.map((value) => `<string>${escapeXml(resolve(value))}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${MACOS_APP_ID}.daemon</string><key>ProgramArguments</key><array>${xml}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${escapeXml(input.stdoutPath)}</string><key>StandardErrorPath</key><string>${escapeXml(input.stderrPath)}</string></dict></plist>\n`;
}

export function writeMacosLaunchAgent(input) {
  const path = input.path ?? macosLaunchAgentPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, createMacosLaunchAgentPlist(input), { encoding: 'utf8', mode: 0o600 });
  return path;
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  if (!existsSync('apps/desktop/electron-builder.json')) throw new Error('desktop builder config missing');
  console.log(`[macos-release] target=${MACOS_ARCH} appId=${MACOS_APP_ID}`);
}
