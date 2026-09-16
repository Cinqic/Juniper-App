param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [Parameter(Mandatory = $true)][string]$ExpectedAppVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedMsiVersion,
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [Parameter(Mandatory = $true)][string]$PackageEvidencePath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $MsiPath -PathType Leaf)) {
  throw "MSI not found: $MsiPath"
}

# msiexec resolves paths against its own working directory, not the caller's, so
# a relative path fails with 1619 (ERROR_INSTALL_PACKAGE_OPEN_FAILED). Resolve
# once here and use the absolute path everywhere below.
$MsiPath = (Resolve-Path -LiteralPath $MsiPath).Path

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.GetType().InvokeMember(
  'OpenDatabase',
  'InvokeMethod',
  $null,
  $installer,
  @($MsiPath, 0)
)
$view = $database.GetType().InvokeMember(
  'OpenView',
  'InvokeMethod',
  $null,
  $database,
  @("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = 'ProductVersion'")
)
$view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
$record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
$productVersion = $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, 1)
if ($productVersion -ne $ExpectedMsiVersion) {
  throw "MSI ProductVersion $productVersion does not equal $ExpectedMsiVersion"
}

$signature = Get-AuthenticodeSignature -LiteralPath $MsiPath
@(
  "ProductVersion=$productVersion"
  "AppVersion=$ExpectedAppVersion"
  "Architecture=x86_64"
  "AuthenticodeStatus=$($signature.Status)"
) | Set-Content -LiteralPath $EvidencePath -Encoding utf8
@(
  "ProductVersion=$productVersion"
  "AppVersion=$ExpectedAppVersion"
  "Architecture=x86_64"
) | Set-Content -LiteralPath $PackageEvidencePath -Encoding utf8

# 0 is success; 3010 is ERROR_SUCCESS_REBOOT_REQUIRED, which is also a
# successful install and must not fail the smoke test.
$install = Start-Process msiexec.exe -ArgumentList @('/i', $MsiPath, '/qn', '/norestart') -Wait -PassThru
if ($install.ExitCode -notin @(0, 3010)) { throw "MSI install failed with $($install.ExitCode)" }

$exe = Get-ChildItem -Path $env:ProgramFiles, ${env:ProgramFiles(x86)} -Filter Juniper.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'Installed Juniper.exe was not found.' }
$runtime = Get-ChildItem -Path $exe.Directory.FullName -Filter llama-server.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $runtime) { throw 'Installed Juniper local runtime was not found.' }
$license = Get-ChildItem -Path $exe.Directory.FullName -Filter LICENSE -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $license) { throw 'Installed Apache-2.0 LICENSE was not found.' }
$notices = Get-ChildItem -Path $exe.Directory.FullName -Filter THIRD_PARTY_NOTICES.md -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $notices) { throw 'Installed third-party notices were not found.' }
# Launch smoke. Surviving a timer is not evidence of a usable window (rc.31
# rendered nothing on Linux while its process stayed alive), so each launch must
# report "[juniper-startup] frontend ready" on stderr, stay alive through a
# settle period, and produce no fatal startup or frontend report. The second
# launch seeds stored state with an enabled Ollama provider backed by a loopback
# stand-in, the state that blanked rc.31, and requires the discovered model to be
# persisted. Limit: this smoke does not capture window pixels.
$evidenceDirectory = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $PackageEvidencePath).Path) 'windows-smoke'
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
$regression = Join-Path $PSScriptRoot '..\tests\linux-probe\ollama-startup-regression.py'
$database = Join-Path $env:APPDATA 'com.cinqic.juniper\juniper.db'
$fatalPattern = '\[juniper-startup\] (frontend fatal|stage [^ ]+ failed|fatal:)|panicked at'

function Invoke-LaunchProbe([string]$Label, [int]$TimeoutSeconds = 180, [int]$SettleSeconds = 15) {
  $stdout = Join-Path $evidenceDirectory "windows-$Label-stdout.log"
  $stderr = Join-Path $evidenceDirectory "windows-$Label-stderr.log"
  $process = Start-Process -FilePath $exe.FullName -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  try {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
      $log = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
      if ($log -match $fatalPattern) { throw "[$Label] fatal diagnostic before readiness: $($Matches[0])" }
      if ($log -match '\[juniper-startup\] frontend ready') { break }
      if ($process.HasExited) { throw "[$Label] Juniper exited with $($process.ExitCode) before frontend readiness" }
      if ((Get-Date) -gt $deadline) { throw "[$Label] Juniper did not report frontend readiness within ${TimeoutSeconds}s" }
      Start-Sleep -Milliseconds 500
    }
    if ($log -notmatch [regex]::Escape("[juniper-startup] Juniper $ExpectedAppVersion starting on windows/x86_64")) {
      throw "[$Label] Juniper did not report version $ExpectedAppVersion"
    }
    Start-Sleep -Seconds $SettleSeconds
    if ($process.HasExited) { throw "[$Label] Juniper exited with $($process.ExitCode) during the settle period" }
    $log = Get-Content -LiteralPath $stderr -Raw
    if ($log -match $fatalPattern) { throw "[$Label] fatal diagnostic after readiness: $($Matches[0])" }
    Write-Output "[$Label] PASS: frontend ready and alive for ${SettleSeconds}s with no fatal report"
  }
  finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    $process.WaitForExit(30000) | Out-Null
    if (Test-Path -LiteralPath $stderr) {
      Write-Output "--- [$Label] Juniper stderr ---"
      Get-Content -LiteralPath $stderr
    }
  }
}

Invoke-LaunchProbe 'fresh'
if (-not (Test-Path -LiteralPath $database -PathType Leaf)) { throw "Juniper did not create $database" }

$portFile = Join-Path $evidenceDirectory 'windows-ollama-port.txt'
$requestLog = Join-Path $evidenceDirectory 'windows-ollama-requests.log'
Remove-Item -LiteralPath $portFile, $requestLog -ErrorAction SilentlyContinue
$standIn = Start-Process -FilePath python -ArgumentList @($regression, 'serve', $portFile, $requestLog) -PassThru -NoNewWindow
try {
  $deadline = (Get-Date).AddSeconds(30)
  while (-not ((Test-Path -LiteralPath $portFile) -and (Get-Item -LiteralPath $portFile).Length -gt 0)) {
    if ($standIn.HasExited -or (Get-Date) -gt $deadline) { throw 'Ollama stand-in did not start' }
    Start-Sleep -Milliseconds 200
  }
  & python $regression seed $database (Get-Content -LiteralPath $portFile -Raw).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not seed stored Ollama state' }
  Invoke-LaunchProbe 'ollama'
}
finally {
  if (-not $standIn.HasExited) { Stop-Process -Id $standIn.Id -Force }
}
if (-not (Select-String -LiteralPath $requestLog -SimpleMatch 'GET /api/tags' -Quiet)) {
  throw 'Juniper never queried the Ollama stand-in'
}
& python $regression check $database
if ($LASTEXITCODE -ne 0) { throw 'Discovered Ollama model was not persisted' }

$uninstall = Start-Process msiexec.exe -ArgumentList @('/x', $MsiPath, '/qn', '/norestart') -Wait -PassThru
if ($uninstall.ExitCode -notin @(0, 3010)) { throw "MSI uninstall failed with $($uninstall.ExitCode)" }
if (Test-Path -LiteralPath $exe.FullName) { throw 'Juniper.exe remained after uninstall.' }
