# Architecture / 架构

```text
Feishu WebSocket → admission + durable inbox → Codex App Server
                                             ↓
Feishu cards/files ← durable outbox ← persisted turn result
```

`feishu.mjs` handles transport. `messages.mjs` normalizes inbound content and output. `permissions.mjs` gates access. `store.mjs` persists routing, deduplication, queue and delivery state. `bridge.mjs` coordinates execution and recovery through `app-server.mjs`.

`shared-rules.mjs` snapshots the workspace root AGENTS.md before each turn and injects changed versions without creating a confirmation turn. `attachments.mjs` scopes delivery paths to the chat. `authorization.mjs` handles owner-only personal-resource authorization.

`management-mcp.ps1` exposes fixed local operations; setup remains an interactive local workflow. The Windows scheduled task runs independently of the desktop application. Git installations use manual lifecycle cleanup. The private account plugin optionally monitors its exact remote identity; unknown state never triggers removal.

桥接负责接入、权限、队列、交付与恢复；推理和工具执行由 Codex 承担。会话长期持有写入权，桌面不能同时写同一会话。共享规则编辑通过下一轮热更新，不需要桌面接管。

## Boundaries / 边界

- Shared group context does not grant permission to disclose owner-private data.
- A workspace path is not OS isolation; configured full access can reach outside it.
- Unknown execution must be reconciled before more model work; uncertain delivery retries preserve identity and deadline.
- Project binding and Desktop sidebar visibility are separate states.
- User configuration and evidence stay outside distributable source and archives.

See [English usage](usage.md) / [中文使用说明](usage.zh-CN.md) for operational behavior. Historical experiments and release tracking are maintained locally, not as part of this architecture contract.
