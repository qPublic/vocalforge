@echo off
rem Builds engine\build\engine.exe with the Visual Studio C++ tools (found through vswhere).
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo vswhere.exe not found: install Visual Studio Build Tools with the C++ workload.
  exit /b 1
)
set "VSROOT="
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -all -prerelease -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
if not defined VSROOT (
  echo Visual Studio C++ tools not found.
  exit /b 1
)
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
cd /d "%~dp0"
if not exist build mkdir build
rem RNNoise 0.2 is plain C (about 0.2 ms per 10 ms frame), so no SIMD files are needed. Its model,
rem rnnoise_data.c, is fetched by scripts\fetch-rnnoise-model.js (npm run build:engine does that first).
set "R=third_party\rnnoise"
if not exist "%R%\rnnoise_data.c" (
  echo RNNoise model missing: run npm run build:engine, or node scripts\fetch-rnnoise-model.js
  exit /b 1
)
cl /nologo /std:c++20 /O2 /EHsc /MT /DNDEBUG /D_USE_MATH_DEFINES /utf-8 /W3 /I%R% /Fo:build\ /Fe:build\engine.exe src\main.cpp %R%\celt_lpc.c %R%\denoise.c %R%\kiss_fft.c %R%\nnet.c %R%\nnet_default.c %R%\parse_lpcnet_weights.c %R%\pitch.c %R%\rnn.c %R%\rnnoise_data.c %R%\rnnoise_tables.c
if errorlevel 1 exit /b 1
echo Built engine\build\engine.exe
