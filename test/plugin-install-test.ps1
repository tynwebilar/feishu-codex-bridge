param([Parameter(Mandatory=$true)][string]$NodeArchive)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$testRoot=Join-Path $root ('.probe\plugin-test-'+[guid]::NewGuid().ToString('N'))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\install-plugin.ps1') -InstallRoot $testRoot -NodeArchive $NodeArchive
if ($LASTEXITCODE -ne 0) { throw 'Fresh install failed.' }
$recordPath=Join-Path $testRoot 'current.json'
$before=[IO.File]::ReadAllText($recordPath)
$record=$before | ConvertFrom-Json
if (!(Test-Path -LiteralPath (Join-Path $record.runtimePath 'runtime\node.exe'))) { throw 'Bundled Node missing.' }
if (!(Test-Path -LiteralPath (Join-Path $record.runtimePath 'src\background.ps1'))) { throw 'Background management missing.' }
$bad=Join-Path $testRoot 'corrupt.zip'
[IO.File]::WriteAllText($bad,'invalid archive')
$ErrorActionPreference='Continue'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\install-plugin.ps1') -InstallRoot $testRoot -NodeArchive $bad 2>$null
$ErrorActionPreference='Stop'
if ($LASTEXITCODE -eq 0) { throw 'Corrupt download accepted.' }
if ([IO.File]::ReadAllText($recordPath) -ne $before) { throw 'Failed install replaced previous runtime.' }
Write-Output 'PASS: fresh runtime executes; corrupt download rejected; previous installation preserved.'
