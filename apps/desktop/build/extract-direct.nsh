!macro extractUsing7za FILE
  Push $R0
  InitPluginsDir
  SetDetailsPrint both
  DetailPrint "Extracting application files directly to the installation folder..."
  File /oname=$PLUGINSDIR\sync-think-7za.exe "${SYNC_THINK_7ZA}"
  File /oname=$PLUGINSDIR\7zip-LICENSE.txt "${SYNC_THINK_7ZA_LICENSE}"
  File /oname=$PLUGINSDIR\7zip-COPYING "${SYNC_THINK_7ZA_COPYING}"
  nsExec::ExecToLog '"$PLUGINSDIR\sync-think-7za.exe" x -y -aoa -bb0 -bd -o"$INSTDIR" "${FILE}"'
  Pop $R0
  ${If} $R0 != 0
    DetailPrint "Application extraction failed (7-Zip exit: $R0). Check free space, write permission and files in use."
    SetErrorLevel 2
    Abort "Application files were not fully extracted. Close the application, check disk space and retry the installer."
  ${EndIf}
  DetailPrint "Application extraction completed."
  Pop $R0
!macroend
