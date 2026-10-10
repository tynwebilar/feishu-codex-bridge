# User guide

[简体中文](usage.zh-CN.md) · [Installation](../INSTALL.md) · [Overview](../README.md)

## Daily use

The bridge runs on your Windows PC with your own Codex login and Feishu bot. Keep the computer awake and connected. Closing Codex Desktop does not stop an independently started background service.

| Command | Effect |
| --- | --- |
| `/help`, `/status` | Show commands or the current chat's state. |
| `/new` | Start a new conversation when idle; retain old history. |
| `/stop` | Cancel queued work and request interruption; completed side effects are not undone. |
| `/answer NUMBER TEXT` | Answer a numbered question as its original requester. |
| `/recover` | Read the original execution's terminal state; do not rerun it. |
| `/retry` | Retry uncertain delivery within its 45-minute window using the original UUID; do not rerun the model task. |

Inputs include text, rich text, PNG/JPEG/GIF/WebP images up to 10 MB each, and files up to 25 MB each, with at most five attachments per message. Attachments are not automatically executed or unpacked. Generated files are delivered from the current chat's `.feishu-bridge/<chat>/outgoing` directory.

Rich text supports native code blocks (preserving language, indentation and line breaks), Markdown and separators. Emoji are converted to text markers and do not reject an image/text message. Unrecognized content nodes still reject the message rather than silently dropping content. The existing limits remain: 30,000 characters after conversion and 100,000 bytes for the incoming JSON content.

Replies use interactive cards. Typing reactions require the corresponding Feishu reaction permission. A completed turn with no text or exactly `NO_REPLY` stays silent; failures and interruptions still produce notices. Document links do not guarantee a native document preview.

## Bot and authorization

Enable the bot, use long-connection events and subscribe to `im.message.receive_v1`. Enable the appropriate private/group message, sending and resource permissions. File uploads need `im:resource:upload` or a covering permission. Apply tenant approval and publish changes where required. QR application creation does not replace these checks.

Optional personal-resource access requires the separately installed official `@larksuite/cli`. Enable it during setup; authorization cards are restricted to the owner's private chat. The bridge checks application and user identity and uses a separate CLI configuration directory. `cli.state=ready` means application credentials are usable, not that every user scope has been granted. `/stop` cancels a pending authorization flow.

## Groups and execution permissions

Private chat is owner-only; groups start disabled. Group context is shared among admitted members, with private chats isolated. Configure explicit `senderIds`, or enable `allowAllMembers` for every current and future human member of a listed group. Non-owner local access requires `trustedLocalAccess` acknowledgement.

Everyone uses the same Windows identity and configured execution capabilities. Full access is not limited to the workspace folder. Personal owner instructions are not automatically injected into groups. Management commands remain owner-only; Feishu messages cannot grant new permissions.

Use `bridge_permissions_get` and `bridge_permissions_set` with the returned revision. Wait until idle, stop the service, save the change, then restart with the same data directory. A stale revision is rejected.

## Desktop conversations and shared rules

The bridge retains conversation write ownership between turns. Desktop can read history but cannot concurrently write the same chat. Stop the background service and confirm it has stopped to hand execution to Desktop; `/stop` alone does not release ownership.

Add the workspace in Desktop and use `manage.ps1 -Action project` while the bridge is stopped to select an existing matching project. Duplicate candidates need explicit selection. This affects new conversations; it does not move existing history. Desktop project listings may require restarting Desktop, or manually moving a chat to the project. Backend project selection does not prove sidebar visibility.

To update shared behavior, edit the workspace root `AGENTS.md`. Before each turn, the bridge reads this UTF-8 file (maximum 64 KiB) and injects changed content into the existing chat. No confirmation turn, service stop or manual chat synchronization is needed. Active turns finish with their existing snapshot. Prefer saving through an atomic replacement.

Blank, oversized, unreadable or failed-to-inject rules block that request. Fix the file and resend. A workspace with no rules initially keeps its existing behavior. Do not delete the file to retract earlier rules: write explicit replacement rules instead. Referenced files and skills are not recursively reloaded.

`sharedRules` status reports the last check, content hash and versions injected into chats during the current process. Injection is not proof that the model complied with every instruction. Idle chats update on their next message.

## Troubleshooting and maintenance

Seven tools manage status, diagnosis, start, stop, uninstall and group permissions. Confirm `paired=true`, `feishu=connected`, `codex=connected`, and a fresh heartbeat. A successful start request or connected MCP does not prove message delivery.

`completed` describes model execution; outbox `sent` confirms Feishu delivery. Unknown execution pauses new model tasks until recovery confirms the result. Never blindly repeat a request with possible side effects. Diagnosis checks configuration and bot identity, not every permission or complete model execution.

The default data directory is `%USERPROFILE%\.feishu-codex-bridge`; use `-DataDirectory` consistently for other profiles. It contains encrypted credentials, inbound messages, queues and delivery records. Attachments live in the workspace; Codex stores its own history. No automatic retention cleanup is provided.

Follow [upgrade and uninstall instructions](../INSTALL.md#upgrade-and-uninstall). Git/source installs require manual service cleanup before plugin removal. The private account plugin can monitor removal only after verified enrollment and while its service runs; errors, disabled plugins and missing directories do not count as confirmed removal. This is polling, not an official uninstall callback. User data is retained by default.

Standalone sticker messages are silently ignored: Feishu does not expose their image data for download. They do not start a model turn or send an unsupported-message reply. Ordinary images and inline emoji remain supported.
