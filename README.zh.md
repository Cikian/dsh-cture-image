<div align="center">

# Cture Image

**在对话里直接生图 —— 为 [DeepSeek Harness](https://github.com/deepseek-ai) 打造的图片插件。**

文生图 · 图生图 / 修图 · 批量出图，走任意 **OpenAI 兼容**的图片接口，
出图直接渲染在对话中，同时把原图落盘到工作区。

[![CI](https://github.com/Cikian/dsh-cture-image/actions/workflows/ci.yml/badge.svg)](https://github.com/Cikian/dsh-cture-image/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Cikian/dsh-cture-image?sort=semver)](https://github.com/Cikian/dsh-cture-image/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [更新日志](CHANGELOG.md) · [版本发布](https://github.com/Cikian/dsh-cture-image/releases)

<img src="docs/example-output.png" alt="示例出图：戴眼镜敲代码的橘猫" width="720">

*提示词：「一只戴圆框眼镜的橘猫坐在书桌前敲代码…扁平化矢量插画风格」——
本插件生成（`gpt-image-2.5-sunburst`，2K，16:9，high），并如实报告了实际像素 1672×941。*

</div>

---

## 特性

- **一个工具覆盖三类任务** —— `generate`（文生图）、`edit`（图生图 / 修图，可带蒙版）、
  `batch`（一次提交多条提示词，并发受控）。
- **出图就在对话里** —— 结果以真正的 image 内容块返回，背后是持久化附件：对话内直接显示、可下载；
  同时把**接口返回的原始字节**写进工作区。
- **参数完整** —— 模型、质量、分辨率档位、宽高比、张数、保存目录、是否追加渲染指引。
- **配置在插件页里** —— 自带设置表单，保存前可先「测试连通性」，逐条报告 `✓ / ✕`；
  API 密钥只存在宿主侧，不回传浏览器。
- **可被 Agent 直接操作** —— `imagegen_config` 工具让模型在对话中读改同一份配置。
- **规范 DSH bundle** —— 出现在插件页「已安装」分组，可像其他 bundle 一样开关，对所有预设与会话生效。

## 环境要求

| | |
|---|---|
| DeepSeek Harness | **0.2.x**（桌面端或 `dsh web`）；按 0.2 的 bundle + client-module 机制开发 |
| Node.js | **≥ 20**（只用于开发脚本；插件本体跑在 DSH 内部） |
| 图片接口 | 任意 **OpenAI 兼容**接口（`POST /images/generations`、`POST /images/edits`）及其密钥 |

## 安装

### 方式一：从 npm 安装

```powershell
# 桌面端（profile: desktop）
dsh plugin --profile desktop add @cikian/dsh-cture-image

# CLI 的 dsh web（profile: web）
dsh plugin --profile web add @cikian/dsh-cture-image
```

### 方式二：从 Releases 下载产物安装（离线可用）

到 [Releases](https://github.com/Cikian/dsh-cture-image/releases) 页面下载
`cikian-dsh-cture-image-1.0.0.tgz`，然后把它交给插件管理器：

```powershell
dsh plugin --profile desktop add .\cikian-dsh-cture-image-1.0.0.tgz
```

两种方式装的是同一个包。tgz 里只有运行时文件——**不含 API 密钥**，装完即可使用。

> **装完（或搬动插件目录后）必须重启 DSH。** 宿主半边会立刻挂上，但 bundle 的
> **客户端半边**（设置表单、图片视图）是在页面启动时组装进 `__DSH_BOOT__` 的。
> 往一个已经打开的页面里安装，就会出现「插件显示运行中、但配置区不见了」——
> 见[常见问题](#常见问题)。

装完自查：**插件 → 已安装** 里应有 *Cture Image* 且开关打开，点进去就是配置表单。

## 配置

打开 **插件 → 已安装 → Cture Image**，表单渲染在描述与组件列表之间。

| 字段 | 说明 |
|---|---|
| **接口地址** | OpenAI 兼容图片接口的根地址。默认 `https://api.cikhub.com/v1`，也可换成任意兼容接口 |
| **API 密钥** | 只存宿主侧，回传时仅显示 `***set***` |
| **使用模型** | 默认模型；下拉列表来自 `GET /models`，也可手填 |
| **质量** | `low` · `medium` · `high` · `xhigh` · `max` |
| **分辨率** | `1K` · `2K` · `4K`（以像素尺寸表达，见[接口差异](#接口差异)） |
| **宽高比** | `1:1` · `2:3` · `4:3` · `3:4` · `16:9` · `9:16` · `21:9` · `9:21` |
| **张数** | 每条提示词张数，1–8 |
| **保存目录** | 原图落盘目录（工作区相对），默认 `saved-images` |
| **测试连通性** | 用**草稿值**探测接口并逐条报告，不保存 |
| **测试并试出一张图** | 真出一张 1024×1024 低质量图，验证模型与额度 |

**配置存在哪。** 在安装目录旁的 `config.json`（原子写入）。优先级：
`config.json` → bundle patch 行的 `config` → `lib/host.js` 里的内置默认值。
它**不进发布包**，所以分发插件永远不会带上别人的密钥：

```
<profile>/node_modules/@cikian/dsh-cture-image/config.json
```

三种改法：设置表单、让 Agent 调 `imagegen_config action:"set" fields:{…}`、直接编辑该文件。
密钥永不回传浏览器——页面只知道「已设置」。

## 用法

直接对话即可，无需记命令：

```
画一只戴眼镜的猫，插画风格
把 saved-images/20261014-085102-readme-1.png 的背景换成夜晚
批量出 3 个封面候选
```

### `generate_image`

| `action` | 作用 |
|---|---|
| `generate`（默认） | 文生图：`POST /images/generations` |
| `edit` | 图生图 / 修图，`image_paths` 传本地图片，`mask_path` 可选蒙版：`POST /images/edits`（multipart） |
| `batch` | 一次调用多条 `prompts`，并发数由 `concurrency` 控制 |

| 参数 | 默认 | 说明 |
|---|---|---|
| `prompt` | — | 中文可直接给；默认自动追加渲染指引（比例 / 像素 / 质量 / 模型强项），`optimize_prompt:false` 可关 |
| `model` | `gpt-image-2.5-sunburst` | `gpt-image-2.5-flare` 适合批量草图与封面候选，`gpt-image-2.5` 通用 |
| `quality` | `high` | `low` · `medium` · `high` · `xhigh` · `max` |
| `resolution` | `1K` | `1K` · `2K` · `4K`，映射到 16 倍数的像素尺寸 |
| `aspect_ratio` | `16:9` | 支持 8 种比例 |
| `count` | `1` | 每条提示词 1–8 张 |
| `save_dir` | `saved-images` | 工作区相对路径 |
| `optimize_prompt` | `true` | 是否追加渲染指引 |

每张图都会：① 以**原始字节**写到 `<工作区>/saved-images/<时间戳>-<提示词>-<序号>.png`；
② 存为持久化附件并以 image 内容块返回（对话内显示、可下载）；
③ 在结果里报告**真实像素**、字节数、附件 id 与工作区路径。

### `imagegen_config`

| `action` | 作用 |
|---|---|
| `get` | 查看当前生效配置 |
| `set` | 校验、持久化并立即生效（`fields: { … }`） |
| `models` | 列出接口端提供的图片模型 |

## 接口差异

插件面向 OpenAI 图片接口，但各家服务与中转的实现细节不同。以下是实测结论与插件的应对：

- **用像素尺寸而不是档位名。** 有的接口忽略 `size: "1K"`，也完全忽略 `aspect_ratio`，
  所以插件始终发具体像素（`1024x1024`、`1536x1024`、`1024x1536` …），用像素表达比例。
- **有的服务把分辨率压到约 1.6MP**（`2560×1440` → `1672×941`）。工具会如实报告**实际**拿到的尺寸，
  被压缩是看得见的，而不是靠猜。
- **极端比例可能被服务端钳制**，`21:9` 实际可能接近 2:1。
- **`edit` 需要接口支持 `/images/edits` 的 multipart 上传**；不支持时 `generate` 仍可用。
- **模型取决于你的接口。** 内置列表只是提示，不是限制——用 `imagegen_config action:"models"` 看真实列表。

## 架构

```
对话
  │
  ├── generate_image / imagegen_config            （宿主半 · lib/host.js）
  │        └── OpenAI 兼容图片接口
  │              ├── 原始字节 ──► <工作区>/saved-images/
  │              └── 附件 ─────► image 内容块（对话内显示 + 可下载）
  │
  └── 插件页：设置表单 + 图片视图                  （客户端半 · lib/client.js）
           └── fetch /api/imagegen/{config,test,models}
                    └── 宿主半用 ctx.webServer 注册的同源路由
```

客户端半**没有** `host.call`（那是**动态插件**专属的 builtin），所以设置页用同源 `fetch`
访问宿主注册的路由。每条路由返回 `{ ok, value }` 或 `{ ok: false, error }`，
失败会渲染成文字而不是一个空白表单。

```
.
├── package.json          # dsh.bundle.patch + dsh.client：它为何是一个 bundle
├── cordis.patch.yml      # bundle patch 层：插入 `tool-imagegen` 行
├── lib/
│   ├── index.js          # 宿主入口（re-export）
│   ├── host.js           # 工具、配置、HTTP 路由
│   └── client.js         # 图片视图 + 设置表单
├── locale/               # 显示名与描述（en、zh）
├── tools/                # 开发与发布脚本
└── .github/workflows/    # CI
```

## 开发

```powershell
git clone https://github.com/Cikian/dsh-cture-image.git
cd dsh-cture-image

# 不需要 profile 的全部校验：包自洽、真执行 client bundle、宿主冒烟、配置路由真实 HTTP
node tools/preflight.mjs

# 再加上与已装 profile 的一致性检查
node tools/preflight.mjs --profile desktop
```

**两种安装形态，用途不同：**

```powershell
# 开发循环：junction 指向源码，改完重启即生效
node tools/install.mjs --profile desktop

# 验收发布包：真目录安装，用户拿到什么就验什么；代价是每次改完都要重新打包
node tools/pack-install.mjs --profile desktop
```

| 脚本 | 作用 |
|---|---|
| `tools/preflight.mjs` | 全部校验 + profile 一致性（安装形态、lockfile、旧名残留） |
| `tools/verify-bundle.mjs` | 包自洽，并**真的执行一遍 client bundle** |
| `tools/smoke-host.mjs` | 用桩 context 跑宿主半 |
| `tools/check-config-roundtrip.mjs` | 配置读写往返（真实文件） |
| `tools/check-routes.mjs` | 设置路由的真实 HTTP 端到端 |
| `tools/install.mjs` / `pack-install.mjs` | 安装（junction，或发布产物） |
| `tools/uninstall.mjs` | 一条命令回滚；junction 只摘链接，绝不跟进去删源码 |
| `tools/publish-check.mjs` / `publish.mjs` | 发布闸门（密钥扫描）与 `npm publish` |

DSH bundle / client-module / lockfile 的机制细节，以及每个护栏是为了防住哪种故障，
都在 [PUBLISHING.md](PUBLISHING.md) 里。

## 常见问题

**插件显示运行中，但设置表单不见了。**
页面在该 bundle 挂载之前就已打开；客户端半边只在页面启动时组装。**重启 DSH** 即可。

**改名之后整个应用起不来。**
`client-modules: duplicate factory registration for "<旧包名>"` 表示仍挂着旧包名的 patch 行。
client bundle 里 `__ModuleLoader__.load({ id })` 必须等于包名，且旧行必须清掉；
`node tools/preflight.mjs --profile <name>` 会直接报错。

**设置页显示 `unavailable: …`。**
冒号后的文字就是原因：`HTTP 404` 是宿主路由没注册（web 载体还没挂上），
`no API key is configured` 是还没填密钥，`HTTP 401` 是密钥无效，其余是接口自己的错误原文。

**`dsh plugin add` 报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。**
pnpm 会校验 profile lockfile 里**每个**包的发布时间，因此一个刚发布的**无关**依赖
会拦住该 profile 的**所有**安装——本插件也不例外。等那个被拦的包超过
`minimumReleaseAge`（默认 24 小时）后再装即可。

**出图报模型错误。**
跑一次设置页的「测试连通性」，它会区分：地址错、密钥错、模型不存在、额度用尽。

## 安全

- 密钥存放在安装目录旁的 `config.json`，**不进发布包**；`tools/publish-check.mjs`
  在发布前扫描随包文件里的密钥字面量、Bearer token 与绝对本地路径。
- 设置表单永远拿不到密钥，宿主只回 `***set***`。
- 发现问题请开 issue，不要贴密钥。密钥一旦泄露就轮换——仓库历史和聊天记录都不会消失。

## 参与贡献

欢迎 issue 与 PR。提 PR 前请先跑 `node tools/preflight.mjs`——CI 在 Windows 与 Linux 上跑同一套检查。

## 许可证

[MIT](LICENSE) © 2026 cikian
