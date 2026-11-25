# dsh-agy-bridge

中文 | [English](README.en.md)

**这是界面桥，不是反向代理。** 它在 DeepSeek Harness（DSH）里为本机已登录的官方 Google Antigravity CLI（`agy`）提供会话界面，通过公开的 [Agent Client Protocol（ACP）](https://agentclientprotocol.com/) 与 `agy acp` 在本地通信。插件不读取、导出或转发 agy 的登录凭据，不提供独立 HTTP 或 OpenAI 兼容端口，也不把 agy 作为服务开放给其他程序或网络。

用户自己的 agy 账号承担模型用量和额度；工具、工作区信任与原生权限由 agy 管理。DSH 提供会话界面、历史管理和审批入口。**本项目非官方，与 Google 无关联。** Antigravity、Gemini 等商标归各自所有者。请遵守 Antigravity 的服务条款。

## 安装

1. 安装官方 Antigravity CLI，在终端运行 `agy --version` 检查。若需登录，运行 `agy` 或 `agy acp --login`；授权在 CLI 完成。
2. 下载或克隆本仓库。在 DSH 打开 **插件 → 添加插件**，选择本地 `dsh-agy-bridge` 目录；不需构建或运行安装脚本。按 DSH 提示刷新或重启。
3. 新建一条对话，建议使用空测试工作区。选择 **Google Antigravity CLI → Gemini 3.8 Flash**，把思考强度设为 **Low**。可以先问一句“只回复 OK，不要用工具”。

### 从 `@local/dsh-agy` 升级

先在 DSH 的 **插件** 中移除旧包 `@local/dsh-agy`，再添加新版所在的本地目录。如果要重命名目录，先移除旧的本地安装链接，否则旧链接会指向不存在的目录。不要同时启用两版：两者注册的是同一个 `agy` provider，旧会话和模型选择依然可用，不需要修改会话日志。

新版首次启动时，如果 `$DSH_HOME/dsh-agy-bridge/` 不存在而 `$DSH_HOME/dsh-agy/` 存在，会复制其中已有的 `settings.json`、`sessions.json`，保留旧目录和旧文件；如果目标目录已经存在，就不覆盖、不补拷。`DSH_HOME` 未设置时默认是 `~/.dsh`。旧版仅含 `{executable}` 的设置也可读取。完成升级后按提示完全重启 DSH；已有 Web 页面需刷新。

## 使用

### 模型、用量和界面设置

- 模型选择器按模型族显示，只有实际可选的思考档位才会显示。没指定时优先用 `High`，否则用最高的常规档（`Medium`、`Low`），只有 `XHigh` 时使用 `XHigh`。单档和无档模型不额外提供控件。旧会话里的完整模型 ID（如 `gemini-3.8-flash-low`）保留原档位。
- 打开 **设置 → Antigravity CLI**。版本、额度和模型目录各自刷新；加载期间可先看到设置和上次成功读取的数据。登录状态以 `/usage` 返回有效数据为准。
- **模型显示管理**默认全选，可隐藏模型而不改变正在用它的会话。至少保留一个；点 **全选（恢复默认）** 后保存可恢复完整列表。
- **在对话中显示 agy 工具活动**默认开启。关闭后不显示思考区里的工具进度，但审批及提示不变。**agy 可执行文件路径**可留空，先探测 `~/.local/bin/agy`，再从 `PATH` 查找；手填请用本机的可信绝对路径（可使用 `~/`）。更改路径会关闭现有 ACP 进程，下次请求再启动。

### 权限和工作区

- agy 的工具权限请求通常由 DSH 原生审批。标准的“允许一次 / 拒绝”使用原生卡；额外选项（如“始终允许”）沿用 agy 提供的选项，由 agy 记忆。超时（2 分钟）、审批不可用或非交互调用不会放行。取消对话会发 `session/cancel` 并撤回待答权限。
- 在 DSH 聊天输入区选 **完全权限** 时，插件会自动选 agy 请求中的“允许一次”（如果提供），并在思考区提示；关闭工具活动显示也不隐藏该提示。DSH 的实验性 **Auto review** 只审查 DSH 工具，agy 的请求在该预设下仍走普通审批。**DSH 沙箱不约束独立的 agy 进程。**
- 新会话沿用 agy 默认模式，不传 `--dangerously-skip-permissions`。用聊天输入区的 **agy 模式** 或 `/agy-mode <default|accept-edits|auto|plan>` 切换；不带参数可查看当前模式。主动选择的模式会在重连或重建时恢复。`accept-edits` 与 `auto` 可能让 agy 自己放行某些操作；只有 CLI 发出的审批请求才会经过桥接。
- ACP 使用当前 DSH 会话的工作目录。插件不修改 `trustedWorkspaces`；如遇信任错误，请在同一目录打开 agy 检查。能建立会话不表示该目录或工具已被信任。

### 命令和历史

- `/usage` 或 `/quota`：查询剩余额度，不调用模型。命令使用 DSH 主机时区，设置页使用浏览器本地时区。
- `/agy`：查看 agy 公布的命令。`/agy <command> [args]` 将该命令排入 DSH 对话，发送给 agy 的是对应原生斜杠命令，不拼接其他插件的注入文字。若历史需要重建，先发普通消息再运行命令。以上命令仅用于 agy 会话。
- 续聊只发送新增用户内容（也包括其他插件放入用户消息的上下文），不追加 DSH 系统提示，不提供 DSH 的工具。工作区的 `AGENTS.md` 等指令由 agy 自己读取。分叉、回滚、压缩或切入已有历史时，可新建 agy 会话并将可见文字转写为上下文；匹配的会话在进程重启后会尝试 `session/resume`。
- 插件自己的设置与映射位于 `$DSH_HOME/dsh-agy-bridge/`（默认 `~/.dsh/dsh-agy-bridge/`）。映射记录会话 ID、最后输入/回复的文本和模式，不是完整聊天备份。正式会话和临时会话仍按 agy 的规则保存；卸载不删除这些数据。

## 限制与验证

- 仅声明文本输入；不映射 DSH 的温度、输出上限和停止词。上下文窗口按 agy 报告的 1,048,576 配置。暂不支持导入已有 agy 历史。
- 失败或取消之后，不在同一个 agy 会话上重新提交；后续重试可能在新会话重放。已经发生的工具操作不能撤回，也可能再次发生。工具进度仅为只读提示，不是完整审计；DSH 的工具钩子不会拦截 agy 自带工具。
- 标题、压缩等辅助调用使用独立的临时 ACP 会话。辅助任务自己的指令以用户文字传递，不进入主会话上下文。若其他插件跟随当前模型，它的额外调用也会消耗你的 agy 额度。
- 开发检查用 `npm run check` 和 `npm test`（Node.js 24）。`npm run smoke` 在隔离的临时目录使用真实已登录的 CLI 和 Flash Low，**会消耗少量真实额度**；必要时可用 `npm run smoke -- /path/to/agy` 指定可执行文件，或用 `AGY_TEST_PERMISSION=1` 额外验证权限请求。

参考：[会话建立](https://agentclientprotocol.com/protocol/v1/session-setup)、[工具权限](https://agentclientprotocol.com/protocol/v1/tool-calls#requesting-permission)、[取消](https://agentclientprotocol.com/protocol/v1/prompt-turn#cancellation)、[斜杠命令](https://agentclientprotocol.com/protocol/v1/slash-commands)。授权：[MIT](LICENSE)。
