;
; Extra settings for the VocalForge installer (electron-builder includes this before the pages).
; Wording for the welcome and finish pages, and an unchecked box on the finish page for VB-Cable, which
; other apps need to hear VocalForge's output. Silent installs (updates) never show these pages.
!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to VocalForge"
  !define MUI_WELCOMEPAGE_TEXT "VocalForge makes your microphone sound better: noise suppression, EQ, compressor, a soundboard and more.$\r$\n$\r$\nSetup installs it for your Windows account. Close VocalForge first if it is running."
  !define MUI_FINISHPAGE_TITLE "VocalForge is ready"
  !define MUI_FINISHPAGE_TEXT "Open VocalForge and the setup wizard will help you pick your mic and your sound.$\r$\n$\r$\nTo use it in Discord, OBS or games you also need a virtual audio cable. VB-Cable is free."
  !define MUI_FINISHPAGE_SHOWREADME "https://vb-audio.com/Cable/"
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the VB-Audio Virtual Cable page (free, lets Discord and OBS hear VocalForge)"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!macroend
