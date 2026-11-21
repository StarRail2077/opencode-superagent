# opencode-superagent

为 **OpenCode Desktop** 做的 Superagent 插件：Router / Worker 双层委派 + 独立 Watchdog 巡检。
参考 DeepSeek `dsh-superagent` 的思路，但完全适配 OpenCode V2 的插件、RPC、GUI 和桌面端设置页。

> Watchdog 默认关闭。只有你在设置页或面板里手动打开后，它才会开始巡检。

## 功能

- **Superagent 模式**
  - 安装脚本会把 `agents/superagent.md` 安装到 OpenCode 的全局 Agent 目录。
  - 只有选择 **Superagent** Agent 后，`superagent_*` 工具才可见、可调用。
  - 普通 Build / Plan 等 Agent 不会看到 Superagent 工具。
  - 可在 **设置 > Superagent** 新建 Superagent 会话，或把当前会话切换为 Superagent 模式。
- **Router / Worker**
  - 当前主会话就是 Router。
  - 主会话通过 `superagent_dispatch` 工具或 `/superagent <任务>` 命令把工作交给独立 Worker 会话。
  - Worker 拥有自己的上下文、模型、Agent 预设和 ticket，不阻塞主会话。
- **手动开关 Watchdog**
  - 桌面设置页、Superagent 面板、命令面板；Superagent 模式内也可以使用工具开关。
  - 关闭后不会自动巡检，也不会干预 Worker。
- **手动选择模型**
  - Worker（subagent）模型：单独选择，只影响新 Worker。
  - Watchdog 模型：单独选择，切换后立即应用到已有的 Watchdog 会话。
  - 模型选择使用可搜索的桌面选择框，不会把上百个模型塞进一个下拉列表。
- **独立 Watchdog**
  - 单独的 OpenCode 会话，运行时会移除全部工具，只输出结构化 JSON。
  - 判断每个 Worker 是 `on_track` / `stalled` / `off_track` / `needs_input` / `done` / `failed`。
  - 可执行 `none` / `nudge` / `interrupt` / `escalate`，并受“允许自动恢复”开关约束。
- **桌面端适配**
  - 设置 > Superagent 设置页，界面默认中文，可切换 English 或跟随系统。
  - 所有面板、命令、Toast、通知都支持中英文。
  - 会话侧边栏面板 / 启动器 / 命令面板命令。
  - Composer 上方的 Worker 状态胶囊。
  - 系统通知、Toast、打开 Worker 会话。
- **一键迁移**
  - 导出 JSON profile（模型、Agent、界面语言、嵌套 subagent 策略、巡检策略）。
  - 复制插件目录到另一台电脑，运行安装脚本并带上 profile。
  - 新机器首次启动时自动导入 profile，不需要再手动配置。
  - API Key、会话历史、ticket 不会离开本机。

## 与 DeepSeek Superagent 的对应关系

| DeepSeek Superagent | 本插件 |
| --- | --- |
| Router | 当前主会话 + `superagent` 工具命名空间 |
| Worker Session | 独立 Worker 会话（独立上下文/模型） |
| Watchdog Session | 独立 Watchdog 会话（无工具，只做判断） |
| Ticket | 插件存储中的 ticket 记录 |
| Trigger | `superagent_dispatch` 工具、`/superagent` 命令、面板中的 Dispatch |
| Thread / Subscription | Worker 会话本身；Watchdog 通过事件流跟踪其活动 |
| 持久化 | `ctx.storage` + 可导出的 profile JSON |
| BYOM | 运行在本地桌面端；迁移只复制插件和设置 |

## 环境要求

- OpenCode Desktop V2（已在 `2.2.6` / `2.3.2` 上验证）。
- Node.js（仅安装脚本需要；插件运行时由 OpenCode 提供依赖）。
- 至少一个已配置的模型 Provider。

## 一键安装（GitHub）

### Windows：下载后双击

1. 在 GitHub 页面点 **Code → Download ZIP**，解压。
2. 双击根目录的 `install.cmd`。
3. 重启 OpenCode Desktop。

