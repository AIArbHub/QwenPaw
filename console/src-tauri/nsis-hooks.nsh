!include LogicLib.nsh
!include nsDialogs.nsh

Var AIArbCliPathCheckbox
Var AIArbCliPathState

Page custom AIARB_CLI_PATH_PAGE AIARB_CLI_PATH_PAGE_LEAVE

!macro AIARB_UPDATE_CLI_PATH ACTION
  InitPluginsDir
  File /oname=$PLUGINSDIR\aiarb-update-path.ps1 "..\..\..\..\nsis\update-aiarb-path.ps1"
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\aiarb-update-path.ps1" -Action "${ACTION}" -Path "$INSTDIR\binaries\aiarb-backend"`
  Pop $0
  Pop $1
!macroend

!macro AIARB_ADD_CLI_PATH_IF_SELECTED
  ${If} $AIArbCliPathState == 0
    DetailPrint "$(aiarbCliPathSkipped)"
  ${Else}
    IfFileExists "$INSTDIR\binaries\aiarb-backend\aiarb.exe" 0 aiarb_cli_path_missing
    !insertmacro AIARB_UPDATE_CLI_PATH "Add"
    ${If} $0 == 0
      DetailPrint "$(aiarbCliPathAdded)"
    ${Else}
      DetailPrint "$(aiarbCliPathUpdateFailed)"
      DetailPrint "$1"
    ${EndIf}
    Goto aiarb_cli_path_done
    aiarb_cli_path_missing:
      DetailPrint "$(aiarbCliPathMissing)"
    aiarb_cli_path_done:
  ${EndIf}
!macroend

!macro AIARB_REMOVE_CLI_PATH
  !insertmacro AIARB_UPDATE_CLI_PATH "Remove"
  ${If} $0 != 0
    DetailPrint "$(aiarbCliPathUpdateFailed)"
    DetailPrint "$1"
  ${EndIf}
!macroend

!macro AIARB_INSTALL_DEBUG_LAUNCHER
  SetOutPath "$INSTDIR"
  File /oname=aiarb-desktop-debug.cmd "..\..\..\..\nsis\aiarb-desktop-debug.cmd"
  File /oname=aiarb-desktop-debug.ps1 "..\..\..\..\nsis\aiarb-desktop-debug.ps1"
  CreateShortcut "$SMPROGRAMS\AIArb Desktop (Debug).lnk" "$INSTDIR\aiarb-desktop-debug.cmd" "" "$INSTDIR\aiarb-desktop.exe" 0
!macroend

!macro AIARB_REMOVE_DEBUG_LAUNCHER
  Delete "$SMPROGRAMS\AIArb Desktop (Debug).lnk"
  Delete "$INSTDIR\aiarb-desktop-debug.cmd"
  Delete "$INSTDIR\aiarb-desktop-debug.ps1"
!macroend

Function AIARB_CLI_PATH_PAGE
  ${GetOptions} $CMDLINE "/NO_AIARB_PATH" $0
  ${IfNot} ${Errors}
    StrCpy $AIArbCliPathState 0
    Abort
  ${EndIf}

  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    StrCpy $AIArbCliPathState 1
    Abort
  ${EndIf}

  ${If} ${Silent}
    StrCpy $AIArbCliPathState 1
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(aiarbCliPathPageTitle)" "$(aiarbCliPathPageSubtitle)"
  ${NSD_CreateLabel} 0 0 100% 28u "$(aiarbCliPathPageDescription)"
  Pop $0
  ${NSD_CreateCheckbox} 0 44u 100% 12u "$(aiarbCliPathCheckbox)"
  Pop $AIArbCliPathCheckbox

  ${If} $AIArbCliPathState == 0
    SendMessage $AIArbCliPathCheckbox ${BM_SETCHECK} 0 0
  ${Else}
    SendMessage $AIArbCliPathCheckbox ${BM_SETCHECK} 1 0
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function AIARB_CLI_PATH_PAGE_LEAVE
  ${NSD_GetState} $AIArbCliPathCheckbox $AIArbCliPathState
FunctionEnd

!macro AIARB_DEFINE_INSTALL_FUNCTIONS PREFIX
Function ${PREFIX}AIARB_RESTORE_INSTALL_STATE
  Push $0
  Push $1
  IfFileExists "$PLUGINSDIR\aiarb-manage-install-processes.ps1" 0 aiarb_restore_done
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\aiarb-manage-install-processes.ps1" -InstallDir "$INSTDIR" -Action Restore`
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$(qwenpawRestoreInstallStateFailed)"
    DetailPrint "$1"
  ${EndIf}
  qwenpaw_restore_done:
  Pop $1
  Pop $0
FunctionEnd

Function ${PREFIX}QWENPAW_PREPARE_INSTALL
  Push $0
  Push $1
  Push $2
  InitPluginsDir
  File /oname=$PLUGINSDIR\aiarb-manage-install-processes.ps1 "..\..\..\..\nsis\manage-install-processes.ps1"
  System::Call 'kernel32::GetCurrentProcessId() i .r2'

  aiarb_prepare_retry:
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\aiarb-manage-install-processes.ps1" -InstallDir "$INSTDIR" -NsisProcessId $2`
  Pop $0
  Pop $1
  ${If} $0 == 0
    Goto aiarb_prepare_done
  ${Else}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(aiarbStopProcessesPrompt)$\n$\n$1" /SD IDCANCEL IDRETRY aiarb_prepare_retry IDCANCEL aiarb_prepare_cancel
  ${EndIf}

  aiarb_prepare_cancel:
  Call ${PREFIX}AIARB_RESTORE_INSTALL_STATE
  Quit

  aiarb_prepare_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macroend

!insertmacro QWENPAW_DEFINE_INSTALL_FUNCTIONS ""
!insertmacro QWENPAW_DEFINE_INSTALL_FUNCTIONS "un."

!macro NSIS_HOOK_PREINSTALL
  Call AIARB_PREPARE_INSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Call AIARB_RESTORE_INSTALL_STATE
  !insertmacro AIARB_ADD_CLI_PATH_IF_SELECTED
  !insertmacro AIARB_INSTALL_DEBUG_LAUNCHER
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Call un.AIARB_PREPARE_INSTALL
  !insertmacro AIARB_REMOVE_DEBUG_LAUNCHER
  !insertmacro AIARB_REMOVE_CLI_PATH
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Call un.QWENPAW_RESTORE_INSTALL_STATE
!macroend
