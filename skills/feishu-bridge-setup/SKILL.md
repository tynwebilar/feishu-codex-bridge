---
name: feishu-bridge-setup
description: Install, set up, diagnose or uninstall the Windows Feishu Codex bridge. 安装、初始化、诊断或卸载 Windows 本机飞书 Codex 消息桥接。用于通过飞书与 Codex 对话、机器人配对和独立后台运行；不用于普通飞书文档、审批操作或 OpenClaw 配置。
---

# Feishu Codex Bridge / 飞书 Codex 桥接

Respond in the user's language. Read [English installation](../../INSTALL.md) or [中文安装](../../INSTALL.zh-CN.md). Explain Chinese terminal prompts in English when needed; never collect secrets in chat.

Git marketplace and source installations MUST pass `-LifecycleMode manual` to install-plugin.ps1. Fully uninstall the background bridge before removing a Git plugin; automatic remote-plugin removal detection is unavailable for this route. Only use automatic mode for the existing private account plugin. If origin is unclear, ask which installation route was used. Never silently bypass failed automatic enrollment.


这是 Windows x64 本机桥接的开发预览。插件提供安装脚本和操作引导，消息由独立后台进程处理。无需 OpenClaw。先读插件根目录的 [docs/usage.zh-CN.md](../../docs/usage.zh-CN.md)，按用户当前阶段继续，不重复已完成操作。

## 初始化

1. 确认 Windows x64、用户工作区绝对路径。询问是否已有独立飞书应用，只询问 App ID，不收集密钥。不要修改其他 OpenClaw 或已有机器人入口。同一应用只能安排一个桥接实例。Mac/Linux 暂不支持。
2. 插件根目录是本文件上两级；不要猜测插件缓存路径。先检查 `%USERPROFILE%\.feishu-codex-bridge-app\current.json`。已有安装时读取其中 runtimePath，使用该目录的管理脚本检查状态，避免重复安装或重配。
3. 未安装时运行下列脚本（替换为解析出的绝对路径）：
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<插件根目录>\scripts\install-plugin.ps1"`
   它下载并校验固定版本 Node，从官方 npm registry 安装锁定依赖，再将运行文件放到用户目录。无需管理员。失败时报告具体阶段，不绕过哈希校验。成功返回 runtimePath；安装程序不登录、不写凭据、不启动服务。
4. 用该 runtimePath 的 `manage.ps1 -Action login` 检查/完成用户自己的 Codex 登录。需交互时为用户打开可见 PowerShell 窗口。所有路径必须正确引用，不能把用户输入拼接成可执行命令。
5. 先检查 `lark-cli --version`。扫码建机器人和个人授权卡片依赖官方 `@larksuite/cli`；缺失时按其官方安装文档完成安装，不能把本插件已安装等同于 CLI 已安装。初始化可选择已有应用或扫码创建，扫码只建新应用，不修改其他机器人。扫码完成后仍核对消息长连接事件、必要权限和发布状态，见 docs/usage.zh-CN.md。
6. 为用户打开可见终端运行 `manage.ps1 -Action setup`，由用户直接输入 Secret、工作区和权限。不要读取/打印 config.json、DPAPI 密文、环境变量或 Codex 凭据，不让用户把 Secret 发到聊天。默认只读；更高权限由用户在本机明确选择。已配置时不要再次 setup：新版会拒绝覆盖，保留配对和群白名单。
7. 打开可见终端运行 `manage.ps1 -Action pair`，请用户把终端中的临时配对指令私聊自己的机器人。不要复制配对口令给第三方。确认配对后 Ctrl+C 关闭前台，再执行 `manage.ps1 -Action start`。这使用 Windows 计划任务；不要用 Codex 工具的后台 shell 代替。
8. 用 `manage.ps1 -Action status` 验证 paired=true、feishu/codex=connected、stale=false。几秒后重查一次尚未就绪的状态；启动成功不等于连接成功。引导用户发两轮记忆测试及图片/文件测试。使用菜单配置群白名单；默认关闭群聊。

打开交互窗口可使用 PowerShell `Start-Process powershell.exe -ArgumentList`，传递 `-NoExit -NoProfile -ExecutionPolicy Bypass -File "<runtimePath>\manage.ps1" -Action setup`；只为需要用户输入的步骤显示窗口。普通状态检查直接调用脚本。

## 运行与维护

优先使用本插件本机 MCP 的 `bridge_status`、`bridge_doctor`、`bridge_start`、`bridge_stop`、`bridge_uninstall` 工具。默认读取用户目录的安装记录；源码或 ZIP 旧部署需传已核实的 runtimePath，自定义配置需传 dataDirectory。工具不接收密钥或任意 shell 命令。未安装运行环境时按初始化步骤继续，不把工具连接成功当作机器人已就绪。工具启动请求后再用状态确认。停止服务会中断正在执行的工作，按用户请求操作。

