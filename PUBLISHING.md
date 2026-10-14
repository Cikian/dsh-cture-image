# Cture Image 发布与维护文档

`@cikian/dsh-cture-image` — DeepSeek Harness 生图插件。

本文档面向**维护者**：讲清楚包怎么发、装到哪、DSH 的 bundle / client-module 机制有哪些坑，
以及 `tools/` 里每个护栏是为了防住哪种故障。用户视角的说明看 [README.zh.md](README.zh.md)。

---

## 一、源码在哪里

**源码目录（唯一真源），即本仓库根目录：**

```
<repo>\            # 例如 ~/dsh-cture-image/ 或 D:\dev\dsh-cture-image\
```

| 路径 | 作用 | 是否进发布包 |
|---|---|---|
| `package.json` | 包清单：`dsh.bundle.patch` + `dsh.client` 声明 | ✅ |
| `cordis.patch.yml` | bundle 的 patch 层，插入 `tool-imagegen` 行挂载 Host 半 | ✅ |
| `lib/index.js` | Host 入口（极薄 re-export） | ✅ |
| `lib/host.js` | Host 实现：两个工具 + 配置读写 + HTTP 路由 | ✅ |
| `lib/client.js` | Client 半：对话内图片卡片 + 配置表单 | ✅ |
| `locale/en.json`、`locale/zh.json` | 插件页显示名与描述（**标题靠这个文件**，不是 `displayName`） | ✅ |
| `README.md`、`README.zh.md`、`CHANGELOG.md`、`LICENSE` | 面向用户与 GitHub 的文档 | ✅ |
| `docs/example-output.png` | README 里的示例出图 | ❌ 仅仓库 |
| `tools/*.mjs` | 校验 / 安装 / 卸载 / 发布工具 | ❌ 仅本地 |
| `.github/workflows/ci.yml` | CI：跑 `tools/preflight.mjs` | ❌ 仅仓库 |
| `config.json` | **你的私密配置（含 API Key）** | ❌ 绝不发布 |

> `package.json` 的 `files` 白名单 + npm 自身的 README/LICENSE 规则决定了进包内容；
> `config.json`、`tools/`、`docs/` 都不会被打包。`.gitignore` 另外保证 `config.json`
> 与 `dist/` 永远不进 git 历史。

---

## 二、发布的包在哪里

有三个概念要分清：

### 1. 本地打包产物（.tgz）

`npm pack` 默认生成在**当前目录**；本仓库的 `tools/pack-install.mjs` 固定生成到 `dist/`：

```
<repo>/dist/cikian-dsh-cture-image-1.0.0.tgz
```

约 33 kB，含运行时文件（`README.md`、`cordis.patch.yml`、`lib/*.js` ×3、`locale/*.json` ×2、
`package.json`，以及 npm 恒带的 `LICENSE` / `CHANGELOG.md` / `README.zh.md`）。
这个文件既可以直接发给别人离线安装，也作为 GitHub Release 的附件。

装它、并验证"用户拿到的那份"能跑：

```powershell
node tools/pack-install.mjs --profile desktop
```

### 2. GitHub Release

```
https://github.com/Cikian/dsh-cture-image/releases
```

每个版本一个 tag（`v1.0.0`）+ 一份 release，附上同版本的 `.tgz`。

### 3. npm 上的发布包

发布后位于：

```
https://www.npmjs.com/package/@cikian/dsh-cture-image
```

安装时从 npm 拉取。**当前尚未发布**（`private: true` 仍生效，且 registry 上查不到）。

---

## 三、发布前必须确认的三件事

### ⚠️ 1. API Key 绝不能进代码

原先 `lib/host.js` 里的 `BUILTIN.apiKey` 曾写着你的真实密钥 —— 那样发布等于**把你的付费额度送给所有人**。

**已修复**：`BUILTIN.apiKey` 现为空字符串，你的密钥移到本地 `config.json`（不发布）。

`tools/publish-check.mjs` 会扫描 `sk-` 字面量、Bearer token、绝对用户路径，命中就拒绝发布。

### ⚠️ 2. `private: true` 必须去掉

npm 拒绝发布 `private` 包。源码里保留它是**防止误发布**，由 `tools/publish.mjs` 在发布瞬间临时摘除、发布后立即恢复。

### ⚠️ 3. 版本号不能重复

同一版本重复发布，npm 会报错，而 registry 上的内容不会变。检查脚本会先查 registry。

---

## 四、如何发布

```powershell
cd <repo>

# 1) 确认发布就绪（跑全部校验 + 密钥扫描 + tarball 内容核对）
node tools/publish-check.mjs

# 2) 登录 npm（只需一次；scope 包首次发布需 --access public）
npm login

# 3) 发布（脚本会自动处理 private 升降，失败也会恢复）
node tools/publish.mjs --access public

# 预演（不真正发布）
node tools/publish.mjs --access public --dry-run
```