`install.cmd` 会以绕过执行策略的方式调用 `install.ps1`，不需要手动打开 PowerShell。

安装脚本会同时：

- 把插件复制到 `~/.config/opencode/plugins/opencode-superagent`；
- 把 Superagent 模式写入 `~/.config/opencode/agents/superagent.md`；
- 在全局 `opencode.jsonc` 的 `plugins` 数组中加入插件条目。

### Windows：一行命令

把 `<owner>/<repo>` 换成你的 GitHub 仓库：

```powershell
$env:OPENCODE_SUPERAGENT_REPO="<owner>/<repo>"; irm https://raw.githubusercontent.com/<owner>/<repo>/main/install.ps1 | iex
```

如果已经解压到本地，也可以直接：

```powershell
.\install.ps1
```

### macOS / Linux

```sh
sh ./install.sh
```

或从 GitHub 下载并执行：

```sh
OPENCODE_SUPERAGENT_REPO=<owner>/<repo> sh -c "$(curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh)"
```

> 一行命令会下载仓库的 `main` 分支归档，再调用 `scripts/install.sh`。如果使用 Release 压缩包，解压后运行根目录的 `install.sh` 即可。

安装脚本会：

1. 把 `dist/`、`package.json` 等复制到 `~/.config/opencode/plugins/opencode-superagent`。
2. 在全局 `opencode.jsonc` 的 **`plugins`** 数组中加一个本地插件条目。
3. 如果带了 `--profile`，会把 profile 直接嵌入这个插件条目的 `options.profile`，首次启动自动导入。
4. 提示你重启桌面端。

如果你更喜欢用 npm 包安装，也可以先 `npm publish`，然后：

```sh
opencode plugin add opencode-superagent --global
```

## 安装（当前电脑，手动）

在插件目录中：

```powershell
# Windows
.\scripts\install.ps1
```

```sh
# macOS / Linux
sh ./scripts/install.sh
# 或者先 chmod +x scripts/install.sh 再 ./scripts/install.sh
```

脚本会：

1. 把 `dist/`、`package.json` 等复制到 `~/.config/opencode/plugins/opencode-superagent`。
2. 在全局 `opencode.jsonc` 的 **`plugins`** 数组中加一个本地插件条目。
3. 如果带了 `--profile`，会把 profile 直接嵌入这个插件条目的 `options.profile`，首次启动自动导入。
4. 提示你重启桌面端。

如果不想改配置文件，加 `-NoConfig` / `--no-config`，然后手动在全局 `opencode.jsonc` 中加入：

```jsonc
{
  "plugins": ["./plugins/opencode-superagent"]
}
```

> 桌面端只从全局 `opencode.json(c)` 加载 GUI 插件，所以不要只放到项目 `.opencode/plugins/`。
>
> 安装脚本优先使用 V2 的 `"plugins"` 键；你原有的 `"plugin"` 键不会被删除。两者可以同时存在，OpenCode 会把它们合并加载。

## 从源码构建

```bash
npm install
npm run build
```

产物：

```text
dist/
├── gui-experimental.cjs   # 桌面 GUI（CJS）
├── rpc.js                 # RPC 契约
├── shared.js
└── server/                # OpenCode server 插件
```

## 上传到 GitHub / 发布 Release

仓库已经按 GitHub 项目结构准备好，不包含本机配置、模型选择、API Key 或绝对路径。

