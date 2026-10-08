$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$repo=Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'src\background.ps1')
. (Join-Path $repo 'src\startup.ps1')
. (Join-Path $repo 'src\uninstall.ps1')
$scratch=Join-Path $repo ('.probe\lifecycle-'+[Guid]::NewGuid().ToString('n'))
$data=Join-Path $scratch 'profile'
$node=(Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $data -Force | Out-Null
$fake=@'
param([string]$Action,[string]$DataDirectory,[string]$NodeExecutable)
[IO.File]::WriteAllText((Join-Path $DataDirectory 'launched.txt'),$PSScriptRoot)
'@
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
function Wait-TestTask([string]$Expected) {
  for($i=0;$i -lt 60;$i++) {
    $marker=Join-Path $data 'launched.txt'
    $tasks=@($scheduler.GetFolder('\').GetTasks(1) | Where-Object { $_.Definition.RegistrationInfo.Description -eq 'FeishuCodexBridge managed background task' -and $_.Definition.Actions.Item(1).Arguments.Contains('"'+$data+'"') })
    if((Test-Path -LiteralPath $marker) -and [IO.File]::ReadAllText($marker) -eq $Expected -and $tasks.Count -eq 1 -and $tasks[0].State -ne 4) {
      if($tasks[0].LastTaskResult -ne 0) { throw 'Background command failed.' }
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'Isolated background task did not complete.'
}
try {
  foreach($version in @('old','new')) {
    $root=Join-Path $scratch $version
    New-Item -ItemType Directory -Path $root | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'manage.ps1'),$fake,[Text.UTF8Encoding]::new($true))
    Start-BridgeBackground -BridgeRoot $root -DataDirectory $data -NodeExecutable $node
    Wait-TestTask $root
  }
  $worker=@'
param([string]$Action,[string]$DataDirectory,[string]$NodeExecutable)
@{pid=$PID;stopped=$false} | ConvertTo-Json | Set-Content (Join-Path $DataDirectory 'status.json')
$deadline=[DateTime]::UtcNow.AddSeconds(30)
while (!(Test-Path (Join-Path $DataDirectory 'stop.request')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
@{stopped=$true} | ConvertTo-Json | Set-Content (Join-Path $DataDirectory 'status.json')
'@
  [IO.File]::WriteAllText((Join-Path $root 'manage.ps1'),$worker,[Text.UTF8Encoding]::new($true))
  Start-BridgeBackground -BridgeRoot $root -DataDirectory $data -NodeExecutable $node
  for($i=0;$i -lt 50 -and !(Test-Path (Join-Path $data 'status.json'));$i++) { Start-Sleep -Milliseconds 200 }
  if (!(Test-Path (Join-Path $data 'status.json'))) { throw 'Worker did not start.' }
  Uninstall-Bridge -BridgeRoot $root -DataDirectory $data -NodeExecutable $node -ShortcutPath (Join-Path $scratch 'unused.lnk')
  if(!(Test-Path -LiteralPath (Join-Path $data 'launched.txt'))) { throw 'Removing task deleted user data.' }
  $remaining=@($scheduler.GetFolder('\').GetTasks(1) | Where-Object { $_.Definition.RegistrationInfo.Description -eq 'FeishuCodexBridge managed background task' -and $_.Definition.Actions.Item(1).Arguments.Contains('"'+$data+'"') })
  if($remaining.Count) { throw 'Task removal failed.' }
  Write-Output 'PASS: real isolated task starts, upgrades, cooperatively stops and uninstalls; data retained; no real bot used.'
} finally {
  # Keep the small test files as evidence; never delete or stop an unrelated task.
  try { Start-BridgeBackground -BridgeRoot $scratch -DataDirectory $data -NodeExecutable $node -Remove } catch { Write-Warning $_ }
}
