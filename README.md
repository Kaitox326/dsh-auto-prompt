# dsh-auto-prompt

> 说一句人话，拿到一张图 / 一段片子。
> Describe it in your own words — get a prompt a model can execute, then the actual image or video.

一个 DeepSeek Harness 插件：把你的口语描述交给**你自己配置的大模型**改写成专业提示词，再把提示词交给**你自己配置的图片/视频服务**，产出真正的文件并直接显示在对话里。

不绑定任何服务商：只要接口是 OpenAI 兼容的（或你能用 JSON 路径描述它的异步任务格式），云 API、Ollama、LM Studio、vLLM、ComfyUI 桥接、自建服务都能接。

> **一句话**：一句话 → 提示词 → 图片/视频，中间那步花钱的动作由你亲手开关。
>
> 装好之后它出现在两个地方：**左下角「个人 → 设置 → 自动提示词」**（开关 + 可直接填写的模型地址/API 链接/密钥/模型名）和**插件列表**（显示名字「自动提示词」、一句简介和图标，可整包停用）。

> **兼容 Harness 0.1.x 与 0.2.x**（已验证 0.1.2-rc.1 与 0.2.1-rc.2）。两代 Harness 的设置接口完全不同，插件内部做了适配层，配置文件与字段名不随版本变化。

---

## 生成开关

「理解你的话、写提示词」和「真的出图/出片」是两件事，所以后一步单独有一个开关：

| `generateMedia` | 行为 |
|---|---|
| **关（默认）** | 只产出提示词，并落盘成一份 `.md` 提示词单。**不会**向任何图片/视频服务发请求，不消耗额度。 |
| **开** | 提示词 → 调用后端 → 真实图片/视频文件。 |

默认关闭是有意的：新装先看清楚它会怎么理解你，确认提示词对味了再打开开关，避免上来就烧额度。

想打开，任选一种：

```
打开生成开关
```

或者点界面：**左下角「个人」→「设置」→ 左侧导航「自动提示词」→ 打开「生成开关」**。

这个「自动提示词」页面就是插件自己的设置分区。除了开关，**模型地址、API 链接、密钥、模型名、输出目录都直接在这一页填写**：

| 卡片 | 可填字段 | 说明 |
|---|---|---|
| 提示词模型 | 模型地址 / 模型名 / API 密钥 | 地址填到版本前缀，如 `https://api.deepseek.com/v1`；旁边有 DeepSeek / Ollama / LM Studio 三个常用预设，点一下即填入 |
| 图片服务 | API 链接 / 模型名 / API 密钥 | OpenAI 兼容 `/images/generations` |
| 视频服务 | 提交地址 / 基础地址 / 模型名 / API 密钥 | 异步任务式接口；提交地址留空则用「基础地址 + `/videos`」 |
| 产物保存 | 输出目录（**点「选择文件夹…」弹系统对话框**） | 留空即 `~/.dsh/outputs/auto-prompt` |

输入框**离开或按回车即保存**，不需要确认按钮，写入的是同一份设置文档（和「插件 → dsh-auto-prompt → 配置」里的字段完全等价）。
密钥是 `role('secret')` 字段，Host 不会把明文送到浏览器，所以输入框永远显示为空——留空表示不改动，要清空点右侧的「清除」。
每张卡片右上角有「已配置 / 未配置」标记，配没配齐一眼看得出来。

**输出目录不让人手打路径**：点「选择文件夹…」会驱动宿主自带的目录选择器（`uiWorkspace.pickDirectory()`，和「添加工作区」用的是同一个系统对话框），选完立刻保存；取消对话框不写任何东西，右侧「恢复默认」清掉覆盖值。
如果当前的部署没有组合目录选择器（例如无头的远程浏览器），这个字段会自动退回成普通输入框，不会留一个点不动的按钮。
选择器是**延迟解析**的（`ctx.reflect.get('uiWorkspace')`，而不是声明成硬依赖）——否则缺这个服务的组合作里整个设置页都会消失。