**发布后必须做的两件事：**

1. **立刻去服务商后台吊销并更换那个 API Key** —— 它曾以明文形式存在于本机源码和聊天记录中。
2. 把版本号 +1 再继续开发（`npm version patch`）。

### 版本节奏建议

```powershell
npm version patch    # 1.0.0 -> 1.0.1  修 bug
npm version minor    # 1.0.0 -> 1.1.0  加功能
npm version major    # 1.0.0 -> 2.0.0  破坏性改动
```

---

## 五、如何分发

三种方式，按场景选：

### 方式 A：npm 公开包（推荐）

用户一条命令安装：

```powershell
dsh plugin --profile desktop add @cikian/dsh-cture-image
```

优点：可升级、可查版本、无需传文件。

### 方式 B：分发 .tgz（离线 / 内网 / 不想公开）

```powershell
# 你这边打包
cd <repo>
npm pack            # 得到 cikian-dsh-cture-image-1.0.0.tgz

# 把 tgz 发给对方，对方执行
dsh plugin --profile desktop add .\cikian-dsh-cture-image-1.0.0.tgz
```

### 方式 C：整目录拷贝（最简单，无 npm）

把 `dsh-cture-image` 目录整个复制给对方（**先删掉 `config.json`**），然后：

```powershell
dsh plugin --profile desktop add C:\path\to\dsh-cture-image
```

---

## 六、如何安装（用户视角，请写进你对外发布的说明）

### 前置要求

- DeepSeek Harness（桌面端或 CLI）版本 **0.1.7 或更高**（本插件按 0.2.x 的设置/插件页机制开发）
- 一个 OpenAI 兼容的图片接口地址与 API Key

### 安装

```powershell
# 桌面端（推荐）
dsh plugin --profile desktop add @cikian/dsh-cture-image

# CLI 的 dsh web
dsh plugin --profile web add @cikian/dsh-cture-image
```

装完**重启 DSH**。

### 验证安装

打开 **插件** 页面 → 「已安装」分组 → 应出现 **Cture Image**，右侧开关为开启、状态「运行中」。

若安装过程被 pnpm 的供应链策略中断（表现为：包已链接但清单未写入），改用离线脚本：

```powershell
cd <插件目录>
node tools/install.mjs --profile desktop
node tools/preflight.mjs --profile desktop
```

### 配置

进入插件详情页，填写：

| 项 | 说明 |
|---|---|
| **接口地址** | OpenAI 兼容 API 根地址，默认 `https://api.cikhub.com/v1` |
| **API 密钥** | 你自己的密钥，保存在插件目录的 `config.json`，不会上传 |
| **使用模型** | 可从接口返回的模型列表下拉选择，也可手填 |
| 质量 / 分辨率 / 宽高比 / 保存目录 | 出图默认值 |
| **测试连通性** | 用当前草稿值探测接口，逐条报告 ✓/✕（不用先保存） |
| **测试并试出一张图** | 再真出一张 1024×1024 低质量图，验证模型与额度 |

### 用法

装好后直接对话即可，无需记命令：

```
画一只戴眼镜的猫，插画风格
把 saved-images/xxx.png 的背景换成夜晚
批量出 3 个封面候选
```

模型工具说明：

| 工具 | 用途 |
|---|---|
| `generate_image` | `action:"generate"` 文生图 · `action:"edit"` 参考图修图 · `action:"batch"` 批量出图 |
| `imagegen_config` | `get` 查看配置 · `set` 修改配置 · `models` 列出可用模型 |

参数：`prompt` / `model` / `quality`（low·medium·high·xhigh·max）/ `resolution`（1K·2K·4K）/ `aspect_ratio`（1:1·2:3·4:3·3:4·16:9·9:16·21:9·9:21）/ `count`（1–8）/ `save_dir` / `optimize_prompt`。

### 已知限制（建议原样告知用户）

1. **分辨率上限约 1.6MP**：接口会把大尺寸按比例压缩（`2560×1440` → `1672×941`）。工具会如实报告实际像素。
2. **默认接口不认 `size: "1K"` 也不认 `aspect_ratio`**：插件改用像素尺寸表达比例（`1024x1024`、`1536x1024` 等）。
3. **图片需模型支持图片输入才会直接显示**：不支持时仍会落盘并可下载。

### 本机安装到底装在哪（为什么在 `~/.dsh/plugins` 里找不到）