```bash
git init
git add .
git commit -m "feat: OpenCode desktop superagent with watchdog"
git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

发布压缩包：

```bash
npm run build
npm test
npm run package:release
```

会在 `release/` 生成 `opencode-superagent-<version>.tar.gz`，可以直接上传到 GitHub Releases。
Windows 也可以直接用 PowerShell 压缩：

```powershell
Compress-Archive -Path dist,src,scripts,examples,tests,package.json,package-lock.json,README.md,LICENSE,install.cmd,install.ps1,install.sh,tsconfig.json,tsconfig.server.json,vite.config.ts,.gitignore -DestinationPath release\opencode-superagent.zip -Force
```

## 使用

### 0. 进入 Superagent 模式

任选一种：

- 打开 **设置 > Superagent**，点击 **新建 Superagent 会话**（推荐）；
- 在桌面端的 Agent 选择器中选择 **Superagent**；
- 打开 **设置 > Superagent**，点击 **切换当前会话**；
- 在命令面板运行 **Superagent：新建 Superagent 会话** 或 **Superagent：进入 Superagent 模式**。

只有这个模式可以调用 `superagent_*` 工具和派发 Worker。普通 Agent 即使知道工具名也调用不到。

### 1. 选择模型

打开 **设置 > Superagent**：

- **界面语言**：中文（默认）、English 或跟随系统。
- **Worker（subagent）模型**：Worker 使用的模型。
- **Watchdog 模型**：Watchdog 使用的模型。
- **Worker / Watchdog Agent 预设**：可选的 Agent 预设。
- **巡检间隔**：Watchdog 巡检间隔。
- **停滞阈值**：多久没有活动算停滞。
- **允许自动恢复**：关闭后 Watchdog 只记录/升级，不会 nudge 或 interrupt。
- **允许 subagent 再开 subagent**：默认关闭。关闭后 Worker 不能再创建下一层 subagent。
- **Worker 上限**：并发 Worker 上限。

模型选择会打开可搜索的桌面选择框，支持所有当前可用 Provider 的模型。

### 2. 打开 Watchdog

在设置页或 Superagent 面板中打开 **Watchdog** 开关。打开后：

- 按间隔巡检所有活跃 Worker。
- 也可以在面板点 **立即检查** 立即巡检一次。
- 点 **打开 Watchdog 会话** 可以直接查看 Watchdog 会话的推理记录。

### 3. 派发 Worker

方式一：让主 Agent 使用工具：

```text
superagent_dispatch({ task: "修复 ...", title: "..." })
```

方式二：命令：

```text
/superagent 修复登录页的竞态问题，并补测试
```

方式三：Superagent 面板里的 **派发 Worker**。

返回值包含 `ticketID` 和 `sessionID`。之后可以：

- `superagent_status`：查看所有 ticket。
- `superagent_collect`：等待并读取 Worker 的最新报告。
- `superagent_cancel`：中断 Worker。
- 面板里 **Open**：直接打开 Worker 会话。

### 4. Watchdog 的判断

Watchdog 每次收到的是紧凑快照，而不是完整会话：

- ticket 标题、状态、年龄、空闲时间；
- 最近的 Assistant 文本；
- 最近使用的工具；
- 错误信息；
- 已经 nudge / check 的次数。

它必须返回严格 JSON，例如：

```json
{
  "summary": "One worker is healthy, one is stalled",
  "workers": [
    {
      "ticketID": "t_...",
      "assessment": "stalled",
      "action": "interrupt",
      "reason": "No activity for 12 minutes and the same test command repeated 4 times",
      "message": "Stop rerunning the full suite. Run the failing test file only."
    }
  ]
}
```

## 一键迁移到另一台电脑

### 方法 A：带 profile 安装（推荐）

1. 在旧电脑 **设置 > Superagent > 导出**，得到 `superagent-profile.json`。
2. 把整个 `opencode-superagent` 文件夹（至少包含 `dist/`、`package.json`、`scripts/`）复制到新电脑。
3. 在新电脑运行：

```powershell
.\scripts\install.ps1 -Profile .\superagent-profile.json
```

```sh
sh ./scripts/install.sh --profile ./superagent-profile.json
```

4. 重启 OpenCode Desktop。

安装脚本会把 profile 嵌入全局配置里的插件条目：

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/opencode-superagent",
      "options": {
        "profile": { "kind": "opencode-superagent-profile", "version": 1, "settings": { /* ... */ } }
      }
    }
  ]
}
```

