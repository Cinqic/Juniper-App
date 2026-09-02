param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [Parameter(Mandatory = $true)][string]$ExpectedAppVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedMsiVersion,
  [Parameter(Mandatory = $true)][string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $MsiPath -PathType Leaf)) {
  throw "MSI not found: $MsiPath"
}

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.GetType().InvokeMember(
  'OpenDatabase',
  'InvokeMethod',
  $null,
  $installer,
  @((Resolve-Path -LiteralPath $MsiPath).Path, 0)
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

$install = Start-Process msiexec.exe -ArgumentList @('/i', $MsiPath, '/qn', '/norestart') -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "MSI install failed with $($install.ExitCode)" }

$exe = Get-ChildItem -Path $env:ProgramFiles, ${env:ProgramFiles(x86)} -Filter Juniper.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'Installed Juniper.exe was not found.' }
$process = Start-Process -FilePath $exe.FullName -PassThru
Start-Sleep -Seconds 10
if ($process.HasExited) { throw "Juniper exited during launch smoke test with $($process.ExitCode)" }
Stop-Process -Id $process.Id -Force

$uninstall = Start-Process msiexec.exe -ArgumentList @('/x', $MsiPath, '/qn', '/norestart') -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "MSI uninstall failed with $($uninstall.ExitCode)" }
if (Test-Path -LiteralPath $exe.FullName) { throw 'Juniper.exe remained after uninstall.' }
