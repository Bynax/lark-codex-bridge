# lark-codex-bridge

把飞书 / Lark 聊天消息接到本地 Codex CLI 的轻量 bot。启动后，你可以在飞书私聊里直接和 Codex 对话，或在群里 `@bot` 让 Codex 在本机指定工作目录里处理代码任务。

## 当前功能

- 私聊直接响应；群聊和话题群默认需要 `@bot`
- 每个 chat / 话题独立 Codex session，后续消息自动续聊
- `/new` `/reset` 新建会话，`/stop` 中断当前任务
- `/new chat [name]` 创建新群，并把发起人拉进群里
- `/cd <path>` 切换当前 chat 的工作目录
- `/ws list|save|use|remove` 管理命名工作空间，带飞书卡片按钮
- `/status` `/help` `/config` 返回飞书交互卡片
- Codex 工具调用和最终回复会渲染到同一张流式卡片或 markdown 消息
- 图片会下载到本地并作为 Codex image 输入；其它文件以本地路径注入 prompt
- 引用消息和收到的飞书卡片会被展开为上下文给 Codex

## 不包含

- 云文档评论 `@bot`
- 日历、审批、文档等飞书业务 API 集成
- `/doctor` 日志诊断
- lark-cli 自动安装 / 绑定

## 前置条件

- Node.js >= 20
- 已安装并登录 `codex` CLI

```bash
npm install -g @openai/codex
codex
```

## 安装和启动

```bash
pnpm install
pnpm build
node ./bin/lark-codex-bridge.mjs run
```

首次启动如果没有配置，会进入飞书扫码创建 / 绑定应用向导。配置会保存到：

```text
~/.lark-codex/config.json
```

## CLI 命令

```text
lark-codex-bridge run [-c <config>]   前台启动 bot
lark-codex-bridge ps                  列出本机运行中的 bridge 进程
lark-codex-bridge kill <id|#>         终止指定 bridge 进程

lark-codex-bridge start               注册并启动后台 daemon
lark-codex-bridge stop                停止 daemon
lark-codex-bridge restart             重启 daemon
lark-codex-bridge status              查看 daemon 状态
lark-codex-bridge unregister          删除服务注册
```

## 飞书内命令

| 命令 | 作用 |
|---|---|
| `/new` `/reset` | 清空当前 chat 的 Codex 会话 |
| `/new chat [name]` | 创建新群并开始新的协作上下文 |
| `/resume [N]` | 列出最近 Codex 会话并可点按钮恢复 |
| `/cd <path>` | 切换工作目录，重置当前 session |
| `/ws list` | 列出工作空间卡片 |
| `/ws save <name>` | 保存当前 cwd 为命名工作空间 |
| `/ws use <name>` | 切换到命名工作空间 |
| `/ws remove <name>` | 删除命名工作空间 |
| `/status` | 查看当前 cwd / session / agent |
| `/config` | 调整回复方式、工具显示、并发、权限等 |
| `/stop` | 中断当前 Codex run |
| `/timeout [N\|off\|default]` | 当前 session 的空闲超时 |
| `/ps` | 列出本机运行中的 bot |
| `/exit <id\|#>` | 关闭指定 bot |
| `/reconnect` | 强制重连飞书 WebSocket |
| `/help` | 帮助卡片 |

其它内容会直接交给 Codex。

## 数据目录

| 路径 | 内容 |
|---|---|
| `~/.lark-codex/config.json` | 飞书应用凭据 |
| `~/.lark-codex/secrets.enc` | 加密保存的 App Secret |
| `~/.lark-codex/sessions.json` | chat / 话题到 Codex session 的映射 |
| `~/.lark-codex/workspaces.json` | 命名工作空间 |
| `~/.lark-codex/processes.json` | 运行中 bridge 进程注册表 |
| `~/.lark-codex/media/<chatId>/` | 下载的图片 / 文件缓存 |
| `~/.lark-codex/logs/YYYY-MM-DD.log` | 结构化运行日志 |