插件启动时按 `exportedAt` 判断是否是新 profile，只导入一次。再次用新 profile 安装会覆盖旧 profile 的设置；普通启动不会覆盖你之后的修改。

### 方法 B：只在 GUI 里导入

1. 新电脑先运行 `install.ps1` / `install.sh`。
2. 重启桌面端。
3. **设置 > Superagent > 导入**，选择 `superagent-profile.json`。

### 不会迁移的内容

- API Key / OAuth 凭据；
- 会话历史、ticket 历史；
- 本机路径；
- 已安装的 Provider。

这些由 OpenCode 自己管理，建议在新电脑上先配置好 Provider。

## 命令与工具

### 工具

| 工具 | 作用 |
| --- | --- |
| `superagent_dispatch` | 创建 Worker 并派发任务 |
| `superagent_status` | 列出 ticket、模型、Watchdog 状态 |
| `superagent_collect` | 等待 Worker 到达 turn 边界并读取报告 |
| `superagent_cancel` | 中断 Worker |
| `superagent_watchdog` | `status` / `enable` / `disable` / `run` / `settings` |
| `superagent_open_watchdog` | 返回 Watchdog 会话 id |

### 命令面板

- `Superagent: open dashboard`
- `Superagent：新建 Superagent 会话`
- `Superagent：进入 Superagent 模式`
- `Superagent：启用/关闭 Watchdog`
- `Superagent：立即运行 Watchdog`
- `Superagent: settings`

### 斜杠命令

- `/superagent <任务>`：把剩余文本派发给 Worker。

## 安全边界

- Watchdog 会话在运行时会被移除全部工具，只做观察和 JSON 输出。
- Watchdog 默认关闭，关闭时不会自动巡检。
- “允许自动恢复”关闭后，Watchdog 只能记录和升级，不能修改 Worker。
- Worker 仍然使用 OpenCode 的权限系统；插件不会自动批准工具调用。
- 导出的 profile 不包含任何密钥。

## 当前限制

- OpenCode 插件 API 目前不能给 `session.create` 传 `parentID`，所以 Worker 是**独立根会话**，不是真正的 child subagent。它们仍然独立并发、独立上下文，并且由 Superagent 面板统一管理。
- Watchdog 的判断依赖模型质量。建议给它一个稳定、低温度的模型；如果模型不支持工具调用也没关系，因为工具会被移除。
- Watchdog 每次巡检会产生一次模型调用；请合理设置间隔。
- 免费模型可能触发 Provider 的免费额度限制，建议生产使用付费模型。

## 卸载

1. 从全局 `~/.config/opencode/opencode.jsonc` 的 `plugins` 数组里删除 `./plugins/opencode-superagent` 条目。
2. 删除 `~/.config/opencode/plugins/opencode-superagent`。
3. 删除 `~/.config/opencode/agents/superagent.md`（Superagent 模式）。
4. 重启 OpenCode Desktop。

安装脚本第一次修改配置前会在同目录留下 `opencode.jsonc.bak-superagent`，需要回滚时可以恢复它。

## 故障排查

- **设置页没有 Superagent**：确认插件在**全局** `~/.config/opencode/opencode.json(c)` 中，而不是只在项目配置里。
- **插件加载失败**：查看 OpenCode 日志；确认 `dist/server/index.js` 和 `dist/gui-experimental.cjs` 存在。
- **Agent 选择器里没有 Superagent**：重新运行 `install.ps1` / `install.sh`，确认 `~/.config/opencode/agents/superagent.md` 存在，然后重启桌面端。
- **提示 Superagent 工具不可用**：当前会话不在 Superagent 模式。用设置页或命令面板切换模式后再试。
- **Worker 立即失败**：检查所选模型/Agent 是否在当前 Provider 中可用；插件会尝试回退到默认模型并在 ticket 中记录错误。
- **Watchdog 报“Free usage limit reached”**：换一个已配置的付费模型。
- **迁移后模型不可用**：导入时会自动把不可用模型置空；重新在设置页选择即可。

## License

MIT
