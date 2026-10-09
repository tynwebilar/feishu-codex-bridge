$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$root=Split-Path -Parent $PSScriptRoot
$manifest=Get-Content -LiteralPath (Join-Path $root 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne 'feishu-codex-bridge' -or $manifest.extensions.'com.openai'.interface.shortDescription.Length -gt 30) { throw 'Invalid plugin metadata.' }
$output=Join-Path $root ('dist\plugin-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$plugin=Join-Path $output $manifest.name
New-Item -ItemType Directory -Path (Join-Path $plugin 'scripts') -Force | Out-Null
foreach ($name in @('plugin.json','mcp.json','skills','src','third-party','package.json','package-lock.json','README.md','README.zh-CN.md','INSTALL.md','INSTALL.zh-CN.md','LICENSE','CONTRIBUTING.md','assets','docs','Start.cmd','manage.ps1')) {
  Copy-Item -LiteralPath (Join-Path $root $name) -Destination $plugin -Recurse
}
Copy-Item -LiteralPath (Join-Path $root 'scripts\install-plugin.ps1') -Destination (Join-Path $plugin 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts\uninstall-plugin.ps1') -Destination (Join-Path $plugin 'scripts')
# Compatibility for desktop clients that discover .codex-plugin/plugin.json.
$compat=Join-Path $plugin '.codex-plugin'
New-Item -ItemType Directory -Path $compat | Out-Null
@{name=$manifest.name;version=$manifest.version;description=$manifest.description;author=$manifest.author;skills='./skills/';mcpServers='./.mcp.json';interface=$manifest.extensions.'com.openai'.interface} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $compat 'plugin.json') -Encoding UTF8
$mcp=Get-Content -LiteralPath (Join-Path $root 'mcp.json') -Raw | ConvertFrom-Json
@{mcpServers=$mcp.mcpServers} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $plugin '.mcp.json') -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip=Join-Path $output ($manifest.name+'-plugin.zip')
$writer=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $plugin -File -Recurse -Force | ForEach-Object {
    $relative=$_.FullName.Substring($output.Length+1).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($writer,$_.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $writer.Dispose() }
$archive=[IO.Compression.ZipFile]::OpenRead($zip)
try {
  if (!$archive.GetEntry('feishu-codex-bridge/.codex-plugin/plugin.json')) { throw 'Missing compatibility manifest.' }
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -match '(^|/)(node_modules|config.json|bridge.sqlite|\.env|\.probe|\.local)(/|$)') { throw 'Forbidden archive entry.' }
  }
} finally { $archive.Dispose() }
Write-Output $zip