同一页面上，插件列表里的**「停用 / 启用」是另一层开关**：它整包停用插件（工具直接不出现），
和里面的「生成开关」（只停生成、保留提示词能力）不是一回事。

保存后如果提示「已保存，但被更高优先级的配置覆盖 / 当前未生效」，
说明同名条目被组合了两次（通常是既用插件管理器装、又往 `cordis.patch.yml` 插了一次）。
重跑一次 `node scripts/install.mjs` 会自动收敛回单条入口。

---

## 它给了你三个工具

| 工具 | 什么时候用 | 干什么 |
|---|---|---|
| `auto_prompt` | 「帮我想个提示词」「这段话怎么写进 SD / MJ」 | 只写提示词，不生成画面 |
| `auto_media` | 「画一张…」「生成段视频」「帮我出个画面」 | 提示词 →（开关打开时）调用后端 → 落地成图片/视频；开关关着就只出提示词 |
| `auto_config` | 「怎么配」「配好了吗」「为什么报错」「测一下通不通」「打开开关」 | 查看 / 修改 / 体检配置 |

直接说话就行，助手会自己选工具。例如：

```
画一张雨夜霓虹街头的黑猫，电影感，16:9
生成一段 6 秒视频：猫穿过雨后的霓虹街道，镜头缓慢推进
帮我看看这个插件配好了没
```

---

## 安装

### 方式零：从 GitHub 克隆

```bash
git clone https://github.com/Kaitox326/dsh-auto-prompt.git
cd dsh-auto-prompt
node scripts/install.mjs
```

之后**完全退出并重新启动 DSH**。下面两种是手工方式，脚本其实替你做了同样的事。

### 方式一：本地安装脚本（推荐，未发布 npm 时用这个）

```bash
node scripts/install.mjs                 # 默认装到 desktop profile
node scripts/install.mjs --profile=web    # 装到别的 profile
node scripts/install.mjs --dry-run        # 只看会做什么
```

脚本做四件事，本质上是把插件「当成一个包」挂进 profile：

1. 复制插件到 `~/.dsh/profiles/<profile>/plugins/dsh-auto-prompt`；
2. 在 `<profile>/node_modules/dsh-auto-prompt` 建一个软链指向它（Windows 用 junction，不需要管理员权限）；
3. 在 profile 的 `package.json` 里登记依赖 `dsh-auto-prompt` 与 bundle，让包的 `cordis.patch.yml` 负责插入 Loader 条目；
4. 把旧的 `cordis.patch.yml` 里手写的 `insert` 行删掉（保留你保存过的 `config:` 覆盖），避免同名条目被组合两次。

> **为什么不像以前那样只往 patch 里插一条 `file:///…`？**
> 那样能加载、能用，但 Harness 只对「能解析成包」的条目提供显示元数据与客户端半边：
> `file:///C:/…/src/index.js` 在插件列表里显示成一整条路径（标题、简介、图标都没有，
> 按名字根本搜不到），`dsh.client` 也不会被发现——设置里就不会出现「自动提示词」。
> 现在走裸包名，列表里显示的是「自动提示词 + 一句简介 + 图标」，设置分区也一起出来了。

重复执行只会更新文件，并就地修正已有条目，不会重复插入。

然后**完全退出并重新启动 DSH**。启动日志里应出现：

```
[dsh-auto-prompt] 已加载 — 配置页已接管（新版表单接口）；生成开关关闭（只出提示词）；提示词模型 deepseek-chat @ https://api.deepseek.com/v1 …
```

看到这行就说明插件真的挂上了。括号里是 `新版表单接口`（0.2.x）、`旧版 register 接口`（0.1.x），或者 `设置服务暂未就绪`（首次读取配置时会自动重试，工具本身可用）。

### 方式二：手动挂载

把插件复制进 profile，然后按「包」的方式挂（在 `~/.dsh/profiles/<profile>/` 下操作）：

