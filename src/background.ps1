function Start-BridgeBackground {
  param([string]$BridgeRoot, [string]$DataDirectory, [string]$NodeExecutable, [switch]$Remove, [switch]$AllowRunningRemoval)
  $data=[IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $key=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($data.ToLowerInvariant())))).Replace('-','').Substring(0,16) } finally { $sha.Dispose() }
  $name='FeishuCodexBridge-'+$key
  $scheduler=New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  $folder=$scheduler.GetFolder('\')
  $existing=@($folder.GetTasks(1) | Where-Object { $_.Name -eq $name })
  $marker='FeishuCodexBridge managed background task'
  if ($existing.Count -and $existing[0].Definition.RegistrationInfo.Description -ne $marker) { throw '同名后台任务不属于本程序，未修改。' }
  if ($Remove) {
    if ($existing.Count) {
      if ($existing[0].State -eq 4 -and !$AllowRunningRemoval) { throw '请先停止桥接，再移除后台任务。' }
      $folder.DeleteTask($name,0)
    }
    return
  }
  if ($existing.Count -and $existing[0].State -eq 4) { Write-Host '后台任务已在运行。'; return }
  $entry=Join-Path ([IO.Path]::GetFullPath($BridgeRoot)) 'manage.ps1'
  if (!(Test-Path -LiteralPath $entry) -or $entry.Contains('"') -or $data.Contains('"')) { throw '后台任务路径无效。' }
  $definition=$scheduler.NewTask(0)
  $definition.RegistrationInfo.Description=$marker
  $definition.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $definition.Principal.LogonType=3
  $definition.Principal.RunLevel=0
  $definition.Settings.ExecutionTimeLimit='PT0S'
  $definition.Settings.DisallowStartIfOnBatteries=$false
  $definition.Settings.StopIfGoingOnBatteries=$false
  $definition.Settings.MultipleInstances=2
  $action=$definition.Actions.Create(0)
  $action.Path=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$entry+'" -Action run -DataDirectory "'+$data+'"'
  if (!(Test-Path -LiteralPath $NodeExecutable) -or $NodeExecutable.Contains('"')) { throw 'Node runtime path is invalid.' }
  $action.Arguments+=' -NodeExecutable "'+$NodeExecutable+'"'
  $action.WorkingDirectory=$BridgeRoot
  $task=$folder.RegisterTaskDefinition($name,$definition,6,$definition.Principal.UserId,$null,3)
  $null=$task.Run($null)
}
