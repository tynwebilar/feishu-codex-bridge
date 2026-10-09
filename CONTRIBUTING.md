# Contributing / 开发贡献

## Repository layout / 目录

| Path | Purpose / 用途 |
| --- | --- |
| `src/` | Bridge runtime and local management MCP / 桥接与管理工具 |
| `skills/` | Guided plugin setup and maintenance / 插件操作引导 |
| `scripts/` | Installation, packaging and opt-in live probes / 安装、打包、真实探针 |
| `test/` | Automated tests and explicit Windows integration checks / 测试 |
| `docs/` | Current user and architecture documentation / 当前使用及架构说明 |
| `assets/` | Icons and bilingual presentation / 图标与双语展示 |
| `third-party/` | Dependency notices / 依赖许可 |
| `.agents/`, `.codex-plugin/` | Marketplace and compatibility metadata / 分发元数据 |

Root manifests and launcher files are packaging entry points; keep their paths compatible with installation scripts. Avoid moving runtime modules just to reorganize the tree.

根目录清单及启动器属于安装入口，不为美观随意移动。进度、调研过程和个人验收记录放在 Git 忽略的 `.local/maintenance/`，产物放 `dist/`，探针证据放 `.probe/`。这些目录均不得打包或推送。

## Local checks / 本地检查

Use Windows x64 and Node.js 22.22+:

```powershell
npm ci
npm test
git diff --check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-plugin.ps1
```

`npm run package:windows` builds the full Windows runtime bundle. Packaging downloads dependencies and must retain checksum verification. Plugin ZIPs and full runtime bundles are different products.

`scripts/probe*.mjs` and PowerShell integration tests are opt-in: inspect each script before running. They can create real Codex chats, consume quota, start scheduled tasks or test uninstall behavior. Use a disposable profile and bot; never point a destructive test at a production installation.

真实探针和 Windows 集成测试不作为普通健康检查。测试目录、配置目录和应用必须独立，不复用生产机器人。

## Change checklist / 修改要求

- Preserve persistent conversation mappings, duplicate protection and delivery recovery.
- Test permission, file-access and lifecycle changes; preserve private/group isolation.
- Update both language entry pages and relevant current guides when behavior changes.
- Keep root and compatibility plugin metadata synchronized.
- Inspect archives for credentials, logs, databases and internal maintenance material.
- Distinguish unit checks, live probes and user acceptance; do not publish internal evidence as user documentation.

Never commit credentials, personal conversations, production configuration, attachments or signed download links. Share sanitized reproductions only. MIT covers this project's code; dependencies retain their licenses.