`dsh plugin add <本地路径>` **不会把源码复制到 `~/.dsh/plugins`**（那个目录是早期手写插件的遗留位置）。
真实布局只有三处，而且安装形态不同，`node_modules` 那一条也不同：

| 位置 | 内容 |
|---|---|
| `<repo>\` | **唯一源码**。所有代码、文档、`config.json` 都在这里 |
| `~/.dsh/profiles/<name>/package.json` | 两处登记：`dependencies`（决定出现在「已安装」分组）+ `dsh.profile.bundles`（决定真正被挂载） |
| `~/.dsh/profiles/<name>/node_modules/@cikian/dsh-cture-image` | 开发安装：**Junction（目录联接）**指向源码，改源码立即生效；发布包安装（`--from-tgz`）：**真目录**，源码改动不再生效 |

验证形态：

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@cikian\dsh-cture-image"
Get-Item $p -Force | Select-Object LinkType, Target
# 开发安装:  LinkType: Junction   Target: <repo>
# 发布包安装: （两者都为空 —— 是真实目录）
```

两种形态的权威副本都在 `node_modules\...\config.json`：**Junction 形态下它就在源码目录里**，
真目录形态下它在 profile 里。所以"改源码里的 config.json 立刻生效"只对 Junction 形态成立。

因此可以放心把插件目录从 `~/.dsh/plugins` 移走，只需**重新登记**：

```powershell
cd <repo>
node tools/uninstall.mjs --profile desktop   # 先摘掉旧条目与旧路径登记
node tools/install.mjs   --profile desktop   # 按新路径重新登记（或 --from-tgz 装发布包）
node tools/preflight.mjs --profile desktop   # 必须 PASSED
```

> 移动后**务必重启 DSH**：客户端半边只在页面启动时组装进 `__DSH_BOOT__`，
> 旧实例不会自动补装（详见下面「配置页面整块消失」）。

`config.json` 是你的密钥与出图默认值，属于用户数据；`tools/` 下的检查脚本只做**快照-还原**，`preflight` 不会删除或改写它。（`files` 白名单保证它永远不进发布包。）

---

## 七、故障处理

### 配置页面整块消失（插件页里只有一个在跑的组件）

这是「客户端半边没被组装」，不是配置坏了。两种成因，症状一模一样：

| 成因 | 判断 | 处理 |
|---|---|---|
| **页面启动早于 bundle 挂载**（本次搬家就是这样） | 宿主行显示「运行中」，但**工具视图和配置区都不在** | 重启 DSH。客户端注册来自启动时那份 `__DSH_BOOT__` 模块图，HMR 只刷新已在图里的 id，改文件没用 |
| **残留的旧 id 行** | 崩溃日志里有 `duplicate factory registration for "<旧包名>"` | 清掉那条旧行（见下），再重启 |

直接读现场证据（Electron 的 renderer console 会落盘）：

```powershell
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs\crash-*-web-boot.log" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```

配合两项只读检查，可以区分"宿主挂了、客户端没挂"：

- 宿主侧：`plugin-manager` 的条目目录里该 id 状态是否为 `absent`（schema 缺失不影响本插件，它自带表单）；
- 客户端侧：插件页 → 插件的组件卡片若显示「运行中」而配置区消失，就是客户端半边没组装。

### 改名后崩溃 / 插件页出现两个同名条目

必须**四处同步**，另外还要清掉 profile 里任何指向旧目录的旧行（`~/.dsh/plugins/<旧目录>` 这类路径）：

```
package.json 的 name
lib/client.js 第 2 行的 id          ← 最容易漏，漏了会让整个应用起不来
cordis.patch.yml 的 name
profile 的 dependencies / bundles
profile 的 cordis.patch.yml（旧 insert 行）  ← 本次实际挖出一条
```

跑一次即可发现：

```powershell
node <repo>\tools\preflight.mjs --profile desktop
node <repo>\tools\preflight.mjs --profile web
```

### 应用起不来

**先在终端执行卸载**，不要依赖崩溃对话框：

```powershell
node <repo>\tools\uninstall.mjs --profile desktop
```

它会清掉 manifest 两处、`node_modules` 链接与空 scope、lockfile 条目，**并保留其他插件**。

> 为什么需要它：bundle 由 profile 清单挂载，若其客户端半加载失败，清单仍会尝试加载，应用就一直起不来 —— 崩溃对话框只重写 `cordis.patch.yml`，管不到清单。

### 配置页面显示 `unavailable: ...`

冒号后的文字就是原因，常见几种：

| 提示 | 含义 |
|---|---|
| `... answered HTTP 404` | Host 的路由没注册（`webServer` 未挂载） |
| `no API key is configured` | 还没填密钥 |
| `HTTP 401` | 密钥无效 |
| `... failed` | 接口不可达或返回错误，原文会跟在后面 |