```bash
cp -r dsh-auto-prompt plugins/dsh-auto-prompt
# node_modules/dsh-auto-prompt → plugins/dsh-auto-prompt（软链或 junction）
```

再改该 profile 的 `package.json`：

```json
{
  "dependencies": { "dsh-auto-prompt": "file:plugins/dsh-auto-prompt" },
  "dsh": { "profile": { "bundles": ["…", "dsh-auto-prompt"] } }
}
```

包的 `cordis.patch.yml` 会把 `id: dsh-auto-prompt / name: dsh-auto-prompt` 插进组合，你不需要再碰 profile 的 `cordis.patch.yml`。

> **不要用插件管理器的「本地目录」去装这份源码。** 它会记成 `link:<路径>`，模块按源码目录
> （profile 之外）解析，`@deepseek-ai/dsh-tools` 这类 peer 依赖就找不到了——pnpm 安装时会
> 明确警告这一点。结果是入口加载失败，插件不出现在列表里，也就没有配置页可以改开关。
> 用本脚本装（脚本建的是相对 profile 的链接，依赖从 `profiles/node_modules` 解析），
> 或者 `npm pack` 出 tgz 再装。装错了也没关系：重跑本脚本会自动收敛回正确形态。

---

## 配置

两种方式等价，改的是同一份配置：

1. **界面**：左下角「个人」→「设置」→ 左侧「自动提示词」。开关、模型地址、API 链接、密钥、模型名、输出目录都在这一页直接改；更细的项（图片尺寸、视频轮询、JSON 模板…）去侧栏「插件」→ `dsh-auto-prompt` →「配置」，每个字段下方都有中文提示。
2. **对话**：直接说「把图片服务配成 xxx」，助手会调用 `auto_config(action="set", values={...})`。

三种入口写的是同一份设置文档。

字段分五组（共 29 项，都有默认值，只需要填你实际用的）：

### 开关
| 字段 | 说明 |
|---|---|
| `enabled` | 插件总开关 |
| `generateMedia` | **生成开关**：关 = 只出提示词；开 = 真的调用后端出图/出片 |
| `mode` | 生成开关打开后，后端缺失时怎么办：`auto` 降级演示 / `live` 直接报错 / `mock` 强制演示 |

### 提示词模型
| 字段 | 说明 |
|---|---|
| `promptBaseUrl` | OpenAI 兼容地址，含版本前缀。`https://api.deepseek.com/v1`、`http://127.0.0.1:11434/v1`、`http://127.0.0.1:1234/v1` |
| `promptApiKey` | 云端必填；本地服务留空（留空则不发送 Authorization 头） |
| `promptModel` | `deepseek-chat` / `qwen2.5:14b` / `llama3.1:8b` … |
| `promptTemperature` | 0.8 平衡；越高越发散 |
| `promptLanguage` | `en`（推荐，绘图模型对英文更敏感）/ `zh` |
| `promptStyleGuide` | 全局风格偏好，会拼进每次生成 |

### 图片服务
| 字段 | 说明 |
|---|---|
| `imageBaseUrl` | OpenAI 兼容 `/images/generations` |
| `imageApiKey` / `imageModel` / `imageSize` | 常规 |
| `imageExtraBody` | 额外请求字段 JSON，如 `{"steps":30,"seed":42}` |

### 视频服务
视频没有统一标准，所以这里用「提交任务 → 轮询状态 → 取结果」的通用模型，四个 JSON 路径把服务商的返回结构描述清楚即可，不改代码适配新服务商。

| 字段 | 说明 |
|---|---|
| `videoSubmitUrl` | 提交地址，留空则用 `{videoBaseUrl}/videos` |
| `videoPollUrl` | 查询模板，`{id}` 占位，留空则用 `{videoBaseUrl}/videos/{id}` |
| `videoRequestBody` | JSON 模板，支持 `{prompt} {model} {duration} {aspect_ratio}` |
| `videoIdPath` | 任务 ID 路径，如 `data.task_id` |
| `videoStatusPath` | 状态路径，如 `data.status` |
| `videoResultPath` | 结果地址路径，如 `data.video_url` |
| `videoDoneStates` / `videoFailStates` | 成功 / 失败状态值（逗号分隔） |
| `videoPollIntervalMs` / `videoTimeoutMs` | 轮询间隔 / 最长等待 |

