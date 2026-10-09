param([string]$InstallRoot=(Join-Path $env:USERPROFILE '.feishu-codex-bridge-app'), [string]$NodeArchive='', [ValidateSet('automatic','manual')][string]$LifecycleMode='automatic')
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64') { throw 'Windows x64 required.' }
$source=Split-Path -Parent $PSScriptRoot
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$version=(Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version
$nodeVersion='22.22.3'
$archiveName="node-v$nodeVersion-win-x64.zip"
$cache=Join-Path $InstallRoot 'downloads'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$checksums=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
$entry=@($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") })
if ($entry.Count -ne 1) { throw 'Node checksum entry missing or ambiguous.' }
$expected=($entry[0].Trim() -split '\s+')[0]
if (!$NodeArchive) {
  $NodeArchive=Join-Path $cache $archiveName
  if (!(Test-Path -LiteralPath $NodeArchive)) { Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $NodeArchive }
}
if ((Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node SHA256 mismatch; installation stopped.' }
# Separate directories keep a running/previous installation intact on failure.
$runtimePath=Join-Path $InstallRoot ("$version-"+[guid]::NewGuid().ToString('N').Substring(0,12))
New-Item -ItemType Directory -Path $runtimePath | Out-Null
foreach ($name in @('plugin.json','src','third-party','package.json','package-lock.json','README.md','README.zh-CN.md','INSTALL.md','INSTALL.zh-CN.md','LICENSE','assets','docs','LIFECYCLE-DECISION.md','RELEASE-CHECKLIST.md','PLAN.md','CODEX-INTEGRATION.md','USER-GUIDE.md','Start.cmd','manage.ps1')) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination $runtimePath -Recurse
}
Expand-Archive -LiteralPath $NodeArchive -DestinationPath (Join-Path $runtimePath 'node-download')
Move-Item -LiteralPath (Join-Path $runtimePath "node-download\node-v$nodeVersion-win-x64") -Destination (Join-Path $runtimePath 'runtime')
[IO.File]::WriteAllText((Join-Path $runtimePath 'lifecycle-mode.json'),(@{mode=$LifecycleMode} | ConvertTo-Json))
$node=Join-Path $runtimePath 'runtime\node.exe'
Push-Location $runtimePath
try {
  & $node (Join-Path $runtimePath 'runtime\node_modules\npm\bin\npm-cli.js') ci --omit=dev --ignore-scripts --registry=https://registry.npmjs.org
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed; previous installation unchanged.' }
  & $node (Join-Path $runtimePath 'src\cli.mjs') help
  if ($LASTEXITCODE -ne 0) { throw 'Runtime check failed.' }
  & $node (Join-Path $runtimePath 'node_modules\@openai\codex\bin\codex.js') --version
  if ($LASTEXITCODE -ne 0) { throw 'Codex executable check failed.' }
} finally { Pop-Location }
$record=@{runtimePath=$runtimePath;version=$version;nodeSha256=$expected} | ConvertTo-Json
$temporary=Join-Path $InstallRoot ('current-'+[guid]::NewGuid().ToString('N')+'.json')
[IO.File]::WriteAllText($temporary,$record,(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temporary -Destination (Join-Path $InstallRoot 'current.json') -Force
Write-Output $record