---

### `dsh plugin add` 报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`

```
✗ Lockfile failed supply-chain policy check (92 entries in 1.5s)
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
  dshmarket@1.66.20 was published at 2026-10-13T06:04:44.000Z, within the minimumReleaseAge cutoff (2026-10-12T16:12:18.768Z)
```

**与你正在装的包无关。** pnpm 会校验**整个 lockfile** 的发布时间，而 profile 里已有的 `dshmarket@1.66.20` 是 24 小时内发布的，于是**任何** `dsh plugin add` 都会失败 —— 包括装本插件。失败时 pnpm 打印了 `+ @cikian/dsh-cture-image`，但**manifest 并没有写入**（可以核对 `profiles/<name>/package.json` 的 `dependencies`：没有它），所以那不是一个"装了一半"的状态。

注意 `pnpm-workspace.yaml` 里其实已经写了排除项，但**锁文件校验这一遍不认 `minimumReleaseAgeExclude`**（pnpm 11.7.0 实测），所以改配置没用。

四个选择：

| 做法 | 说明 |
|---|---|
| **用本仓库的工具装**（推荐，立刻可用） | `node tools/install.mjs --profile desktop [--from-tgz dist/xxx.tgz]` —— 不经过 pnpm |
| 等 | 该策略是按时间滑动的：`1.66.20` 发布满 24 小时后（本次是次日 06:04）自动放行 |
| 降级 dshmarket | 把依赖钉到 `1.66.19`（发布时间早于窗口） |
| 关掉这道闸 | 在 profile 的 `pnpm-workspace.yaml` 里设 `minimumReleaseAge: 0` —— **会削弱整个 profile 的供应链保护**，清楚代价再用 |

先看看它是不是只是"太新"：

```powershell
npm view <包名> time --json
```

---

## 八、工具速查

| 脚本 | 作用 | 何时用 |
|---|---|---|
| `tools/preflight.mjs` | 全部校验 + profile 一致性 | 改动后、装前装后 |
| `tools/verify-bundle.mjs` | 包自洽 + **真执行 client bundle** | 改名后必跑 |
| `tools/smoke-host.mjs` | 桩环境跑 `apply()` | 改 Host 半后 |
| `tools/check-config-roundtrip.mjs` | 配置读写往返（真实文件） | 改配置逻辑后 |
| `tools/check-routes.mjs` | 真实 HTTP 端到端 | 改路由后 |
| `tools/publish-check.mjs` | 发布就绪（含密钥扫描） | 发布前 |
| `tools/publish.mjs` | 发布（自动升降 `private`） | 发布时 |
| `tools/install.mjs` | 装进 profile（默认 junction；`--from-tgz` 装发布包） | pnpm 被策略拦截时 |
| `tools/pack-install.mjs` | 一条命令：打包 → 卸载 → 装发布包 → 校验 | 用发布包形态开发时 |
| `tools/uninstall.mjs` | 一行回滚（junction 只摘链接，绝不跟进去删源码） | 出事后 |
| `tools/tar.mjs` · `tools/install-dir.mjs` | 上面几个脚本的共享实现（解包 / 安全删除） | 一般不用直接调 |

一条命令跑全部：

```powershell
node tools/preflight.mjs --profile desktop
```

两种安装形态的分工（**这是本仓库最重要的一条约定**）：

```powershell
# 开发循环：junction 指向源码，改完重启即生效
node tools/install.mjs --profile desktop

# 验收发布包：真目录安装，用户拿到什么就验什么
node tools/pack-install.mjs --profile desktop
```

---

## 九、架构速览（便于二次开发）

```
用户对话
   │
   ├── generate_image / imagegen_config（Host 工具）
   │        └── lib/host.js：调用 OpenAI 兼容接口
   │              ├── 原图字节 → 工作区 saved-images/
   │              └── 附件 → 对话内 image 内容块（可显示可下载）
   │
   └── 插件页「Cture Image」配置表单（Client）
            └── fetch /api/imagegen/{config,test,models}
                     └── lib/host.js 用 ctx.webServer 注册的同源路由
```

**为什么走 HTTP 路由而不是 RPC**：`host.call` / `harness.handle` 是**动态插件**（`cordis_define`）专属的 builtin，静态 bundle 的 Client 半没有；注册 `remote.*` 命名空间又需要完整 typert 服务定义。同源 `fetch` 是 bundle 能用、且验证成本最低的通道。

**配置存储**：插件自有的 `config.json`（原子写入），优先级 `config.json` > bundle patch 行的 `config` > `BUILTIN` 默认值。不经过 DSH 设置系统，因此不受其命名空间/schema 机制的约束。
