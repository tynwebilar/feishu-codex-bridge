$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$repo=Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'src\background.ps1')
$scratch=Join-Path $repo ('.probe\auto-cleanup-'+[guid]::NewGuid().ToString('N'))
$data=Join-Path $scratch 'data'
$root=Join-Path $scratch 'runtime'
New-Item -ItemType Directory -Force -Path $data,(Join-Path $root 'src') | Out-Null
Copy-Item (Join-Path $repo 'manage.ps1') $root
foreach($file in @('background.ps1','startup.ps1','uninstall.ps1')) { Copy-Item (Join-Path $repo "src\$file") (Join-Path $root 'src') }
# Only the model/transport process is replaced; real scheduled supervisor cleans itself.
@'
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
writeFileSync(join(process.env.FEISHU_CODEX_HOME,'status.json'),JSON.stringify({stopped:true}));
process.exitCode=42;
'@ | Set-Content -LiteralPath (Join-Path $root 'src\cli.mjs') -Encoding UTF8
$node=(Get-Command node).Source
try {
  Start-BridgeBackground -BridgeRoot $root -DataDirectory $data -NodeExecutable $node
  $marker=Join-Path $data 'plugin-cleanup.json'
  for($i=0;$i -lt 100 -and !(Test-Path $marker);$i++) { Start-Sleep -Milliseconds 200 }
  if (!(Test-Path $marker) -or (Get-Content $marker -Raw | ConvertFrom-Json).state -ne 'cleaned') { throw 'Automatic cleanup failed.' }
  $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect()
  $remaining=@($scheduler.GetFolder('\').GetTasks(1) | Where-Object { $_.Definition.RegistrationInfo.Description -eq 'FeishuCodexBridge managed background task' -and $_.Definition.Actions.Item(1).Arguments.Contains('"'+$data+'"') })
  if($remaining.Count) { throw 'Task registration left behind.' }
  if (!(Test-Path (Join-Path $data 'status.json'))) { throw 'User data was removed.' }
  Write-Output 'PASS: scheduled supervisor handles removal exit, unregisters itself, preserves data.'
} finally { Start-BridgeBackground -BridgeRoot $root -DataDirectory $data -NodeExecutable $node -Remove }
