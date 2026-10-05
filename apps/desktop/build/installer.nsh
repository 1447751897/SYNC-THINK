; Override electron-builder's broad prefix/name scan. Close this installation's
; Desktop + managed daemon trees, but not the installer or unrelated Node jobs.
Var SyncThinkInstallerPid
Var SyncThinkCloseStatus
Var SyncThinkCloseDetails
!define SYNC_THINK_INSTALLER_PROCESS_HELPER "${__FILEDIR__}\installer-processes.ps1"

; Persist phase/return codes independently of the assisted installer's hidden
; details panel. Preserve NSIS error state and registers used by the caller.
!ifndef SYNC_THINK_INSTALLER_LOG_ROOT
  !define SYNC_THINK_INSTALLER_LOG_ROOT "$LOCALAPPDATA\SYNC-THINK\installer-logs"
!endif
Var SyncThinkTraceFile
Var SyncThinkTraceHadErrors
!macro SyncThinkInstallerTrace TEXT
  Push $SyncThinkTraceFile
  Push $SyncThinkTraceHadErrors
  StrCpy $SyncThinkTraceHadErrors 0
  ${If} ${Errors}
    StrCpy $SyncThinkTraceHadErrors 1
  ${EndIf}
  ClearErrors
  CreateDirectory "${SYNC_THINK_INSTALLER_LOG_ROOT}"
  FileOpen $SyncThinkTraceFile "${SYNC_THINK_INSTALLER_LOG_ROOT}\installer.log" a
  ${If} ${Errors}
    ClearErrors
    CreateDirectory "$TEMP\SYNC-THINK-installer-logs"
    FileOpen $SyncThinkTraceFile "$TEMP\SYNC-THINK-installer-logs\installer.log" a
  ${EndIf}
  ${IfNot} ${Errors}
    FileSeek $SyncThinkTraceFile 0 END
    FileWrite $SyncThinkTraceFile "${TEXT}$\r$\n"
    FileClose $SyncThinkTraceFile
  ${EndIf}
  ClearErrors
  ${If} $SyncThinkTraceHadErrors == 1
    SetErrors
  ${EndIf}
  Pop $SyncThinkTraceHadErrors
  Pop $SyncThinkTraceFile
!macroend

!macro customCheckAppRunning
  SetDetailsPrint both
  InitPluginsDir
  File /oname=$PLUGINSDIR\sync-think-installer-processes.ps1 "${SYNC_THINK_INSTALLER_PROCESS_HELPER}"
  System::Call 'kernel32::GetCurrentProcessId() i.s'
  Pop $SyncThinkInstallerPid
  nsExec::ExecToStack /TIMEOUT=45000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\sync-think-installer-processes.ps1" -InstallDirectory "$INSTDIR\." -InstallerProcessId $SyncThinkInstallerPid -Mode Check'
  Pop $SyncThinkCloseStatus
  Pop $SyncThinkCloseDetails
  !insertmacro SyncThinkInstallerTrace "phase=process-check pid=$SyncThinkInstallerPid root=$INSTDIR status=$SyncThinkCloseStatus result=$SyncThinkCloseDetails"
  ${If} $SyncThinkCloseStatus != 0
  ${AndIf} $SyncThinkCloseStatus != 10
    DetailPrint "Installation inspection failed: $SyncThinkCloseStatus $SyncThinkCloseDetails"
    MessageBox MB_OK|MB_ICONSTOP "Installation inspection failed (status $SyncThinkCloseStatus).$\r$\nPath: $INSTDIR$\r$\n$SyncThinkCloseDetails$\r$\nSee $LOCALAPPDATA\SYNC-THINK\installer-logs\installer.log." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $SyncThinkCloseStatus != 0
    DetailPrint "$SyncThinkCloseDetails"
    ${IfNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${EndIf}
    ${Do}
      DetailPrint "Closing this installation's desktop and background task services..."
      nsExec::ExecToStack /TIMEOUT=45000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\sync-think-installer-processes.ps1" -InstallDirectory "$INSTDIR\." -InstallerProcessId $SyncThinkInstallerPid -Mode Stop'
      Pop $SyncThinkCloseStatus
      Pop $SyncThinkCloseDetails
      !insertmacro SyncThinkInstallerTrace "phase=process-stop pid=$SyncThinkInstallerPid root=$INSTDIR status=$SyncThinkCloseStatus result=$SyncThinkCloseDetails"
      DetailPrint "$SyncThinkCloseDetails"
      ${If} $SyncThinkCloseStatus == 0
        ${Break}
      ${EndIf}
      ; Keep files/data intact on inspection, permission, or bounded stop failure.
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 2
      Quit
    ${Loop}
  ${EndIf}
!macroend

!macro customHeader
  ShowInstDetails show
!macroend

!macro customInstall
  SetDetailsPrint both
  ; Keep the updater cache installer intact for differential updates and archive
  ; the installer that just produced this healthy version for one-shot rollback.
  ${StdUtils.GetParentPath} $R0 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  StrCpy $R1 "$R0\recovery\installers\${VERSION}"
  StrCpy $R2 "$R1\installer.exe.pending"
  StrCpy $R3 "$R1\installer.exe"
  DetailPrint "Saving installer recovery archive..."
  CreateDirectory "$R1"
  Delete "$R2"
  ClearErrors
  CopyFiles /SILENT "$EXEPATH" "$R2"
  ${If} ${Errors}
    Abort "Failed to archive the installer for automatic rollback."
  ${EndIf}
  System::Call 'kernel32::MoveFileExW(w "$R2", w "$R3", i 0x9) i .R4'
  ${If} $R4 = 0
    Delete "$R2"
    Abort "Failed to publish the installer archive for automatic rollback."
  ${EndIf}

  DetailPrint "Installer recovery archive saved."
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
