# Local stdio management only. The independently scheduled bridge owns messages.
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath="$PSHOME\Modules;${env:ProgramFiles}\WindowsPowerShell\Modules" }
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'background.ps1')
. (Join-Path $PSScriptRoot 'startup.ps1')
. (Join-Path $PSScriptRoot 'uninstall.ps1')
$definitions=@(
  @('bridge_permissions_get','Read group permissions and revision. Local desktop administration only.',$true),
  @('bridge_permissions_set','Replace group permissions after stopping the bridge. Requires expectedRevision. Non-owner members require explicit trustedLocalAccess acknowledgement: they can exercise this Windows account capabilities, not an OS-isolated identity. Restart after success.',$false),
  @('bridge_status','Read sanitized bridge status. Does not install or start anything.',$true),
  @('bridge_doctor','Check local configuration and Feishu bot identity; does not prove full messaging permissions.',$true),
  @('bridge_start','Start the independently scheduled bridge after local setup and pairing.',$false),
  @('bridge_stop','Request a graceful stop. Completion must be confirmed with bridge_status.',$false),
  @('bridge_uninstall','Stop and remove bridge service and managed runtime, retaining data. Does not remove the Codex plugin itself.',$false)
)
$tools=@($definitions | ForEach-Object {
  @{name=$_[0];description=$_[1];inputSchema=@{type='object';properties=@{
    runtimePath=@{type='string';description='Verified absolute runtime directory; omit for the managed installation.'}
    dataDirectory=@{type='string';description='Explicit profile directory; omit for FEISHU_CODEX_HOME or the default user profile.'}
  };additionalProperties=$false};annotations=@{readOnlyHint=$_[2];destructiveHint=($_[0] -eq 'bridge_uninstall');openWorldHint=($_[0] -eq 'bridge_doctor')}}
})
$policyTool=$tools | Where-Object name -eq 'bridge_permissions_set'
$policyTool.inputSchema.properties.permissions=@{type='object';properties=@{groupContext=@{type='string';enum=@('shared','per-sender')};groups=@{type='array';maxItems=100;items=@{type='object';properties=@{chatId=@{type='string';pattern='^oc_[a-zA-Z0-9]+$'};enabled=@{type='boolean'};requireMention=@{type='boolean'};senderIds=@{type='array';items=@{type='string';pattern='^ou_[a-zA-Z0-9]+$'}};trustedLocalAccess=@{type='boolean'}};required=@('chatId','enabled','requireMention','senderIds','trustedLocalAccess');additionalProperties=$false}}};required=@('groupContext','groups');additionalProperties=$false}
$policyTool.inputSchema.properties.expectedRevision=@{type='string';pattern='^[a-f0-9]{64}$'}
$policyTool.inputSchema.required=@('permissions','expectedRevision')
function Resolve-PathArgument([string]$Value) {
  if (!$Value -or ![IO.Path]::IsPathRooted($Value) -or $Value -match '["\r\n]') { throw 'INVALID_PATH' }
  [IO.Path]::GetFullPath($Value).TrimEnd('\')
}
function Invoke-ManagementTool($Name,$Arguments) {
  if($env:FEISHU_BRIDGE_REMOTE -eq '1' -and $Name -ne 'bridge_status'){throw 'DESKTOP_ONLY'}
  if ($Name -notin $definitions.ForEach({$_[0]})) { throw 'UNKNOWN_TOOL' }
  foreach ($property in $Arguments.PSObject.Properties) {
    if($Name -eq 'bridge_permissions_set' -and $property.Name -in @('permissions','expectedRevision')) { continue }
    if ($property.Name -notin @('runtimePath','dataDirectory') -or $property.Value -isnot [string]) { throw 'INVALID_ARGUMENTS' }
  }
  $data=if ($Arguments.dataDirectory) { $Arguments.dataDirectory } elseif ($env:FEISHU_CODEX_HOME) { $env:FEISHU_CODEX_HOME } else { Join-Path $env:USERPROFILE '.feishu-codex-bridge' }
  $data=Resolve-PathArgument $data
  if ($Name -eq 'bridge_status') {
    $path=Join-Path $data 'status.json'
    if (!(Test-Path -LiteralPath $path)) { return @{state='not_running_or_not_initialized'} }
    $s=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $result=@{stale=([DateTime]::UtcNow-[DateTime]::Parse($s.updatedAt).ToUniversalTime()).TotalSeconds -gt 10}
    foreach ($key in @('updatedAt','stopped','feishu','codex','paired','active','pluginLifecycle','cli')) { if ($null -ne $s.$key) { $result[$key]=$s.$key } }
    if ($null -ne $s.projectBinding) {
      $result.projectBinding=@{}
      foreach ($key in @('projectId','state','desktopVisibility')) { if ($null -ne $s.projectBinding.$key) { $result.projectBinding[$key]=$s.projectBinding.$key } }
    }
    return $result
  }
  if ($Name -eq 'bridge_stop') {
    if (Test-Path -LiteralPath $data) { [IO.File]::WriteAllText((Join-Path $data 'stop.request'),'stop') }
    return @{state='stop_requested';next='Call bridge_status to confirm stopped=true.'}
  }
  $runtime=$Arguments.runtimePath
  if (!$runtime) {
    $pointer=Join-Path $env:USERPROFILE '.feishu-codex-bridge-app\current.json'
    if (!(Test-Path -LiteralPath $pointer)) { throw 'NOT_INITIALIZED' }
    $runtime=(Get-Content -LiteralPath $pointer -Raw -Encoding UTF8 | ConvertFrom-Json).runtimePath
  }
  $runtime=Resolve-PathArgument $runtime
  $package=Get-Content -LiteralPath (Join-Path $runtime 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($package.name -ne 'feishu-codex-bridge') { throw 'INVALID_RUNTIME' }
  if ($Name -eq 'bridge_uninstall') {
    $null=Uninstall-Bridge -BridgeRoot $runtime -DataDirectory $data
    return @{state='service_removed';dataRetained=$true;next='Remove feishu-codex-bridge with the Codex plugin uninstall tool.'}
  }
  $node=Join-Path $runtime 'runtime\node.exe'
  if (!(Test-Path -LiteralPath $node)) { $node=(Get-Command node -ErrorAction Stop).Source }
  if ($Name -eq 'bridge_start') {
    $enrollment=Join-Path $runtime 'src\plugin-lifecycle.mjs'
    if (!(Test-Path -LiteralPath $enrollment)) { throw 'RUNTIME_UPGRADE_REQUIRED' }
    $null=& $node $enrollment $data 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'LIFECYCLE_ENROLLMENT_FAILED' }
    $null=Start-BridgeBackground -BridgeRoot $runtime -DataDirectory $data -NodeExecutable $node 6>$null
    return @{state='start_requested';next='Call bridge_status to check readiness.'}
  }
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$node
  $isPolicy=$Name -in @('bridge_permissions_get','bridge_permissions_set')
  $info.Arguments=if($isPolicy){'"'+(Join-Path $runtime 'src\permissions-cli.mjs')+'"'}else{'"'+(Join-Path $runtime 'src\cli.mjs')+'" doctor'}
  $info.RedirectStandardInput=$isPolicy
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $info.EnvironmentVariables['FEISHU_CODEX_HOME']=$data
  $process=New-Object Diagnostics.Process
  $process.StartInfo=$info
  try {
    $null=$process.Start()
    if($isPolicy){$payload=@{operation=if($Name -eq 'bridge_permissions_get'){'get'}else{'set'};permissions=$Arguments.permissions;expectedRevision=$Arguments.expectedRevision};$process.StandardInput.Write(($payload | ConvertTo-Json -Depth 12 -Compress));$process.StandardInput.Close()}
    $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(35000)) { $process.Kill(); throw 'DOCTOR_TIMEOUT' }
    # Deliberately suppress raw CLI/SDK output, including possible credentials.
    if($isPolicy){$policyResult=$out.Result | ConvertFrom-Json;if($process.ExitCode -ne 0){throw $policyResult.error};return $policyResult}
    if ($process.ExitCode -ne 0) { throw 'DOCTOR_FAILED' }
    return @{state='config_and_bot_identity_ok';messagingPermissionsVerified=$false}
  } finally { $process.Dispose() }
}
while ($null -ne ($line=[Console]::ReadLine())) {
  $request=$null
  try {
    $request=$line | ConvertFrom-Json
    if ($null -eq $request.id) { continue }
    $result=switch ($request.method) {
      'initialize' { @{protocolVersion=$request.params.protocolVersion;capabilities=@{tools=@{}};serverInfo=@{name='feishu-bridge-management';version='0.0.3'}} }
      'ping' { @{} }
      'tools/list' { @{tools=$tools} }
      'tools/call' {
        try {
          $argsValue=if ($request.params.arguments) { $request.params.arguments } else { [pscustomobject]@{} }
          $value=Invoke-ManagementTool $request.params.name $argsValue
          @{content=@(@{type='text';text=($value | ConvertTo-Json -Depth 10 -Compress)});structuredContent=$value;isError=$false}
        } catch {
          $code=if ($_.Exception.Message -match '^(DESKTOP_ONLY|STOP_REQUIRED|REVISION_CONFLICT|TRUST_ACK_REQUIRED|INVALID_PERMISSIONS|PERMISSIONS_FAILED|INVALID_PATH|UNKNOWN_TOOL|INVALID_ARGUMENTS|NOT_INITIALIZED|INVALID_RUNTIME|DOCTOR_TIMEOUT|DOCTOR_FAILED|RUNTIME_UPGRADE_REQUIRED|LIFECYCLE_ENROLLMENT_FAILED)$') { $_.Exception.Message } else { 'MANAGEMENT_FAILED' }
          @{content=@(@{type='text';text=$code});isError=$true}
        }
      }
      default { throw 'METHOD_NOT_FOUND' }
    }
    $response=@{jsonrpc='2.0';id=$request.id;result=$result}
  } catch {
    $response=@{jsonrpc='2.0';id=$request.id;error=@{code=-32600;message='Invalid or unsupported request'}}
  }
  [Console]::WriteLine(($response | ConvertTo-Json -Depth 20 -Compress))
}
