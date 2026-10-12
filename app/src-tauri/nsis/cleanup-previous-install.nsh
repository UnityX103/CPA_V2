!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
    ReadRegStr $R0 SHCTX "${MANUPRODUCTKEY}" ""
    ReadRegStr $R1 SHCTX "${UNINSTKEY}" "InstallLocation"
    ReadRegStr $R2 SHCTX "${UNINSTKEY}" "UninstallString"
    ReadRegStr $R3 SHCTX "${UNINSTKEY}" "MainBinaryName"

    ${StrCase} $R4 $R0 "L"
    ${StrCase} $R5 $INSTDIR "L"
    StrCpy $R6 $R4 3
    StrCpy $R7 $WINDIR 3
    ${StrCase} $R7 $R7 "L"

    ${If} $R0 != ""
    ${AndIf} $R4 != $R5
    ${AndIf} $R6 == $R7
    ${AndIf} $R1 == "$\"$R0$\""
    ${AndIf} $R2 == "$\"$R0\uninstall.exe$\""
    ${AndIf} $R3 == "${MAINBINARYNAME}.exe"
    ${AndIf} ${FileExists} "$R0\uninstall.exe"
    ${AndIf} ${FileExists} "$R0\${MAINBINARYNAME}.exe"
      ; The old uninstaller removes only its own files; /UPDATE preserves app data and shortcuts.
      ExecWait '"$R0\uninstall.exe" /S /UPDATE _?=$R0' $R8
      ${If} $R8 <> 0
      ${OrIf} ${FileExists} "$R0\${MAINBINARYNAME}.exe"
        Abort "$(unableToUninstall)"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
