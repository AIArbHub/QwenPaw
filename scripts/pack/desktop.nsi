; AIArb Desktop NSIS installer. Run makensis from repo root after
; building dist/win-unpacked (see scripts/pack/build_win.ps1).
; Usage: makensis /DAIARB_VERSION=1.2.3 /DOUTPUT_EXE=dist\AIArb-Setup-1.2.3.exe scripts\pack\desktop.nsi

!include "MUI2.nsh"
!define MUI_ABORTWARNING
; Use custom icon from unpacked env (copied by build_win.ps1)
!define MUI_ICON "${UNPACKED}\icon.ico"
!define MUI_UNICON "${UNPACKED}\icon.ico"

!ifndef AIARB_VERSION
  !define AIARB_VERSION "0.0.0"
!endif
!ifndef OUTPUT_EXE
  !define OUTPUT_EXE "dist\AIArb-Setup-${AIARB_VERSION}.exe"
!endif

Name "AIArb Desktop"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\AIArb"
InstallDirRegKey HKCU "Software\AIArb" "InstallPath"
RequestExecutionLevel user

; Author / branding shown at the bottom of the NSIS installer window
BrandingText "AI Arb - Sum"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; Pass /DUNPACKED=full_path from build_win.ps1 so path works when cwd != repo root
!ifndef UNPACKED
  !define UNPACKED "dist\win-unpacked"
!endif

Section "AIArb Desktop" SEC01
  SetOutPath "$INSTDIR"
  File /r "${UNPACKED}\*.*"
  WriteRegStr HKCU "Software\AIArb" "InstallPath" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Main shortcut - uses VBS to hide console window
  CreateShortcut "$SMPROGRAMS\AIArb Desktop.lnk" "$INSTDIR\AIArb Desktop.vbs" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$DESKTOP\AIArb Desktop.lnk" "$INSTDIR\AIArb Desktop.vbs" "" "$INSTDIR\icon.ico" 0
  
  ; Debug shortcut - shows console window for troubleshooting
  CreateShortcut "$SMPROGRAMS\AIArb Desktop (Debug).lnk" "$INSTDIR\AIArb Desktop (Debug).bat" "" "$INSTDIR\icon.ico" 0
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\AIArb Desktop.lnk"
  Delete "$SMPROGRAMS\AIArb Desktop (Debug).lnk"
  Delete "$DESKTOP\AIArb Desktop.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\AIArb"
SectionEnd
