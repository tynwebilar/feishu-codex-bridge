# feishu-codex-bridge

飞书与 Codex App Server 的独立本机桥接。当前为 Windows x64 开发预览，**尚未达到正式上线标准**；现有 OpenClaw 入口不受影响。

已实现：主人配对、文本/富文本输入、原生连续会话与项目绑定、SQLite 去重/排队/交付状态、卡片和长回复、状态/停止/新会话/恢复/限时交付重试命令、编号问答、图片/文件输入、受限文件输出、群白名单与 @ 门槛、DPAPI 凭据、管理菜单、可选 Windows 登录自启动和自带运行时预览包。推理和工具执行交给 Codex。

## 使用

插件 0.0.3 增加本机管理 MCP，提供状态、诊断、启动、停止、卸载 5 个固定工具，Skill 负责初始化及最后的插件卸载。MCP 与后台消息服务独立；断开工具连接不会停止飞书桥接。

0.0.5 增加后台插件卸载检测：每 30 秒检查安装状态，明确未安装持续至少 60 秒且 3 次确认后自动清理。需要新版运行文件及绑定成功，状态见 pluginLifecycle；异常/缺失结果不清理。手动停止后台后不再检测。未来官方回调迁移计划见 LIFECYCLE-DECISION.md。

也可安装「飞书 Codex 桥接」插件，然后对 Codex 说“帮我初始化飞书 Codex 桥接”。Skill 将引导安装独立运行环境、登录、配置、配对和后台验收；密钥仅在本机隐藏输入。插件包用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-plugin.ps1` 构建，不包含开发者凭据或 node_modules。

取得完整 Windows 预览 ZIP，解压后双击 Start.cmd。无需 OpenClaw 或预装 Node/npm；按菜单完成自己的 Codex 登录、飞书应用配置和主人配对。不要使用开发者的账号或凭据。

见 [使用说明](USER-GUIDE.md)、[发布验收](RELEASE-CHECKLIST.md)、[功能计划](PLAN.md) 和 [Codex 接入调研](CODEX-INTEGRATION.md)。仓库目前私有，尚未公开发布。

## 开发

需要 Node.js 22.22+。打包固定 Node 22.22.3，Codex 0.155.1，飞书 SDK 1.73.3；Codex 桌面捆绑版本可能不同。

```powershell
npm ci
npm test
node src/cli.mjs setup
node src/cli.mjs serve --pair
```

serve 是常驻前台进程；status、stop、doctor 是独立命令。配置默认存储在 %USERPROFILE%\.feishu-codex-bridge，可用 FEISHU_CODEX_HOME 隔离测试。不要提交配置、数据库、附件或日志。工作区中的 .feishu-bridge 也应排除 Git。

```powershell
npm run probe
node scripts/probe-project.mjs
node scripts/probe-interrupt.mjs
npm run package:windows
```

探针会使用本机模型配置和额度、创建真实测试任务；不要当作周期健康检查。报告保存在不提交的 .probe。打包产物位于 dist，包含 SHA256 校验文件和依赖许可清单，不包含开发者配置和历史。

项目接口与动态工具属于实验性协议，依赖版本必须经过验证。生成本机实际 schema：

```powershell
node node_modules/@openai/codex/bin/codex.js app-server generate-json-schema --experimental --out .probe/schema-experimental
```

## 验证摘要（2026-10-07）

- 原生探针同一任务连续 5 轮，重启后口令恢复通过。
- 用户确认新会话会自动归组，侧栏显示有可接受延迟；互斥模式的桌面原生占用提示已实测通过。
- 独立测试机器人完成主人配对、真实文字往返、桥接重启后同一任务回忆口令；测试群两轮共用原生会话，且与私聊会话分离。
- /new、工作区写入、飞书原生文件发送通过；回查文件消息并下载核对 test.txt 内容为 FILE_OK_527。用户上传图片识别和 test.txt 内容读取也通过。
- 原生 turn/interrupt 实测为 interrupted 且历史已持久化；修复启动确认早于可取消状态的竞态。
- 本地测试覆盖重复投递、恢复不重跑、权限/聊天隔离、输出队列、附件边界、编号问答隔离、超时与子进程故障。交付错误保留脱敏错误码，未知执行暂停当前实例的新任务。官方 npm 审计 0 个已知漏洞。
- 自带运行时的预览包已完成 help、现有配置诊断和缺少配置的失败路径检查；不是干净 Windows 账号的独立验收。

上线缺口以 RELEASE-CHECKLIST 为准，不把以上局部通过当成正式发布。

普通消息进度使用原消息 Typing 表情，最终答复送达后撤销；需要表情写入权限。授权卡片和扫码初始化已实现，见 USER-GUIDE.md；用户已确认授权后资源查询正常，真实扫码创建仍待验收。

0.0.7：统一发布已验证的授权账号隔离、Codex core 环境兼容及富文本回复。初始化可选择启用个人资源访问；独立 CLI 绑定在实际后台环境完成，状态 cli.state=ready 表示应用凭据检查通过（不等于用户已授权）。扫码创建及另一台电脑的完整安装尚需验收。
