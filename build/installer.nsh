;
; Extra pages for the VocalForge installer. electron-builder calls these macros while it builds the page list:
; customWelcomePage adds a welcome page (skipped when updating), and customFinishPage replaces the default
; finish page, keeping its "Run VocalForge" box and adding an unchecked one for VB-Cable, which other apps
; need to hear VocalForge's output. Silent installs (updates) never show any of these pages.
;
; Note: defines placed in customHeader would come too late. electron-builder inserts that macro after
; the pages already exist, so the MUI_* texts have to be set here instead.

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to VocalForge"
  !define MUI_WELCOMEPAGE_TEXT "VocalForge makes your microphone sound better: noise suppression, EQ, compressor, a soundboard and more.$\r$\n$\r$\nSetup installs it for your Windows account. Close VocalForge first if it is running."
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "VocalForge is ready"
  !define MUI_FINISHPAGE_TEXT "Open VocalForge and the setup wizard will help you pick your mic and your sound.$\r$\n$\r$\nTo use it in Discord, OBS or games you also need a virtual audio cable. VB-Cable is free."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME "https://vb-audio.com/Cable/"
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the VB-Audio Virtual Cable page (free, lets Discord and OBS hear VocalForge)"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !insertmacro MUI_PAGE_FINISH
!macroend
