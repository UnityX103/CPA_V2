!include LogicLib.nsh
!include StrFunc.nsh
${StrCase}

!include "cleanup-previous-install.nsh"

!define MANUPRODUCTKEY "Software\CPA\桌宠番茄钟"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\桌宠番茄钟"
!define MAINBINARYNAME "app"

Name "Cleanup hook syntax check"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\桌宠番茄钟"
Var UpdateMode
LangString unableToUninstall 1033 "Could not uninstall the previous version"

Section
  !insertmacro NSIS_HOOK_PREINSTALL
SectionEnd
