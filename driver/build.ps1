# Builds the VocalForge Cable driver package into driver\build\package (sys, inf, cat, test certificate).
# Needs Visual Studio 2022 with the Windows Driver Kit component. The driver is test-signed: Windows only
# loads it with test-signing on, or after it is signed through the Microsoft Hardware Dev Center.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$samples = Join-Path $root 'third_party\samples'
$sysvad = Join-Path $samples 'audio\sysvad'
$pinned = 'bb68ed5e770bce04dc5395ec9258dafab034184d'
$out = Join-Path $root 'build\package'

# 1. SYSVAD sources at a known commit, with our changes applied.
if (-not (Test-Path $sysvad)) {
  New-Item -ItemType Directory -Force (Split-Path $samples) | Out-Null
  git clone --filter=blob:none --sparse https://github.com/microsoft/Windows-driver-samples $samples
  git -C $samples sparse-checkout set audio/sysvad
  git -C $samples checkout $pinned
}
if (-not (Test-Path (Join-Path $sysvad 'EndpointsCommon\loopback.cpp'))) {
  git -C $samples apply --whitespace=nowarn (Join-Path $root 'vocalforge-cable.patch')
}

# 2. Build with the VS 2022 that has the WDK toolset.
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -all -prerelease -products * -version '[17.0,18.0)' -property installationPath |
  Where-Object { Test-Path (Join-Path $_ 'MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets\WindowsKernelModeDriver10.0') } | Select-Object -First 1
if (-not $vs) { throw 'Visual Studio 2022 with the Windows Driver Kit component was not found.' }
$msbuild = Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
foreach ($proj in 'EndpointsCommon\EndpointsCommon.vcxproj', 'TabletAudioSample\TabletAudioSample.vcxproj') {
  & $msbuild (Join-Path $sysvad $proj) -p:Configuration=Release -p:Platform=x64 -p:SkipPackageVerification=true -v:minimal -nologo
  if ($LASTEXITCODE) { throw "Build failed: $proj" }
}

# 3. Package: renamed sys + our inf, catalog, signature.
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $sysvad 'TabletAudioSample\x64\Release\TabletAudioSample.sys') (Join-Path $out 'VocalForgeCable.sys')
Copy-Item (Join-Path $root 'package\VocalForgeCable.inf') $out

$kit = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64' -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path "$($_.FullName)\inf2cat.exe" } | Sort-Object FullName | Select-Object -Last 1
if (-not $kit) { $kit = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*\x86' -Directory | Where-Object { Test-Path "$($_.FullName)\inf2cat.exe" } | Select-Object -Last 1 }
$bin = Split-Path $kit.FullName
$signtool = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64\signtool.exe' | Sort-Object FullName | Select-Object -Last 1).FullName
$inf2cat = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*\x86\inf2cat.exe' | Sort-Object FullName | Select-Object -Last 1).FullName

& $inf2cat /driver:$out /os:10_x64 /uselocaltime
if ($LASTEXITCODE) { throw 'inf2cat failed' }

$subject = 'CN=VocalForge Test Signing'
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq $subject | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)
}
Export-Certificate -Cert $cert -FilePath (Join-Path $out 'VocalForgeTest.cer') | Out-Null
foreach ($f in 'VocalForgeCable.sys', 'VocalForgeCable.cat') {
  & $signtool sign /fd sha256 /sha1 $cert.Thumbprint (Join-Path $out $f)
  if ($LASTEXITCODE) { throw "signtool failed: $f" }
}
Write-Host "Driver package ready: $out"
