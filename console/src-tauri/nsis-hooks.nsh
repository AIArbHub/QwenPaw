!include LogicLib.nsh
!include nsDialogs.nsh

BrandingText "AI Arb Desktop"

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

!macro AIARB_STOP_BACKEND_SIDECAR
  ; The Python backend is a Tauri sidecar, not a user-facing window. A leftover
  ; (possibly orphaned, see #5550) backend keeps its PyInstaller ``.pyd`` modules
  ; memory-mapped, which locks them on Windows. The installer then fails to
  ; overwrite those files and shows the cryptic native "can't write file"
  ; abort/retry/ignore dialog.
  ;
  ; The helper stops only backend processes whose executable lives under
  ; $INSTDIR, so a coexisting AIArb install is left untouched. It is
  ; ConstrainedLanguage-safe (WDAC/AppLocker): no ``[System.*]`` static calls,
  ; which throw in that mode and made the previous helper give up silently. It
  ; exits non-zero while a scoped backend is still running; if that persists we
  ; surface a friendly retry prompt rather than the raw OS dialog.
  Push $0
  InitPluginsDir
  File /oname=$PLUGINSDIR\aiarb-stop-backend-sidecar.ps1 "..\..\..\..\nsis\stop-backend-sidecar.ps1"
  ${Do}
    nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\aiarb-stop-backend-sidecar.ps1" -InstallDir "$INSTDIR"`
    Pop $0
    ${If} $0 == 0
      ${ExitDo}
    ${EndIf}
    ; Still running (or could not be stopped). Ask the user; default to Cancel
    ; for silent installs.
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(aiarbStopBackendPrompt)" /SD IDCANCEL IDRETRY +2
    Quit
  ${Loop}
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AIARB_STOP_BACKEND_SIDECAR
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro AIARB_ADD_CLI_PATH_IF_SELECTED
  !insertmacro AIARB_INSTALL_DEBUG_LAUNCHER
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AIARB_STOP_BACKEND_SIDECAR
  !insertmacro AIARB_REMOVE_DEBUG_LAUNCHER
  !insertmacro AIARB_REMOVE_CLI_PATH
!macroend