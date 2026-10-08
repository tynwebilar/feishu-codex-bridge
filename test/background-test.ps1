param([string]$DataDirectory=(Join-Path $env:USERPROFILE '.feishu-codex-bridge'))
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
$status=Get-Content -LiteralPath (Join-Path $DataDirectory 'status.json') -Raw | ConvertFrom-Json
if ($status.stopped -or ((Get-Date).ToUniversalTime()-[DateTime]::Parse($status.updatedAt).ToUniversalTime()).TotalSeconds -gt 10) { throw 'Bridge status is stale or stopped.' }
if ($status.feishu -ne 'connected' -or $status.codex -ne 'connected') { throw 'Connections are not ready.' }
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$tasks=@($scheduler.GetFolder('\').GetTasks(1) | Where-Object {
  $_.Definition.RegistrationInfo.Description -eq 'FeishuCodexBridge managed background task' -and
  $_.Definition.Actions.Item(1).Arguments.Contains('"'+$DataDirectory+'"')
})
if ($tasks.Count -ne 1 -or $tasks[0].State -ne 4) { throw 'Expected one running managed task.' }
if ($tasks[0].Definition.Triggers.Count -ne 0 -or $tasks[0].Definition.Principal.RunLevel -ne 0) { throw 'Unexpected autostart trigger or elevation.' }
$child=Get-CimInstance Win32_Process -Filter "ProcessId=$($status.pid)"
$parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ParentProcessId)"
$launcher=Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ParentProcessId)"
if ($parent.Name -ne 'powershell.exe' -or $launcher.Name -notin @('svchost.exe','taskeng.exe','taskhostw.exe')) { throw 'Bridge is not owned by Task Scheduler.' }
Write-Output "PASS: ready bridge $($child.ProcessId), scheduler ancestry, no autostart or elevation."
