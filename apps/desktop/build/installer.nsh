!macro customInstall
  ; Keep the updater cache installer intact for differential updates and archive
  ; the installer that just produced this healthy version for one-shot rollback.
  ${StdUtils.GetParentPath} $R0 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  StrCpy $R1 "$R0\recovery\installers\${VERSION}"
  StrCpy $R2 "$R1\installer.exe.pending"
  StrCpy $R3 "$R1\installer.exe"
  CreateDirectory "$R1"
  Delete "$R2"
  ClearErrors
  CopyFiles /SILENT "$EXEPATH" "$R2"
  ${If} ${Errors}
    Abort "Failed to archive the installer for automatic rollback."
  ${EndIf}
  System::Call 'kernel32::MoveFileExW(w "$R2", w "$R3", i 0x9) i .r4'
  ${If} $R4 = 0
    Delete "$R2"
    Abort "Failed to publish the installer archive for automatic rollback."
  ${EndIf}
!macroend

!macro customUnInstall
  ; An update invokes the uninstaller as part of replacement. Preserve rollback
  ; state in that path and remove it only for an explicit user uninstall.
  ${ifNot} ${isUpdated}
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ${StdUtils.GetParentPath} $R0 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    RMDir /r "$R0\recovery"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endIf}
!macroend