MCP 仅负责管理，关闭 MCP 不影响独立桥接服务。没有可用 MCP 工具时保留下面的脚本方式作为回退。

- 所有管理操作使用已安装 runtimePath，不能从插件缓存运行服务。数据目录默认 `%USERPROFILE%\.feishu-codex-bridge`，程序目录与数据分开。若用户已有 FEISHU_CODEX_HOME，保留其选择，并对所有管理命令一致传入 `-DataDirectory`。
- 退出 Codex 桌面后服务应继续运行；关机、注销、休眠或断网会影响处理。开机启动仅在用户要求时执行 `-Action startup-on`。
- 飞书拥有会话写权限期间，桌面可以查看历史但显示占用提示；这是预期行为。要交给桌面，停止桥接并确认终态。`/stop` 只取消模型任务，不释放服务的会话占用。后台 projectId 不证明桌面归组；未显示时通过会话右键“移动到项目”处理，不反复要求刷新。
- 诊断先 status，再 doctor。doctor 只检查配置和机器人身份；不证明所有权限、模型执行或附件交付成功。仅报告脱敏错误码，不展示原始日志/SDK 响应。
- 执行未知先 `/recover`，交付失败按使用说明 使用 `/retry`；不要重跑可能有副作用的任务，不手改数据库。
- 升级：停止并确认 stopped，备份数据，重新运行安装脚本生成新运行目录，再从新目录启动。旧运行目录保留。若启用了开机启动，从新目录重新设置。不要假设任意版本可以直接回滚。
- 卸载：优先按下方“完整卸载”执行。私有账号插件绑定的后台在 pluginLifecycle=watching 时也检测官方插件卸载状态；明确未安装持续至少 60 秒才清理。未绑定、后台未运行或检查不可用时，不承诺按钮自动清理。
- 完成时分开报告：已安装、已配对、连接就绪、实际消息测试；未验证的项目不要标为通过。其他电脑的干净安装仍需现场验收。

## 完整卸载

用户说“完整卸载飞书桥接”即授权此流程，不再要求重复确认。先运行当前插件根目录的 `scripts/uninstall-plugin.ps1`，它可清理旧版本运行实例，无需为卸载重新安装运行环境。默认读取 current.json；旧 ZIP 或源码部署无记录时，先从已知安装路径或属于本程序的计划任务 Action 确认运行目录，再传 `-BridgeRoot`，不猜目录。自定义数据目录始终传 `-DataDirectory`。

如果 `bridge_uninstall` 工具可用，优先调用它替代上述脚本；返回 isError=true 时停止后续插件卸载，保留排查入口。工具不会自行卸载 Codex 插件，仍需最后调用 Codex 的卸载工具。

脚本请求正常停止，最多等 45 秒，再移除该数据目录的后台任务及匹配的自启动项。默认安装目录里的当前运行文件会删除；源码仓库、自定义安装目录、旧版本备份和下载缓存保留，并向用户说明。配置、附件和 Codex 历史保留。不要自动删除用户文件。

脚本非零退出时停止后续步骤，说明已完成及未完成部分，不强杀 PID、不先卸载插件。成功后才调用 Codex `uninstall_plugin` 工具，精确指定本插件 `feishu-codex-bridge`；工具不可用时请用户最后在插件管理中卸载。卸载插件是最后一步，此后 Skill 可能不可用。分别报告服务清理结果和插件卸载结果。

自动检测通过已绑定的后台轮询 plugin/read（按远端插件 ID 查询详情） 实现，尚无官方回调。后台启动后检查 pluginLifecycle；遇到 RUNTIME_UPGRADE_REQUIRED 需停止并升级运行文件，不能仅更新插件后就宣称后台已升级。遇到 LIFECYCLE_ENROLLMENT_FAILED 核对登录与远端插件安装，不跳过绑定。禁用、目录消失、网络错误和缺少结果不得当作卸载；检查失败时使用手动完整卸载。数据目录 plugin-cleanup.json 记录自动清理结果。

## 消息与授权

普通消息用 Typing 表情反馈，回复后撤销；需表情写入权限。个人授权由新会话动态工具 bridge_feishu_authorize 发起卡片，只支持主人私聊，使用桥接独立配置目录中的 lark-cli 登录；应用 ID 或用户不一致时拒绝操作，不自动覆盖 CLI 的其他应用配置。旧会话需用户发送 /new 后启用，不能擅自删除历史。

