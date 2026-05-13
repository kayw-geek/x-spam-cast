# XSpamCast

[English](./README.md) · [简体中文](./README.zh-CN.md) · [GitHub](https://github.com/kayw-geek/x-spam-cast)

> **一个 X/Twitter 上的垃圾内容过滤器。装上当场就屏蔽常见 spam — 内置一份启动词库即开即用。可以选配自己的 LLM key,扩展会自动从你的 feed 里学新的 spam 模式。屏蔽列表通过 Chrome 账号自动跨浏览器同步。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![MV3](https://img.shields.io/badge/Chrome-MV3-orange)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Local](https://img.shields.io/badge/Filtering-100%25%20local-purple)](#-跨设备备份)
[![Issues](https://img.shields.io/github/issues/kayw-geek/x-spam-cast)](https://github.com/kayw-geek/x-spam-cast/issues)
[![Stars](https://img.shields.io/github/stars/kayw-geek/x-spam-cast?style=social)](https://github.com/kayw-geek/x-spam-cast)

一个 Chrome 扩展,在你的 X 信息流里隐藏垃圾推文 — 把每条推文跟一份本地规则库做匹配。所有匹配都发生在你自己的浏览器里,你刷的 feed、写的内容不会离开你的电脑。规则库装好就有内置启动词,之后通过三种方式增长:订阅别人分享的词库、可选的 LLM 自动从你的 feed 里挖新模式、或你自己点任意推文上的 🚮 按钮手动标记。

> **它会越用越省。** LLM 每次挖出来的 spam 模式都变成永久的本地规则。库吃掉你 feed 里的常见模式之后,陌生推文越来越少,LLM 调用频率也跟着掉到接近 0 — 日成本趋近于 $0。

---

## ✨ 这个扩展为什么不一样

- 🚀 **装上当天就生效。** 内置启动词库即开即用,常见 spam 直接被屏。打开 x.com 就能看到效果。
- 🧠 **它会从你的 feed 里学。** 配置任意 OpenAI 兼容的 LLM key,陌生推文会被自动挖掘新的 spam 模式,库自己就会增长。
- 🔒 **过滤在本地完成。** 推文是在你的浏览器里跟你自己的库做匹配 — 你看了什么不会离开你的电脑。只有 LLM 挖矿的那一批推文文本会发给你配的 endpoint。
- 📦 **订阅别人分享的词库。** 朋友有一份训练得不错的 spam 库?粘他的 gist URL 你就直接继承几百条预筛模式。
- ☁ **跨设备自动备份。** 你的屏蔽列表跟着 Chrome 账号在所有登录的浏览器里同步。
- ↩ **删除有 Undo。** 手抖点错?6 秒内还原。
- 🚮 **一键手动标记。** 每条推文旁有个垃圾桶按钮 — 屏蔽作者 + 把这条推文当作高质量训练样本送给 LLM。
- 🧬 **垂直领域自定义 prompt。** 任何语言写自由规则 — 适合特定语种或场景(中文引流、加密空投等)。
- 🚫 **零遥测。** 扩展只跟三个地方说话:你的 LLM endpoint、x.com(只读)、你的订阅 URL。

---

## 📺 你会看到什么

### Library — 你的屏蔽列表 + stats

<p align="center">
  <img src="docs/screenshots/library.png" alt="Library 标签页 — today/week 概览,展开后看完整 stats、7 日 sparkline、queue 状态、可折叠的 Keywords 和 Users 列表" width="380">
</p>

顶栏一眼能看到 **今日 / 本周** 屏蔽数,点 `▼ stats` 展开看 7 日柱状图。下面是完整的库 — Keywords 和 Users 默认折叠,按时间倒序排。点 **🫥 mosaic** 把内容打码(work-safe)。任意项点 `delete` 删掉,底部会弹 6 秒 **Undo** toast 救命用。

### Sync — 订阅、云同步、文件导入导出

<p align="center">
  <img src="docs/screenshots/sync.png" alt="Sync 标签页 — Subscription URL,Cloud sync 通过 Chrome 账号(Push/Restore 按钮),文件 Import/Export" width="380">
</p>

- **Subscription** — 粘任意公开 spamlist URL(用 gist 的 `Raw` 链接就行),你的库就会继承里面所有内容。每天自动刷新一次。
- **Cloud sync** — 每隔几分钟通过 Chrome 账号同步备份。新设备装好扩展、登录 Chrome 就能恢复。
- **Import / Export** — JSON 文件工作流。**Export share pack** 写一个脱敏文件(无 API key、无配置),可以传 gist 或直接发给朋友。**Export full backup** 写完整 state 含 API key — 千万别公开。**Import file** 自动识别格式:share pack 合并到现有库,full backup 整个替换。

### Settings — LLM、行为、自定义 prompt

<p align="center">
  <img src="docs/screenshots/settings.png" alt="Settings 标签页 — LLM (OpenAI-compatible) 已展开显示 Base URL/API Key/Model 字段和 Test connection 按钮;Behavior 和 Custom prompt 折叠" width="380">
</p>

折叠式布局。默认只展开 **LLM**,其它按需打开:

- **LLM (OpenAI-compatible)** — Base URL + API Key + Model。点 **Test connection** 自动拉出 model 列表。
- **Behavior** — Hide style:`collapse`(留个可点击的 banner 显示原因)或 `nuke`(整条消失)。
- **Custom prompt** — 用任何语言写的领域备注,LLM 会在内置启发式之上参考它。适合垂直领域词汇(例如中文引流短语、加密 scam 信号)。

---

## 🚀 安装

> 还没上 Chrome 商店。

### 方式 A — 预编译 release

1. 去 [Releases](https://github.com/kayw-geek/x-spam-cast/releases) 下载最新 `xspamcast-*.zip`
2. 解压到一个长期保留的目录(Chrome 读的是这个目录,删了扩展就废)
3. `chrome://extensions` → 打开右上角 **开发者模式** → **加载已解压的扩展程序** → 选这个目录
4. 从拼图菜单里把扩展图标 pin 到工具栏

### 方式 B — 从源码构建

```bash
git clone https://github.com/kayw-geek/x-spam-cast
cd x-spam-cast
pnpm install
pnpm build      # → dist/chrome-mv3/
```

然后用方式 A 的步骤 3-4 加载 `dist/chrome-mv3/`。

---

## ⚙️ 首次使用

装完直接打开 x.com — 启动包已经在工作,常见 spam 立刻消失。

要解锁 LLM 自动训练(可选,但强烈推荐):

1. Settings → 展开 **LLM** → 粘 OpenAI 兼容的 endpoint + API key
2. 点 **Test connection** — 自动填好 model 选择器
3. 点 **Save**
4. 正常刷 X。每攒够 50 条陌生推文,LLM 自动批一次。

一次 batch 大约 ~3K 输入 / ~500 输出。**日成本会收敛到 $0.01 左右。**

---

## ☁ 跨设备备份

你的库每隔几分钟自动通过 Chrome 账号同步备份 — 就是同步你书签的那个机制。在另一台机器登录同一个 Chrome 账号、装好扩展,你的库会在第一次启动时自动恢复。

如果你的库超出了 Chrome 同步的容量(大约 3000 条短关键词),用 **Sync → Export full backup** 导出 JSON 文件,在任何地方导回。

---

## 🌐 社区包

把任意公开 spamlist URL 粘到 Sync → Subscription,你的库就会继承它。扩展每天自动重新检查一次 URL。

### 把你训练好的库分享出去

刷几天之后,你的库就值得分享了:

1. **Sync → Export share pack** 下载一个脱敏 JSON
2. 传成公开 [gist](https://gist.github.com)
3. 把 **Raw** URL 发给别人 — 他们粘到 Sync → Subscription 即可订阅

---

## 🌍 本地化 / 垂直领域调优 — 用 Custom prompt

内置 prompt 是通用英文。要教 LLM 你的特定领域 → **Settings → Custom prompt**。任何语言、自由形式。

可以用来:

- **白名单话题** — "我关注股票分析,别把 股票 / 期货 当成 spam"
- **强制屏蔽模式** — "任何 'meme coin 空投' 字样视为 scam"
- **豁免账号** — "永远不要屏蔽 @nytimes,不管它发啥"
- **注入领域词汇** — 语种相关的引流短语、字符替换规避(例如 `chu男` → `处男`)

---

## 🧪 开发

```bash
pnpm dev      # hot-reload 开发构建
pnpm test     # vitest
pnpm compile  # tsc --noEmit
pnpm build    # 生产构建 → dist/chrome-mv3/
```

技术栈:**TypeScript** · **[WXT](https://wxt.dev)** · **React 18** · **Tailwind 3** · **Vitest** · **Zod**.

---

## 🔒 隐私

- 🔑 **LLM API key**:明文存在 `chrome.storage.local`(MV3 没有加密 secret store)。建议用低额度上限的 relay key。
- 🌐 **推文文本**:**只**在 batch 分析时发到你配置的 LLM endpoint。本地匹配路径完全不发送任何数据。
- 📡 **零遥测、零分析、零错误上报。** 出站目标:你的 LLM endpoint、x.com(只读 DOM)、你的订阅 URL。
- ☁ **chrome.storage.sync**:Chrome 负责传输和静态加密,作用域绑定你的 Google 账号。我们看不到。
- 📦 **Share pack 导出**:有意剥掉 API key + config。**Full backup** 导出包含 API key — 永远不要发到公开地方。

---

## ❓ 常见问题

**Q: 它会动我 Twitter 设置里的 mute 列表吗?**
不会。扩展从不登录 Twitter API,也不会修改 x.com 上的任何东西 — 它只读取你正在看的页面,在本地把 spam 推文藏起来。卸载之后 x.com 完全恢复默认状态。

**Q: 卸载之后 spam 会回来吗?**
会。屏蔽完全靠扩展。如果你希望卸载后 spam 仍然被屏,把 Library 手动复制到 Twitter 自己的 muted keywords 里(Sync → Export full backup → 打开 JSON → 把每条 phrase 一个个粘到 x.com 设置 → 隐私 → 静音和屏蔽)。

**Q: 会不会误杀正常账号?**
偶尔。**从 Library 删除 = 自动 whitelist** — 你拒过一次,LLM 永远不会再提议它。删除时的 6 秒 Undo 救命用。

**Q: 我的语种 / 垂类有内置 prompt 抓不到的怪 spam。**
往 Settings → Custom prompt 里加规则。看上面"本地化"章节。

**Q: 是只支持 x.com 还是 twitter.com 也行?** 都支持。

**Q: X 改了时间线 DOM 怎么办?**
扩展可能就抓不到推文了。[提个 issue](https://github.com/kayw-geek/x-spam-cast/issues),会有人修。

**Q: 浏览器数据被清了?**
重新装扩展 — Chrome 账号同步会在首次启动时自动把你的 Library + Whitelist 恢复回来。保险起见,偶尔用 **Sync → Export full backup** 也存一份 JSON 文件。

**Q: 必须用 DeepSeek 吗?**
不,任何 OpenAI 兼容 endpoint 都行。中文 feed 用 DeepSeek 是性价比最高的默认选项。

**Q: Library 能多大?**
本地运行时基本不限。跨设备云备份上限约 91 KB(≈ 3000 个短关键词);超过这个量云同步会告诉你装不下,改用 **Export full backup**(文件)做跨设备转移。

---

## 🗺 不做什么

- **不是翻译器、不是 feed 整理器、不是推荐算法调节器。** 只移除 spam。
- **不是通用 AI agent。** LLM 只做一件事:从一批 tweet 里提取 spam 模式。
- **不做移动端。** 仅浏览器扩展。

---

## 🤝 贡献

欢迎 PR — 看 [Issues](https://github.com/kayw-geek/x-spam-cast/issues)。特别欢迎:

- **精选启动包**(不同语种 feed) — 在 issue 里贴 gist URL
- **针对垂类的 custom prompt 模板**(加密 Twitter、k-pop、金融等)
- **针对 X DOM 变更的稳健性改进**

---

## 📜 License

[MIT](./LICENSE)
