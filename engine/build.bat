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
cl /nologo /std:c++20 /O2 /EHsc /MT /DNDEBUG /utf-8 /W3 /Fo:build\ /Fe:build\engine.exe src\main.cpp
if errorlevel 1 exit /b 1
echo Built engine\build\engine.exe
