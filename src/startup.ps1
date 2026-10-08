function Set-BridgeStartup {
  param([bool]$Enable, [string]$BridgeRoot, [string]$DataDirectory,
    [string]$ShortcutPath=(Join-Path ([Environment]::GetFolderPath('Startup')) 'FeishuCodexBridge.lnk'))
  $shell=New-Object -ComObject WScript.Shell
  $shortcut=$shell.CreateShortcut($ShortcutPath)
  $marker='FeishuCodexBridge managed startup'
  if ((Test-Path -LiteralPath $ShortcutPath) -and $shortcut.Description -ne $marker) { throw '同名启动项不属于本程序，未修改。' }
  if (!$Enable) {
    if (Test-Path -LiteralPath $ShortcutPath) { Remove-Item -LiteralPath $ShortcutPath }
    return
  }
  $entry=Join-Path ([IO.Path]::GetFullPath($BridgeRoot)) 'manage.ps1'
  if (!(Test-Path -LiteralPath $entry)) { throw '找不到管理入口，未创建启动项。' }
  $data=[IO.Path]::GetFullPath($DataDirectory)
  if ($entry.Contains('"') -or $data.Contains('"')) { throw '路径无效。' }
  $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$entry+'" -Action start -DataDirectory "'+$data+'"'
  $shortcut.WorkingDirectory=$BridgeRoot
  $shortcut.Description=$marker
  $shortcut.WindowStyle=7
  $shortcut.Save()
}