具体例子（以「提交返回 `{data:{task_id}}`、查询返回 `{data:{status, video_url}}`」这类结构为例）：

```
videoBaseUrl      = https://api.example.com/v1
videoSubmitUrl    = https://api.example.com/v1/video/generations
videoPollUrl      = https://api.example.com/v1/tasks/{id}
videoRequestBody  = {"model":"{model}","prompt":"{prompt}","parameters":{"duration":{duration},"aspect_ratio":"{aspect_ratio}"}}
videoIdPath       = data.task_id
videoStatusPath   = data.status
videoResultPath   = data.video_url
videoDoneStates   = succeeded,completed
```

配好之后先跑一次体检：`auto_config(action="test")`，它会真的 ping 一遍提示词模型、探测图片服务可达性，并告诉你卡在哪。

### 输出
产物默认存到 `~/.dsh/outputs/auto-prompt`，可用 `outputDir` 改（支持 `~`）。图片会同时以附件形式显示在对话里；视频给出绝对路径（点开即可播放）。

---

## 零配置先跑一遍

什么都不填也能用。**默认（生成开关关着）**：

- 提示词用内置模板组装（不需要联网，也不花钱）；
- 产出一份 `.md` 提示词单，包含所有方案、反向提示词、画幅、时长、以及每条为什么这么写；
- 结果里会明确告诉你「开关关着，想说一声就能打开」。

打开生成开关、但后端还没配齐时，进入**演示模式**：图片产出一张真实可解的 PNG 占位图（走完整的落盘 + 附件链路），视频产出一份 `.json` 分镜脚本，并标注「演示模式」。这样第一次上手不用先去折腾密钥。

---

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 只出提示词、不出图 | 生成开关没打开。说「打开生成开关」，或 `auto_config(action="set", values={"generateMedia":true})` |
| `HTTP 404` | 基础地址少了 `/v1` 之类的版本前缀，或模型名写错 |
| `HTTP 401/403` | 密钥无效或无该模型权限；本地服务不要误填密钥 |
| `连不上 127.0.0.1:xxxx` | 本地模型服务没启动，或端口不对（Ollama 11434、LM Studio 1234） |
| 返回「不是 JSON」 | 填的是网页地址而不是 API 地址 |
| 视频「没找到任务 ID / 视频地址」 | 按报错里附的原始返回，改对应的 `videoIdPath` / `videoResultPath` |
| 视频等待超时 | 任务可能仍在服务端跑；调大 `videoTimeoutMs`，或按报错里的任务 ID 去控制台看 |
| 图片返回了但没显示 | 附件策略可能拒绝该格式/尺寸；文件仍已落盘，路径会在结果里列出 |
| 插件没出现在设置里 | 重启 DSH；确认启动日志出现 `[dsh-auto-prompt] 已加载`。仍看不到时用 `DSH_AUTO_PROMPT_DEBUG=1` 启动，日志会列出所有可配置条目 |
| 插件列表里是一条 `file:///C:/…` 路径、按名字搜不到 | 装成了裸路径入口（旧版安装方式）。重跑 `node scripts/install.mjs`，它会改回包名入口并挂上软链 |
| 设置里没有「自动提示词」 | 客户端半边没被组合：确认 `plugins/dsh-auto-prompt/src/client.js` 存在，且 profile `package.json` 的 `dependencies` 里有 `dsh-auto-prompt`、`node_modules/dsh-auto-prompt` 指向插件目录 |
| 开关点不动 / 提示只读 | 设置文档不可写；直接编辑 profile 的 `cordis.patch.yml`，在 `dsh-auto-prompt` 条目下加 `config: { generateMedia: true }` |

---

## 卸载

