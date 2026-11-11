# Parallax Game Designer Opt 维护说明

本仓库以 Houchen181 的 [Parallax v0.4.2](https://github.com/Houchen181/parallax/tree/v0.4.2) 为基线。入口和用户操作见 [README](../README.md)，原作者的版权与许可声明见 [LICENSE](../LICENSE)。

## 游戏设计讨论流程

- [engine.ts](../src/renderer/src/lib/engine.ts) 负责发送、广播、群聊发言和重生成。[prompt.ts](../src/renderer/src/lib/prompt.ts) 组装设计提示、简报与上下文。单聊使用咨询提示，广播中的独立分栏使用同一比较维度，群聊按参与者分配默认设计视角。参与者的自定义 Persona 优先于默认视角。
- 群聊每个普通用户消息的第一轮都使用截至该消息的历史快照。**Continue** 和追加轮读取已有回复，`@name` 用于指定模型追问。首轮回复的 `groupOpening` 字段让重生成沿用对应的历史边界。
- **换方向**只向模型发送设计简报和用户消息。`designAttempt` 记录构思方法的轮次，广播目标在同一轮使用同一方法，重生成也沿用该次方法。它会发起一次新回复，群聊时为一轮。输入框有草稿时会作为新用户消息发送。
- 单聊和群聊在 **Instructions / design brief** 中保存简报。新建横向对比时，[NewCompareDialog.tsx](../src/renderer/src/components/NewCompareDialog.tsx) 在发送首条消息前，把共用简报写入各个新分栏。之后各分栏有自己的对话历史。

## 思考强度与提供商

[reasoningEffort.ts](../src/renderer/src/lib/reasoningEffort.ts) 选择参与模型中最宽的档位表，并在发送时换算为每个模型的参数值。对话保存选中的值和当时的档位表 `reasoningEffortScale`。广播时在输入框选档会写入参与发送且支持此功能的分栏。分栏已有不同设置时显示 **Mixed**，重新选档即可统一。

| 五档参考 | DeepSeek 官方接口 | 当前四档 Grok 4.7 |
| --- | --- | --- |
| `low` | `low` | `low` |
| `medium` | `low` | `medium` |
| `high` | `high` | `high` |
| `xhigh` | `max` | `xhigh` |
| `max` | `max` | `xhigh` |

五档 Claude 和 GPT 按对应档位发送。GPT 的 `ultra` 从选择器移除，旧对话存了 `ultra` 且目标支持 `max` 时使用 `max`。显式选择 **Default** 会省略该次请求的强度参数。Claude 对话未设置强度时，可沿用提供商设置中的 Effort。不同提供商的同名档位不代表相同的 token 预算。

| 接入 | 能力来源和参数 |
| --- | --- |
| [ChatGPT Plan](../src/renderer/src/lib/providers/chatgpt.ts) | 模型目录的 `supported_reasoning_levels`，发送 `reasoning.effort` |
| [Cursor SDK](../src/main/cursor.ts) | `Cursor.models.list()` 的模型参数，发送 `model.params` |
| [DeepSeek 官方接口](../src/renderer/src/lib/providers/openai.ts) | `effort.supported_levels`，发送 `reasoning_effort` |
| [Claude](../src/renderer/src/lib/providers/anthropic.ts) | 模型目录的 `capabilities.effort`，发送 `output_config.effort`。已有缓存缺少明细时使用已知型号的档位 |

模型档位有变化时，可在 **Settings → Providers** 刷新模型目录。改动映射时优先运行 `npm test -- src/renderer/src/lib/reasoningEffort.test.ts`，需要核对实际请求时再运行对应的提供商测试。

## Cursor 登录与桌面运行

- [main/index.ts](../src/main/index.ts) 接收登录请求。[cursor.ts](../src/main/cursor.ts) 用 `Cursor.auth.login()` 打开官方浏览器授权。生成的个人凭据由 Parallax 使用 Electron `safeStorage` 加密保存，`store: null` 让 SDK 将凭据交给应用管理。用量归属于授权账号的 Cursor 计划。 [Cursor SDK 认证与计费](https://cursor.com/docs/sdk/typescript#usage-and-billing)
- `https://cursor-sdk.invalid` 是 Electron 主进程用于识别 Cursor 请求的内部地址。主进程处理模型目录和聊天调用。每次聊天使用临时目录并关闭 Agent 工具，回复在 SDK 运行结束后一次显示。聊天指令随普通消息发给 SDK，适配未开放自定义 system prompt 的账号。
- `@cursor/sdk` 由 Electron 主进程在运行时加载。`zod` 必须保留在生产依赖，Windows SDK 辅助二进制由打包器放入 `app.asar.unpacked`。调整依赖或打包规则后，从构建产物验证 Cursor 提供商能加载模型目录。

## Windows 构建与更新

使用 Windows x64 和 Node.js 24。新检出运行 `npm ci`。`npm run dev` 启动开发版，`npm run dist:win` 执行构建并在 `release/` 生成安装器。产品名和应用标识沿用 Parallax，正常安装会使用原有的用户数据目录。需要隔离调试时可在启动前设置 `PARALLAX_USER_DATA`，例如 `$env:PARALLAX_USER_DATA = Join-Path $env:TEMP 'parallax-dev-profile'`。

用安装器更新已有安装。如果在本机用 `win-unpacked` 做临时覆盖，先退出 Parallax，并成套使用同一次构建的 `Parallax.exe`、`resources/app.asar` 和 `resources/app.asar.unpacked`。可执行文件内包含与归档匹配的完整性信息。

## 上游同步与发布

- 在当前仓库的检出中可添加 `upstream` 远程 `https://github.com/Houchen181/parallax.git`。同步前先比较上游对 Electron IPC、模型目录、群聊引擎和打包流程的改动。
- 修改插件与桌面共用的提示词或提供商代码后，运行 `npm run build:plugin`，提交 `plugins/parallax/server/` 中更新的已跟踪构建产物和依赖许可清单。`main` 的 GitHub Actions 会验证插件包是否同步并构建网页版本。
- GitHub Pages 部署步骤限定在上游仓库。发布本分支的 Windows 安装器时，先更新版本，再推送本分支的 `v*` 标签触发发布工作流。应用数据、凭据和 `release/` 下的本地包留在工作站。
