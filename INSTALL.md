# Install Feishu Codex Bridge

[简体中文](INSTALL.zh-CN.md) · [Overview](README.md)

Requires Windows x64, internet, your own Codex login and a Feishu bot application.

## Codex marketplace

With Git and a Codex CLI supporting plugins:

```powershell
codex plugin marketplace add tynwebilar/feishu-codex-bridge
codex plugin add feishu-codex-bridge@feishu-codex
```

Ask Codex: “Set up Feishu Codex Bridge. Guide me in English.” Installing the plugin alone does not start the bridge. Git installations use manual lifecycle mode.

## Source installation

```powershell
git clone https://github.com/tynwebilar/feishu-codex-bridge.git
cd feishu-codex-bridge
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-plugin.ps1 -LifecycleMode manual
```

The installer downloads and verifies Node. Use the returned runtimePath:

```powershell
$bridgeRuntime = 'C:\path\returned\by\installer'
& "$bridgeRuntime\manage.ps1" -Action login
& "$bridgeRuntime\manage.ps1" -Action setup
& "$bridgeRuntime\manage.ps1" -Action pair
```

Enter secrets only in the local prompt, never in chat. Choose execution permissions deliberately. One bot must have only one bridge. Send the terminal's temporary pairing command privately to your bot, then press Ctrl+C after pairing.

```powershell
& "$bridgeRuntime\manage.ps1" -Action start
& "$bridgeRuntime\manage.ps1" -Action status
```

For a separate profile, consistently append `-DataDirectory 'C:\your\profile'` to every management command.

## Archives

A plugin ZIP contains setup instructions, management MCP and installation scripts. A full Windows bundle includes the runtime: extract it and open `Start.cmd`. Build archives from source using the contribution guide and verify their SHA256. Never import another person's credentials.

## Verify

Enable the bot, long-connection message events and required message/resource permissions in Feishu, then publish/approve as required by your tenant. See [detailed setup](docs/usage.md). Optional QR creation and user authorization require the official Feishu CLI, installed separately.

Verify paired=true, both connections ready and a fresh heartbeat. Test two-turn context, image/file input, file output, and replies after closing Codex Desktop. Desktop project grouping may require a restart. Groups start disabled; full-access execution is not confined to the workspace folder.

## Upgrade and uninstall

Wait until idle, stop the service, install the new runtime and restart with the same data directory. Plugin updates alone do not upgrade the service. Keep the old runtime for rollback; do not repeat setup over existing configuration.

Ask Codex to fully uninstall the bridge, or run:

```powershell
& "$bridgeRuntime\manage.ps1" -Action uninstall
```

Only after cleanup succeeds, remove the plugin in Codex. Git/source installations do not automatically detect plugin removal. Configuration, attachments and Codex history are retained; old runtime backups and custom installation directories may remain.

Guided setup supports English; some runtime menus remain Chinese.
