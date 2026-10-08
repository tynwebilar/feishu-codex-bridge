function Uninstall-Bridge {
  param([string]$BridgeRoot, [string]$DataDirectory, [string]$NodeExecutable,
    [int]$TimeoutSeconds=45, [switch]$FromSupervisor,
    [string]$AppDirectory=(Join-Path $env:USERPROFILE '.feishu-codex-bridge-app'),
    [string]$ShortcutPath=(Join-Path ([Environment]::GetFolderPath('Startup')) 'FeishuCodexBridge.lnk'))
  $data=[IO.Path]::GetFullPath($DataDirectory)
  $statusPath=Join-Path $data 'status.json'
  # Stop cooperatively: never kill a process using a potentially stale PID.
  if (Test-Path -LiteralPath $data) { [IO.File]::WriteAllText((Join-Path $data 'stop.request'),'stop') }
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $status=if (Test-Path -LiteralPath $statusPath) { Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } else { $null }
    $alive=$status -and !$status.stopped -and $status.pid -and (Get-Process -Id $status.pid -ErrorAction SilentlyContinue)
    if (!$alive) { break }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Bridge did not stop. Nothing was uninstalled; inspect status and retry.' }
    Start-Sleep -Milliseconds 250
  } while ($true)
  # Scheduler also guards startup races where status.json has not been written yet.
  do {
    try {
      Start-BridgeBackground -BridgeRoot $BridgeRoot -DataDirectory $data -NodeExecutable $NodeExecutable -Remove -AllowRunningRemoval:$FromSupervisor
      break
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 250
    }
  } while ($true)
  if (Test-Path -LiteralPath $ShortcutPath) {
    $shell=New-Object -ComObject WScript.Shell
    $shortcut=$shell.CreateShortcut($ShortcutPath)
    $expected='-DataDirectory "'+$data+'"'
    if ($shortcut.Description -eq 'FeishuCodexBridge managed startup' -and $shortcut.Arguments.EndsWith($expected,[StringComparison]::OrdinalIgnoreCase)) {
      Set-BridgeStartup -Enable $false -BridgeRoot $BridgeRoot -DataDirectory $data -ShortcutPath $ShortcutPath
    } else { throw 'Startup shortcut belongs to another installation; left untouched. Service task removed.' }
  }
  $appBase=[IO.Path]::GetFullPath($AppDirectory).TrimEnd('\')
  $pointer=Join-Path $appBase 'current.json'
  $resolvedRoot=[IO.Path]::GetFullPath($BridgeRoot).TrimEnd('\')
  if ((Split-Path -Parent $resolvedRoot) -eq $appBase -and (Split-Path -Leaf $resolvedRoot) -match '^\d+\.\d+\.\d+-[a-f0-9]{12}$') {
    if ($data -eq $resolvedRoot -or $data.StartsWith($resolvedRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Data is inside runtime; program files retained to protect data.' }
    $links=@(Get-Item -LiteralPath $resolvedRoot; Get-ChildItem -LiteralPath $resolvedRoot -Force -Recurse) | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
    if ($links) { throw 'Runtime contains links; service removed but program files retained.' }
    if (Test-Path -LiteralPath $pointer) {
      $record=Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json
      if ($record.runtimePath -eq $resolvedRoot) { Remove-Item -LiteralPath $pointer }
    }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
  }
  Write-Output 'Bridge stopped; background task and startup entry removed. Managed runtime removed when applicable; source checkouts retained. Configuration, attachments and Codex history retained.'
}
