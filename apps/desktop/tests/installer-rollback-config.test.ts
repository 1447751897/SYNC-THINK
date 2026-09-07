import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const desktopRoot = join(__dirname, '..');

describe('Windows installer rollback archive contract', () => {
  it('archives versioned installers beside the electron-updater cache without replacing its baseline', () => {
    const configuration = JSON.parse(
      readFileSync(join(desktopRoot, 'electron-builder.json'), 'utf8'),
    ) as {
      nsis?: { include?: string; deleteAppDataOnUninstall?: boolean };
    };
    const include = readFileSync(join(desktopRoot, 'build/installer.nsh'), 'utf8');

    expect(configuration.nsis?.include).toBe('apps/desktop/build/installer.nsh');
    expect(configuration.nsis?.deleteAppDataOnUninstall).toBe(false);
    expect(include).toContain('${APP_INSTALLER_STORE_FILE}');
    expect(include).toContain('recovery\\installers\\${VERSION}');
    expect(include).toContain('installer.exe.pending');
    expect(include).toContain('MoveFileExW');
    expect(include).toContain("i .R4'");
    expect(include).not.toContain("i .r4'");
    expect(include).toContain('ShowInstDetails show');
    expect(include).toContain('SetDetailsPrint both');
    expect(include).toContain('${ifNot} ${isUpdated}');
    expect(include).not.toContain('!define APP_INSTALLER_STORE_FILE');
  });
});
