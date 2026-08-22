!include LogicLib.nsh
!include nsDialogs.nsh

Var AIARBCliPathCheckbox
Var AIARBCliPathState

Page custom AIARB_CLI_PATH_PAGE AIARB_CLI_PATH_PAGE_LEAVE

!macro AIARB_EXEC_POWERSHELL ARGS
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass ${ARGS}`
  Pop $0
  Pop $1
  ${If} $0 == "error"
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass ${ARGS}`
    Pop $0
    Pop $1
  ${EndIf}
!macroend

!macro AIARB_UPDATE_CLI_PATH ACTION
  InitPluginsDir
  File /oname=$PLUGINSDIR\AIARB-update-path.ps1 "..\..\..\..\nsis\update-AIARB-path.ps1"
  !insertmacro AIARB_EXEC_POWERSHELL `-File "$PLUGINSDIR\AIARB-update-path.ps1" -Action "${ACTION}" -Path "$INSTDIR\binaries\AIARB-backend"`
!macroend

!macro AIARB_ADD_CLI_PATH_IF_SELECTED
  ${If} $AIARBCliPathState == 0
    DetailPrint "$(AIARBCliPathSkipped)"
  ${Else}
    IfFileExists "$INSTDIR\binaries\AIARB-backend\AIARB.exe" 0 AIARB_cli_path_missing
    !insertmacro AIARB_UPDATE_CLI_PATH "Add"
    ${If} $0 == 0
      DetailPrint "$(AIARBCliPathAdded)"
    ${Else}
      DetailPrint "$(AIARBCliPathUpdateFailed)"
      DetailPrint "$1"
    ${EndIf}
    Goto AIARB_cli_path_done
    AIARB_cli_path_missing:
      DetailPrint "$(AIARBCliPathMissing)"
    AIARB_cli_path_done:
  ${EndIf}
!macroend

!macro AIARB_REMOVE_CLI_PATH
  !insertmacro AIARB_UPDATE_CLI_PATH "Remove"
  ${If} $0 != 0
    DetailPrint "$(AIARBCliPathUpdateFailed)"
    DetailPrint "$1"
  ${EndIf}
!macroend

!macro AIARB_INSTALL_DEBUG_LAUNCHER
  SetOutPath "$INSTDIR"
  File /oname=AIARB-desktop-debug.cmd "..\..\..\..\nsis\AIARB-desktop-debug.cmd"
  File /oname=AIARB-desktop-debug.ps1 "..\..\..\..\nsis\AIARB-desktop-debug.ps1"
  CreateShortcut "$SMPROGRAMS\AIARB Desktop (Debug).lnk" "$INSTDIR\AIARB-desktop-debug.cmd" "" "$INSTDIR\AIARB-desktop.exe" 0
!macroend

!macro AIARB_REMOVE_DEBUG_LAUNCHER
  Delete "$SMPROGRAMS\AIARB Desktop (Debug).lnk"
  Delete "$INSTDIR\AIARB-desktop-debug.cmd"
  Delete "$INSTDIR\AIARB-desktop-debug.ps1"
!macroend

Function AIARB_CLI_PATH_PAGE
  ${GetOptions} $CMDLINE "/NO_AIARB_PATH" $0
  ${IfNot} ${Errors}
    StrCpy $AIARBCliPathState 0
    Abort
  ${EndIf}

  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    StrCpy $AIARBCliPathState 1
    Abort
  ${EndIf}

  ${If} ${Silent}
    StrCpy $AIARBCliPathState 1
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(AIARBCliPathPageTitle)" "$(AIARBCliPathPageSubtitle)"
  ${NSD_CreateLabel} 0 0 100% 28u "$(AIARBCliPathPageDescription)"
  Pop $0
  ${NSD_CreateCheckbox} 0 44u 100% 12u "$(AIARBCliPathCheckbox)"
  Pop $AIARBCliPathCheckbox

  ${If} $AIARBCliPathState == 0
    SendMessage $AIARBCliPathCheckbox ${BM_SETCHECK} 0 0
  ${Else}
    SendMessage $AIARBCliPathCheckbox ${BM_SETCHECK} 1 0
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function AIARB_CLI_PATH_PAGE_LEAVE
  ${NSD_GetState} $AIARBCliPathCheckbox $AIARBCliPathState
FunctionEnd

!macro AIARB_DEFINE_INSTALL_FUNCTIONS PREFIX
Function ${PREFIX}AIARB_RESTORE_INSTALL_STATE
  Push $0
  Push $1
  IfFileExists "$PLUGINSDIR\AIARB-manage-install-processes.ps1" 0 AIARB_restore_done
  !insertmacro AIARB_EXEC_POWERSHELL `-File "$PLUGINSDIR\AIARB-manage-install-processes.ps1" -InstallDir "$INSTDIR" -Action Restore`
  ${If} $0 != 0
    DetailPrint "$(AIARBRestoreInstallStateFailed)"
    DetailPrint "$1"
  ${EndIf}
  AIARB_restore_done:
  Pop $1
  Pop $0
FunctionEnd

Function ${PREFIX}AIARB_PREPARE_INSTALL
  Push $0
  Push $1
  Push $2
  InitPluginsDir
  File /oname=$PLUGINSDIR\AIARB-manage-install-processes.ps1 "..\..\..\..\nsis\manage-install-processes.ps1"
  System::Call 'kernel32::GetCurrentProcessId() i .r2'

  AIARB_prepare_retry:
  !insertmacro AIARB_EXEC_POWERSHELL `-File "$PLUGINSDIR\AIARB-manage-install-processes.ps1" -InstallDir "$INSTDIR" -NsisProcessId $2`
  ${If} $0 == 0
    Goto AIARB_prepare_done
  ${Else}
    ${If} $0 == "error"
      StrCpy $1 "$(AIARBPowerShellStartFailed)$\n$\n$1"
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(AIARBPrepareInstallFailed)$\n$\n$1" /SD IDCANCEL IDRETRY AIARB_prepare_retry IDCANCEL AIARB_prepare_cancel
  ${EndIf}

  AIARB_prepare_cancel:
  Call ${PREFIX}AIARB_RESTORE_INSTALL_STATE
  Quit

  AIARB_prepare_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macroend

!insertmacro AIARB_DEFINE_INSTALL_FUNCTIONS ""
!insertmacro AIARB_DEFINE_INSTALL_FUNCTIONS "un."

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
  Call un.AIARB_RESTORE_INSTALL_STATE
!macroend
