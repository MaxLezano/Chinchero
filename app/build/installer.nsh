; Pasos propios del desinstalador (electron-builder incluye este archivo solo). Nada de esto corre en una
; actualización: electron-updater ejecuta el desinstalador anterior con --updated y ahí ${isUpdated} es verdadero.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Ollama solo se quita si lo instaló Chinchero (la app deja esa marca; ver src/main/ollama-setup.js)
    ${if} ${FileExists} "$APPDATA\Chinchero\ollama-de-chinchero"
    ${andIf} ${FileExists} "$LOCALAPPDATA\Programs\Ollama\ollama.exe"
      DetailPrint "Quitando Ollama y sus modelos…"
      nsExec::Exec 'taskkill /im "ollama app.exe" /f /t'
      nsExec::Exec 'taskkill /im "ollama.exe" /f /t'
      nsExec::Exec 'taskkill /im "llama-server.exe" /f /t'
      ; Chinchero lo instala desde el .zip oficial (sin desinstalador); las versiones anteriores, con el instalador
      ${if} ${FileExists} "$LOCALAPPDATA\Programs\Ollama\unins000.exe"
        ExecWait '"$LOCALAPPDATA\Programs\Ollama\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART'
        ; El desinstalador de Ollama sigue desde una copia temporal: se espera a que termine (hasta 2 minutos)
        Var /GLOBAL chWait
        StrCpy $chWait 0
        ${DoWhile} ${FileExists} "$LOCALAPPDATA\Programs\Ollama\unins000.exe"
          Sleep 1000
          IntOp $chWait $chWait + 1
          ${if} $chWait > 120
            ${ExitDo}
          ${endIf}
        ${Loop}
      ${endIf}
      RMDir /r "$LOCALAPPDATA\Programs\Ollama"
      RMDir /r "$PROFILE\.ollama"
      RMDir /r "$LOCALAPPDATA\Ollama"
      Delete "$SMSTARTUP\Ollama.lnk"
      ; Su desinstalador deja la carpeta en el PATH del usuario: se quita esa entrada y nada más
      nsExec::Exec `powershell.exe -NoProfile -NonInteractive -Command "$$k = Get-Item HKCU:\Environment; $$p = $$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$n = ($$p -split ';' | ? { $$_ -notmatch '\\Programs\\Ollama\\?$$' }) -join ';'; if ($$n -ne $$p) { Set-ItemProperty HKCU:\Environment -Name Path -Value $$n -Type ($$k.GetValueKind('Path')) }"`
    ${endIf}

    ; Tableros, copias y ajustes: se pregunta; sin respuesta (desinstalación silenciosa) se conservan
    Var /GLOBAL chData
    StrCpy $chData "$DOCUMENTS\Chinchero"
    ClearErrors
    FileOpen $0 "$APPDATA\Chinchero\carpeta-de-datos.txt" r
    ${ifNot} ${Errors}
      FileReadUTF16LE $0 $1
      FileClose $0
      ${if} $1 != ""
        StrCpy $chData $1
      ${endIf}
    ${endIf}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "¿Quieres conservar tus tableros, copias de seguridad y ajustes de Chinchero?$\r$\n$\r$\nSí: se quedan en tu PC ($chData) y los encontrarás si vuelves a instalar Chinchero.$\r$\nNo: se borran para siempre." /SD IDYES IDYES chKeep
      ; Solo lo que crea Chinchero: la carpeta puede ser una que eligió el usuario y tener otras cosas
      RMDir /r "$chData\boards"
      RMDir /r "$chData\media"
      RMDir /r "$chData\backups"
      Delete "$chData\library.json"
      Delete "$chData\library.json.tmp"
      RMDir "$chData"
      RMDir /r "$APPDATA\Chinchero"
    chKeep:
  ${endIf}
!macroend
