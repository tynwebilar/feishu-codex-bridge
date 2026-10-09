# 安装飞书 Codex 桥接

[English](INSTALL.md) · [项目介绍](README.zh-CN.md)

需要 Windows x64、网络、自己的 Codex 登录和飞书机器人。仓库仍为私有，Git 安装需要访问权限。

## Codex 命令安装

需要 Git 和支持插件市场的 Codex CLI：

```powershell
codex plugin marketplace add tynwebilar/feishu-codex-bridge
codex plugin add feishu-codex-bridge@feishu-codex
```

告诉 Codex：“帮我初始化飞书 Codex 桥接，一步步引导我完成配置。”仅安装插件不会启动后台。Git 安装使用 manual 生命周期模式。

## 源码安装

```powershell
git clone https://github.com/tynwebilar/feishu-codex-bridge.git
cd feishu-codex-bridge
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-plugin.ps1 -LifecycleMode manual
```

安装脚本下载并校验 Node，无需预装。将返回的 runtimePath 填入变量：

```powershell
$bridgeRuntime = 'C:\安装程序返回的实际目录'
& "$bridgeRuntime\manage.ps1" -Action login
& "$bridgeRuntime\manage.ps1" -Action setup
& "$bridgeRuntime\manage.ps1" -Action pair
```

Secret 只在本机输入，不发到聊天中。明确选择工作区及执行权限，同一机器人不要同时连接多个桥接器。私聊发送终端中的临时配对指令，成功后 Ctrl+C 结束前台，再执行：

```powershell
& "$bridgeRuntime\manage.ps1" -Action start
& "$bridgeRuntime\manage.ps1" -Action status
```

使用独立配置目录时，每条管理命令均指定相同的 `-DataDirectory 'C:\自己的配置目录'`。

## 压缩包

插件 ZIP 包含引导、管理 MCP 和安装脚本；完整 Windows 包包含运行环境，解压后打开 Start.cmd。当前向维护者获取预览包并核对 SHA256，尚无公开发布下载。不要导入他人的凭据。

## 验收

飞书后台需启用机器人、长连接消息事件和相应权限，并按租户要求发布或审批，详见 [使用说明](docs/usage.zh-CN.md)。扫码建机器人和个人授权依赖单独安装的官方飞书 CLI。

检查 paired=true、飞书与 Codex 均已连接、心跳未过期。验收两轮记忆、图片/附件输入、文件输出，以及关闭桌面端后的回复。项目列表可能需要重启桌面版刷新。群聊默认关闭；完全访问不局限于工作区目录。

## 升级与卸载

等任务空闲后停止后台，安装新版运行文件，使用原配置目录启动。仅更新插件不会升级后台；保留旧运行文件用于回滚，不重复 setup。

告诉 Codex“完整卸载飞书 Codex 桥接”，或执行：

```powershell
& "$bridgeRuntime\manage.ps1" -Action uninstall
```

后台清理成功后再移除插件。Git/源码安装不会自动检测插件移除。配置、附件及 Codex 历史保留；旧运行备份和自定义安装目录也可能保留。
