$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath = "$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$bridgeRoot=Split-Path -Parent $PSScriptRoot
$version=(Get-Content (Join-Path $bridgeRoot 'package.json') -Raw | ConvertFrom-Json).version
$nodeVersion='22.22.3'
$archiveName="node-v$nodeVersion-win-x64.zip"
$downloadDir=Join-Path $bridgeRoot '.probe\downloads'
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
$checksums=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
$expected=($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") })
if (!$expected) { throw 'Node 校验清单缺少目标包' }
$expected=($expected.Trim() -split '\s+')[0]
$archivePath=Join-Path $downloadDir $archiveName
if (!(Test-Path -LiteralPath $archivePath)) { Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $archivePath }
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Node SHA256 校验失败' }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$buildDir=Join-Path $bridgeRoot "dist\$version-preview-$stamp"
$bundle=Join-Path $buildDir 'FeishuCodexBridge'
New-Item -ItemType Directory -Force -Path $bundle | Out-Null
foreach ($name in @('src','third-party','package.json','package-lock.json','README.md','USER-GUIDE.md','RELEASE-CHECKLIST.md','PLAN.md','CODEX-INTEGRATION.md','Start.cmd','manage.ps1')) {
  Copy-Item -LiteralPath (Join-Path $bridgeRoot $name) -Destination $bundle -Recurse
}
Push-Location $bundle
try {
  & npm.cmd ci --omit=dev --ignore-scripts --registry=https://registry.npmjs.org
  if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
} finally { Pop-Location }
$expanded=Join-Path $buildDir 'node-download'
Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded
$runtime=Join-Path $bundle 'runtime'
New-Item -ItemType Directory -Path $runtime | Out-Null
foreach ($name in @('node.exe','LICENSE')) { Copy-Item -LiteralPath (Join-Path $expanded "node-v$nodeVersion-win-x64\$name") -Destination $runtime }
& (Join-Path $runtime 'node.exe') (Join-Path $bundle 'src\cli.mjs') help
if ($LASTEXITCODE -ne 0) { throw '打包运行检查失败' }
@{ nodeVersion=$nodeVersion;nodeSha256=$expected;bridgeVersion=$version;status='development-preview';builtAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'BUILD.json') -Encoding UTF8
$licenses=@()
Get-ChildItem -LiteralPath (Join-Path $bundle 'node_modules') -Filter package.json -Recurse | ForEach-Object {
  $p=Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
  if ($p.name -and $p.version) { $licenses += [pscustomobject]@{name=$p.name;version=$p.version;license=$p.license} }
}
$licenses | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'THIRD-PARTY.json') -Encoding UTF8
$zip=Join-Path $buildDir "feishu-codex-bridge-$version-preview-win-x64.zip"
Compress-Archive -LiteralPath $bundle -DestinationPath $zip
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
"$hash  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII
Write-Output $zip
