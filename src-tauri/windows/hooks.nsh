; NSIS installer hooks (tauri.conf.json → bundle.windows.nsis.installerHooks)
;
; Windows AutoPlay: di-drop is offered for memory cards with photos/videos ("Bilder importieren – di-drop").
; Once chosen (Settings → Bluetooth & devices → AutoPlay → Memory card, or in the AutoPlay notification),
; Windows starts or activates di-drop instead of opening an Explorer window – and only this way may di-drop
; come to the front. The running di-drop is reached via tauri-plugin-single-instance (src/lib.rs); the card
; itself is picked up by the memory card watcher, the "--sdcard <drive>" argument is just for information.
;
; SHCTX: HKEY_CURRENT_USER with installMode "currentUser". The user's choice itself is never set here.

!define DIDROP_AUTOPLAY "Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers"
!define DIDROP_HANDLER "DiDropImportOnArrival"
!define DIDROP_PROGID "DiDrop.AutoPlay"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${DIDROP_PROGID}\shell\import\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --sdcard "%L"'
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\Handlers\${DIDROP_HANDLER}" "Action" "Bilder importieren"
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\Handlers\${DIDROP_HANDLER}" "Provider" "di-drop"
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\Handlers\${DIDROP_HANDLER}" "DefaultIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\Handlers\${DIDROP_HANDLER}" "InvokeProgID" "${DIDROP_PROGID}"
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\Handlers\${DIDROP_HANDLER}" "InvokeVerb" "import"
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\EventHandlers\ShowPicturesOnArrival" "${DIDROP_HANDLER}" ""
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\EventHandlers\PlayVideoFilesOnArrival" "${DIDROP_HANDLER}" ""
  WriteRegStr SHCTX "${DIDROP_AUTOPLAY}\EventHandlers\MixedContentOnArrival" "${DIDROP_HANDLER}" ""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue SHCTX "${DIDROP_AUTOPLAY}\EventHandlers\ShowPicturesOnArrival" "${DIDROP_HANDLER}"
  DeleteRegValue SHCTX "${DIDROP_AUTOPLAY}\EventHandlers\PlayVideoFilesOnArrival" "${DIDROP_HANDLER}"
  DeleteRegValue SHCTX "${DIDROP_AUTOPLAY}\EventHandlers\MixedContentOnArrival" "${DIDROP_HANDLER}"
  DeleteRegKey SHCTX "${DIDROP_AUTOPLAY}\Handlers\${DIDROP_HANDLER}"
  DeleteRegKey SHCTX "Software\Classes\${DIDROP_PROGID}"
!macroend
