$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'src\startup.ps1')
. (Join-Path $root 'src\uninstall.ps1')
$scratch=Join-Path $root ('.probe\uninstall-'+[guid]::NewGuid().ToString('N'))
$data=Join-Path $scratch 'data'
$app=Join-Path $scratch 'app'
$runtime=Join-Path $app '0.0.2-123456abcdef'
$shortcut=Join-Path $scratch 'startup.lnk'
New-Item -ItemType Directory -Force -Path $data,$runtime | Out-Null
[IO.File]::WriteAllText((Join-Path $runtime 'manage.ps1'),'# isolated fixture')
[IO.File]::WriteAllText((Join-Path $data 'keep.txt'),'preserve')
@{runtimePath=$runtime} | ConvertTo-Json | Set-Content (Join-Path $app 'current.json')
$script:removed=0
function Start-BridgeBackground { param($BridgeRoot,$DataDirectory,$NodeExecutable,[switch]$Remove)
  if (!$Remove) { throw 'Unexpected start.' }; $script:removed++
}
@{pid=$PID;stopped=$false} | ConvertTo-Json | Set-Content (Join-Path $data 'status.json')
$blocked=$false
try { Uninstall-Bridge -BridgeRoot $runtime -DataDirectory $data -TimeoutSeconds 0 -ShortcutPath $shortcut -AppDirectory $app } catch { $blocked=$true }
if (!$blocked -or $script:removed -ne 0 -or !(Test-Path $runtime)) { throw 'Unsafe timeout handling.' }
@{stopped=$true} | ConvertTo-Json | Set-Content (Join-Path $data 'status.json')
Set-BridgeStartup -Enable $true -BridgeRoot $runtime -DataDirectory $data -ShortcutPath $shortcut
Uninstall-Bridge -BridgeRoot $runtime -DataDirectory $data -ShortcutPath $shortcut -AppDirectory $app
if ((Test-Path $runtime) -or (Test-Path $shortcut) -or (Test-Path (Join-Path $app 'current.json'))) { throw 'Cleanup incomplete.' }
if ([IO.File]::ReadAllText((Join-Path $data 'keep.txt')) -ne 'preserve') { throw 'Data lost.' }
Uninstall-Bridge -BridgeRoot $root -DataDirectory $data -ShortcutPath $shortcut -AppDirectory $app
if (!(Test-Path (Join-Path $root 'manage.ps1'))) { throw 'Source checkout removed.' }
Write-Output 'PASS: timeout blocks cleanup; task removal requested; shortcut/runtime removed; data and source retained; repeat safe.'