```bash
node scripts/uninstall.mjs                 # 删插件 + 清理配置入口
node scripts/uninstall.mjs --keep-files    # 只清理配置入口
```

会一并摘掉 `package.json` 里的依赖 / bundle、删掉 `node_modules/dsh-auto-prompt` 链接，并清理 `cordis.patch.yml` 里 Harness 0.2.x 在设置里写下的覆盖条目（否则会留下一个指向已删除文件的条目，profile 起不来），配置清空后补回空列表 `[]`。已生成的图片/视频不会被删除。

---

## 实现要点

- **纯 ESM JavaScript，零构建、零运行时依赖**：只用 `fetch` / `node:fs` / `node:zlib`。客户端半边（`src/client.js`）也是手写的一份 DSH client bundle，不引 React 之外的任何东西。
- **双面孔插件**：
  - 宿主半边 `src/index.js` 注册三个工具，导出 `Config` 供 Loader 生成表单；
  - 浏览器半边 `src/client.js` + `package.json` 的 `dsh.client` 声明，向 `settings.section` 槽注册「自动提示词」导航项。客户端 bundle 必须是 `window.__ModuleLoader__.load({ id, factory })` 形态，`id` 必须等于包名；
  - 页面通过 `ctx.configForms.get(entryId)` 读写同一份配置（`useSyncExternalStore` 订阅快照），所以界面开关和 `auto_config` 改的是同一处。
- **为什么必须是「包」而不是一条 `file://` 条目**：Harness 的 `metaOf()` 只对裸包名（可解析成 package.json）提供标题/简介/图标，客户端模块系统也只对「能定位到 package.json 且有 `dsh.client`」的条目送出浏览器半边。裸路径条目能加载，但在列表里显示成路径、搜不到，也没有设置页。
- **配置跨版本适配**（`src/settings.js`）：
  - 0.1.x：`ctx.settings.register('dsh-auto-prompt', Config, { base, applies: 'live' })`，通过返回的 scope 读写；
  - 0.2.x：`register()` 已移除。Loader 条目的 `Config` 就是表单，字段必须标 `volatile` 才会出现在配置页；这些字段在 `apply(ctx, config)` 里是 `{ get() }` 引用对象，写入走 `ctx.settings.update(entryId, patch, revision)`，`entryId` 由 `loader.locate(ctx.fiber)` 解析（回调可能返回 `include:xxx`，需要按 `describe()` 校正）。
  - 两代都拿不到设置服务时降级为静态配置，工具照常可用。
- **两份 schema**：`Config` 给 Loader（带 `volatile`），`PlainConfig` 用来取值。用带 `volatile` 的那份去校验自己的配置，每个字段都会变成引用对象而不是字符串/布尔值。
- **产物是规范 JSON**：`execute` 返回的每个值都经过 lossless-JSON 校验，`render` 负责转成模型可见内容，`presentResult` 负责转成界面卡片（含图片附件）。
- **错误一律翻译成人话**：HTTP 状态码、连接失败、证书、超时都映射成「原因 + 下一步」，并带上服务端原始信息的一句摘要。

## 自测

```bash
# 在一个能解析 @deepseek-ai/* 的目录里跑（也就是已安装的 profile 内）
cp -r test <profile>/plugins/dsh-auto-prompt/
node <profile>/plugins/dsh-auto-prompt/test/smoke.mjs
```

覆盖：schema 默认值与 volatile 标记、引用对象解包、两代设置接口的读写、生成开关的两种分支、输出 JSON 校验，以及客户端半边（bundle 形态、槽注册、渲染出文字、点开关真的写入 `generateMedia`）。

## 已知限制

- 视频一次只出一条：单个任务动辄几分钟，批量交给下一次调用。
- 没有进度流式推送：长视频任务期间界面停在 pending，完成后一次性返回。
- 只支持「提交 + 轮询」型视频 API；websocket 回调型服务商需要自行加适配。

## 许可证

[MIT](LICENSE) © 2026 Kaitox326
