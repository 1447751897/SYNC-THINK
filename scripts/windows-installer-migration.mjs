function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) {
    throw new Error('installer.migration_template_changed:' + needle);
  }
  return source.replace(needle, () => replacement);
}

/** rc.8 and the original rc.9 ship their own process-prefix scanner. Updating
 * the new installer alone does not update that legacy uninstaller. Use the
 * signed/generated uninstaller from the same new build for these known layouts.
 * Keep the normal registry lookup, --updated/KEEP_APP_DATA and rollback flow.
 */
export function createLegacyUninstallerMigrationScript(source) {
  let result = replaceOnce(
    source,
    '  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"\n  !insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"',
    [
      '  Var /GLOBAL SyncThinkLegacyUninstallVersion',
      '  Var /GLOBAL SyncThinkUseCurrentUninstaller',
      '  !insertmacro readReg $SyncThinkLegacyUninstallVersion "$rootKey" "${UNINSTALL_REGISTRY_KEY}" DisplayVersion',
      '  StrCpy $SyncThinkUseCurrentUninstaller "false"',
      '  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"',
      '  SetDetailsPrint both',
      '  !insertmacro SyncThinkInstallerTrace "phase=uninstall-start version=$SyncThinkLegacyUninstallVersion root=$installationDir temp=$TEMP"',
      '  ${if} $SyncThinkLegacyUninstallVersion == "0.1.0-rc.8"',
      '  ${orIf} $SyncThinkLegacyUninstallVersion == "0.1.0-rc.9"',
      '    StrCpy $SyncThinkUseCurrentUninstaller "true"',
      '    DetailPrint "Using current uninstaller for legacy SYNC-THINK $SyncThinkLegacyUninstallVersion."',
      '    File /oname=$PLUGINSDIR\\old-uninstaller.exe "${UNINSTALLER_OUT_FILE}"',
      '    !insertmacro SyncThinkInstallerTrace "phase=uninstall-select source=current-build executable=$uninstallerFileNameTemp"',
      '  ${else}',
      '    !insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"',
      '    !insertmacro SyncThinkInstallerTrace "phase=uninstall-select source=registered executable=$uninstallerFileNameTemp"',
      '  ${endif}',
    ].join('\n'),
  );
  result = replaceOnce(
    result,
    '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt',
    '      !insertmacro SyncThinkInstallerTrace "phase=uninstall-failed exit=$R0 root=$installationDir"\n' +
      '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Old-version uninstall failed (exit $R0). See $LOCALAPPDATA\\SYNC-THINK\\installer-logs\\installer.log." /SD IDCANCEL IDRETRY OneMoreAttempt',
  );
  result = replaceOnce(
    result,
    '    TryInPlace:\n      # the execution failed - might have been caused by some group policy restrictions',
    '    TryInPlace:\n' +
      '      !insertmacro SyncThinkInstallerTrace "phase=uninstall-launch-failed executable=$uninstallerFileNameTemp"\n' +
      '      ${if} $SyncThinkUseCurrentUninstaller == "true"\n' +
      '        # Do not silently fall back to the legacy scanner we are migrating.\n' +
      '        Goto DoesNotExist\n' +
      '      ${endif}\n' +
      '      # the execution failed - might have been caused by some group policy restrictions',
  );
  result = replaceOnce(
    result,
    '    CheckResult:\n      ${if} $R0 == 0',
    '    CheckResult:\n      !insertmacro SyncThinkInstallerTrace "phase=uninstall-result exit=$R0 root=$installationDir"\n      ${if} $R0 == 0',
  );
  return replaceOnce(
    result,
    '    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"',
    '    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK',
  );
}

export function createUninstallerDiagnosticScript(source) {
  let result = replaceOnce(
    source,
    'Function un.onInit\n  SetOutPath $INSTDIR',
    'Function un.onInit\n  !insertmacro SyncThinkInstallerTrace "phase=uninstaller-init root=$INSTDIR temp=$TEMP executable=$EXEPATH"\n  SetOutPath $INSTDIR',
  );
  return replaceOnce(
    result,
    '        DetailPrint "File is busy, aborting: $R0"',
    '        !insertmacro SyncThinkInstallerTrace "phase=uninstaller-file-failed file=$R0 temp=$TEMP plugins=$PLUGINSDIR"\n        DetailPrint "File is busy, aborting: $R0"',
  );
}