更新插件不会升级后台文件。停止并确认退出后，从新插件运行安装脚本，保留原数据，再启动新运行目录。请用户发一条普通消息、/new 后请求读取文档并点卡片授权。扫码创建用另一个测试数据目录或另一台电脑验收，已有应用不重新创建。记录真实权限、二维码、授权成功和失败结果，尚未联调不能宣称通过。

## 个人资源配置

配置时让用户选择是否启用个人飞书资源访问（Y）；确认后才启用 CLI 用户身份。初次独立绑定由实际后台进程完成，避免桌面与后台凭据存储差异。不要从当前 agent 手工 config init 覆盖全局应用，也不要把密钥写进参数。后台状态 cli.state=ready 才代表应用凭据检查完成；用户授权仍需卡片。CLI unavailable 不代表桥接断连，应单独报告。已有配置不重新 setup。升级时保留数据和旧目录。

## 群权限与共享上下文

用 bridge_permissions_get 读取规则和 revision，再按用户明确要求调用 bridge_permissions_set，传 expectedRevision 和完整 permissions。仅支持明确 chatId/open_id，不凭名称猜 ID。先展示目标群、成员与修改内容；用户已明确指定即执行。修改前停止后台，停止会中断当前任务，先检查 active 并等待空闲；保存后从同一 dataDirectory 启动，确认连接。旧 revision 会拒绝，先重读再判断，不盲目重试。

permissions.groupContext=shared 表示每群一个上下文（含话题），per-sender 保持旧版成员/话题隔离。改变模式只影响后续路由，旧历史保留。群规则包含 chatId、enabled、requireMention、senderIds、trustedLocalAccess；未列出的群/成员拒绝，私聊仍仅主人。/new /stop /recover /retry 仅主人，问答只能原请求人回答。

新增非主人前必须向用户说明：当前共享 Windows 身份并非系统级隔离，成员可通过模型使用本机执行环境能力；只有用户明确接受该信任范围才设 trustedLocalAccess=true，否则不开放非主人成员。此字段不是凭据隔离或安全沙箱。个人画像仅在主人私聊自动注入，群聊不能以此获得个人 OAuth 授权。

自定义正式数据目录必须每次传 dataDirectory，不要误操作默认测试配置。工作区知识不属于插件包；不上传个人画像、工作记录、密钥。旧桥接与新桥接不能同时连接同一应用。

普通答复使用 Markdown 卡片，授权卡片保持独立。升级插件后仍须升级并重启后台运行目录，不能只凭插件版本推断当前消息格式。

## 项目绑定兼容性

初始化时先让用户在桌面添加工作目录，再在停止状态用 manage.ps1 -Action project 选择已有后台项目。明确后台 ID 时可用 node src/cli.mjs project <ID>；此 ID 不是桌面 list_projects 的本地 ID，必须通过 project/list 核对路径与名称，不能直接混用。保留原 dataDirectory。没有项目不创建，同路径多个项目不猜测。projectBinding.backend_selected 只表示后续新会话的后台目标，desktopVisibility=unverified 必须保留。旧版本无字段也不能宣称归组成功。

已有会话不迁移/重建历史。当前桌面有会话右键“移动到项目”入口；无桌面控制工具时请用户操作并确认实际显示，不通过 shell 修改私有状态。后续新会话也可能需要手动归组，不承诺操作一次解决所有新会话。

群规则 allowAllMembers=true 允许该已列出群的所有当前及未来人类成员发起任务，必须同时 trustedLocalAccess=true。无需读取群成员列表；私聊仍仅主人、未列出群不开放、主人管理命令限制不变。默认省略或 false 保留 senderIds 白名单。此权限允许成员使用当前本机执行权限。

## 共享规则热更新

统一设定维护在绑定工作区根目录 AGENTS.md。后台每轮执行前读取（UTF-8，最多 64 KiB），内容变化时用 thread/inject_items 注入已加载会话，不启动确认回合、不停止桥接。管理会话修改文件即可，不要逐个发送“同步规则”消息。正在执行的一轮不受影响，下一轮使用新版；建议临时文件加原子替换保存。空白、超限、已读取文件消失或注入失败时拒绝该轮，修复后重新发送请求。首次没有 AGENTS.md 的工作区保持原行为；不要通过删除文件撤销旧规则，应写清新的替代规则。

status 的 sharedRules 提供最近检查时间、内容哈希和本进程各 thread 的注入版本；它证明协议注入成功，不代表模型已逐条理解或完成确认。未收新消息的会话无需提前唤醒。仅热加载根目录此文件，不递归展开引用文件、不重载 Skill；私人指令仍仅限主人私聊。修改规则不扩大工具权限。
