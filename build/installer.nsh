;
; Extra settings for the VocalForge installer (electron-builder includes this before the pages).
; The finish page already offers "Run VocalForge"; this adds an unchecked second box for VB-Cable,
; which other apps need to hear VocalForge's output. Silent installs (updates) never show this page.
!macro customHeader
  !define MUI_FINISHPAGE_SHOWREADME "https://vb-audio.com/Cable/"
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the VB-Audio Virtual Cable page (free, lets Discord and OBS hear VocalForge)"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!macroend
