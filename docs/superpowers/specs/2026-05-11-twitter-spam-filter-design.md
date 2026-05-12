# Twitter Spam Filter — Design Spec

**Date:** 2026-05-11
**Status:** Approved (brainstorming complete, ready for implementation plan)

## Problem

中文 Twitter (x.com) 环境噪音严重：垃圾广告、引流、造谣、营销、色情、隐晦引流（"找情侣加vx"类）、金融骗局充斥 feed 和热门推文评论区。现有屏蔽工具靠固定 keyword 列表，抓不住变体；纯 LLM 实时分类又烧 token 不可持续。

## Solution Thesis

构建**学习型 Chrome 扩展**：用 LLM 作为**bootstrap 工具**而非常驻运行时。系统持续观察用户 feed，周期性 batch 调 LLM 提炼"垃圾模式"，沉淀为本地 keyword/user 规则 + 同步到 Twitter 原生 mute。学习收敛后，本地规则命中率趋近 100%，LLM 调用率趋近 0 — 真正"省 token"。

## Non-Goals (v1)

- ❌ 图片/视频内容识别（纯文本）
- ❌ 每条推文实时 LLM 分类（破坏省 token thesis）
- ❌ 云同步、多设备 sync（导出/导入 JSON 即可）
- ❌ 跨用户共享 keyword 库（隐私 + 误杀风险）
- ❌ Block 用户（只 mute，避免反弹）
- ❌ Firefox/Edge 适配（仅 Chrome / Chromium-based）
- ❌ 嵌入向量语义指纹（明确推迟，仅在 keyword + user 双层抓不住主流变体时再评估）
- ❌ 多 LLM provider 原生 adapter（统一 OpenAI-compatible API + 自定义 baseUrl/key/model）

## Architecture Overview

MV3 Chrome extension，三个 runtime + 一份 storage：

```
┌─────────────────────────────────────────────────────────┐
│  x.com / twitter.com  (Tab)                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ content-script.ts                               │    │
│  │  - MutationObserver 监听 timeline DOM           │    │
│  │  - 抽取 (id, author, text, replyTo, restId)     │    │
│  │  - 命中本地 keyword/user → 立即 hide            │    │
│  │  - 未命中 → 入队送 service worker               │    │
│  │  - 注入"标为垃圾"按钮                           │    │
│  │  - webRequest 拦截 timeline XHR 抽 rest_id      │    │
│  └────────────────┬────────────────────────────────┘    │
└───────────────────┼─────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────────────────┐
│  service-worker.ts  (background)                        │
│   - 累积未分类 tweet 队列                               │
│   - 阈值到达 → BatchAnalyzer → BYOK LLM                 │
│   - 用户 mark spam → 单条小批分析提取 pattern           │
│   - 调 Twitter internal mute API 同步                   │
│   - 通知 popup 候选待审批                               │
└────────┬────────────────────────────────┬───────────────┘
         ▼                                ▼
   chrome.storage.local              popup.html
   - learned (keywords, users)        - 候选审批 UI
   - pending (queue, candidates)      - 设置 (LLM config, 阈值)
   - config / stats                   - "Train Now" 按钮
   - handle→restId cache              - 收敛仪表盘
```

**核心原则**：
- Service worker 是唯一 mutation actor — 单一真相
- Content script 是 dumb pipe，只做 DOM + 数据抽取
- DOM 隐藏永远 work，独立于 Twitter mute API（容灾）

## Pipeline

`intercept → score → decide → act`

1. **Intercept**: MutationObserver 捕获新出现的 tweet 节点 + webRequest 拦截 timeline XHR 抓 `rest_id`
2. **Score**: 本地 `LocalScorer` (Trie/Aho-Corasick + Set lookup) O(1) 评分
3. **Decide**:
   - 命中本地 → spam，立即 act
   - 未命中 → 入 queue；queue 达 N 条触发 batch LLM 分析
   - 用户 mark → 优先入 batch + 反推 keyword 候选
4. **Act**:
   - DOM 隐藏（collapse / dim / nuke 三种样式）
   - 候选进 popup 审批队列
   - 审批通过 → 同步到 chrome.storage + Twitter 原生 mute

## Components

### Content Script (`inject.ts`)
- `TweetExtractor`: 从 DOM 抽 `{tweetId, authorHandle, text, isReply, parentTweetId}`
- `LocalScorer`: 本地黑名单匹配
- `Hider`: 三种隐藏样式
- `MarkButton`: 注入到 tweet action bar
- `RestIdSniffer`: webRequest 拦截，建立 `handle→rest_id` 缓存

### Service Worker (`worker.ts`)
- `Queue`: in-memory 数组 + chrome.storage 双写（service worker 随时被 kill），ring buffer 上限 200
- `BatchAnalyzer`: 触发条件 — `queue.length >= N` (default 50) OR 用户 "Train Now"
- `LLMClient`: OpenAI-compatible API adapter（baseUrl + key + model 用户配置）
- `MutationApplier`: 推审批结果到 chrome.storage + Twitter mute（rate limited 500ms/请求）

### Popup (`popup.html`, Vue 3 或 React，待 plan 阶段定）
- 候选审批 UI（accept / reject / edit）
- 已学清单查看 + 手动删除
- 设置（LLM config，阈值，hide style，类别 toggle）
- 收敛仪表盘（一行文字："过去 7 天分析 1024 条，LLM 调用 32 次 (3.1%)"）
- 导出/导入 JSON
- "未同步到 Twitter" 警告 + 重试 / 手动复制清单

## LLM 调用形态

```
System: 你是中文 Twitter 反垃圾分析器。下面给你 N 条推文。
任务: 识别其中属于以下类别的: 广告/引流/造谣/营销/色情/隐晦引流(找情侣加vx等)/金融骗局。
输出 JSON: {
  "spam_tweets": [{"id": "...", "category": "...", "confidence": 0.0-1.0, "reason": "..."}],
  "candidate_keywords": [{"phrase": "...", "evidence_tweet_ids": [...], "category": "..."}],
  "candidate_users": [{"handle": "...", "evidence_tweet_ids": [...], "reason": "..."}]
}
约束: keyword 必须 ≥3 字且不会误伤正常对话。

User: <tweets as JSON>
```

**Token 预算**：50 条 batch ≈ 5-10K input + 1-2K output。DeepSeek ~$0.001/批，GPT-4o-mini ~$0.005/批。学习收敛后调用频次趋近 0。

**LLM 配置（统一 OpenAI-compatible）**：
```ts
{
  baseUrl: "https://api.deepseek.com/v1",  // 默认示例，用户可填中转站
  apiKey: "sk-...",
  model: "deepseek-chat",
}
```

## Data Model — `chrome.storage.local`

```ts
{
  config: {
    llm: { baseUrl, apiKey, model },
    batchThreshold: 50,
    hideStyle: "collapse" | "dim" | "nuke",
    enabledCategories: ["ad", "promo", "rumor", "marketing", "nsfw", "lure", "scam"],
    syncToTwitterMute: true,
  },
  learned: {
    keywords: [
      { phrase, category, addedAt, hits, syncedToTwitter }
    ],
    users: [
      { handle, restId, reason, addedAt, syncedToTwitter }
    ],
  },
  pending: {
    queue: [ { tweetId, author, text, restId, observedAt } ],   // ring buffer 上限 200
    candidates: [
      { type: "keyword" | "user", value, evidence: [tweetIds], suggestedAt, llmReasoning }
    ],
    userMarked: [ { tweetId, markedAt } ],
  },
  cache: {
    handleToRestId: Record<string, string>,   // 边浏览边建立，免额外请求
  },
  stats: {
    totalAnalyzed, totalLLMCalls, totalLocalHits,
    last7DaysLLMCallRate,
    lastBatchAt,
  }
}
```

**API key 存储**：chrome.storage.local 明文 — Chrome extension 通病，无 secure enclave。popup 须明确告知用户。

**学到的 keyword/user 不自动删**：只增不减；popup 提供手动删除（防误学永久误杀）。

## Twitter Mute 集成

**前提**：Twitter v2 free tier 已废，无公开 mute API。使用 web app 自己用的内部 endpoint（与 web 客户端走同一套，稳定性等价于 web app 本身）。

### 鉴权
- **Bearer token**: 用 `webRequest` 拦截已登录 session 的 XHR 一次抓取（这是公开 web app token，非用户私钥）
- **CSRF token**: 从 cookie `ct0` 读，每个 mute 请求带 `x-csrf-token`

### Endpoints
- Mute keyword: `POST /i/api/1.1/mutes/keywords/create.json`
- Mute keyword 删除: `POST /i/api/1.1/mutes/keywords/destroy.json`
- Mute user: `POST /i/api/1.1/mutes/users/create.json` (需 user_id)
- 查 user_id (fallback): `GET /i/api/graphql/.../UserByScreenName` (免登录)

**user_id 获取主路径**：从 timeline GraphQL response payload 抽 `rest_id`，建立 `handle→restId` 本地缓存。零额外 API 调用。

### Sync 策略
1. 永远先写 `chrome.storage.local`（unconditional truth）
2. 异步尝试 POST 到 Twitter；失败标记 `syncedToTwitter: false`
3. popup 显示未同步条目 + "重试" + "手动复制清单" 按钮
4. Rate limit: 500ms/请求

### 降级方案
- DOM hide 永远 work（独立于 mute API）
- 提供"导出 mute 清单"，用户可手动粘到 Twitter Settings → Privacy → Mute and block

### Default 行为
- **Default mute**（静默、低反弹）
- **不暴露 block** 给普通用户

## Permissions Manifest

```json
{
  "manifest_version": 3,
  "host_permissions": ["https://x.com/*", "https://twitter.com/*"],
  "permissions": ["storage", "webRequest", "scripting"]
}
```

最小权限：无 `<all_urls>`、无 `cookies`（cookie 通过 document.cookie 读 ct0 即可）。

## Error Handling

| 失败场景 | 处理 |
|---|---|
| Bearer/CSRF token 过期 (401) | 重抓 token，重试一次；仍失败 → mark `syncedToTwitter: false`，popup 提示刷新 x.com tab |
| Twitter GraphQL schema 变了 | content script 进 fallback：从 `article` role 节点扫文本 + handle，try/catch 包住每条 tweet，永远不破坏页面 |
| LLM API 失败/超时/rate limit | 整批留 queue，10 分钟后重试；3 次失败通知用户检查 config |
| `chrome.storage` quota 满 | 自动清空 stats 历史 + queue 旧条目，保留 learned + candidates |
| 多 tab 并发写 storage | 所有 mutation 走 service worker（单一 actor） |

## Edge Cases

- **DOM virtualization**: Twitter 回收节点，用 `tweet-id` 去重防重复入队
- **Quote/RT**: 原推 + 引用文本分别评分；任一命中隐藏外层
- **未登录用户访问 x.com**: 插件不 active
- **删除已学 keyword**: 反向调 `/mutes/keywords/destroy.json` 同步删除
- **图片型 spam**: v1 不处理（已列 non-goal）

## Testing

- **Unit (vitest)**: `LocalScorer.match()`, `TweetExtractor.parse()`, prompt 构造 — 纯函数
- **Integration**: mock `chrome.runtime` (`@webext-core/messaging`)，测消息流
- **LLM prompt fixture test**: `fixtures/spam-tweets.json` (~30 条混合) + `expected-output.json`，snapshot diff（不用模型自动 grade）
- **手动 E2E**: `MANUAL_TEST.md` checklist：install → 浏览 5 分钟 → 触发 batch → 审批一个 → 验证 mute 同步

## Tech Stack (待 plan 阶段精化)

- Manifest V3
- TypeScript
- 构建：Vite + `@crxjs/vite-plugin` 或 `wxt`
- Popup UI: React 或 Vue（plan 阶段决定）
- 测试：vitest

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| LLM 部署 | 混合：本地规则粗筛 + BYOK 精排 | 省 token + 隐私可控 + 无后端运营 |
| 学习信号 | 半监督候选审批 + 主动反馈按钮 | 双输入信号，零误杀（用户最后把关） |
| 屏蔽机制 | DOM hide + Twitter 原生 mute 双轨 | 即时体验 + 跨设备生效 + 容灾 |
| 学习触发 | 累计 N 条未分类自动 batch | 安静默认，不打扰 |
| 垃圾定义 | 内置中文 Twitter 垃圾谱系，不可改 | 简化 v1，少 UI 表面积 |
| 持久化原子 | keyword + 用户名（无 embedding） | 80/20 — 先验证 thesis，embedding 留作 v2 |
| LLM provider | 统一 OpenAI-compatible + 自定义 host/key/model | 中文用户大量使用中转站 |
| Mute vs Block | Default mute，不暴露 block | 静默 + 低反弹 |
| user_id 来源 | 从 timeline XHR payload 抽 rest_id 缓存 | 零额外请求，免开发者 API |

## 未决（plan 阶段决定）

- Popup UI 框架（React vs Vue）
- 构建工具具体选型（Vite + crxjs vs wxt）
- LocalScorer 具体实现（Trie 库还是手写 Aho-Corasick）
- LLM 候选 prompt 的 few-shot 示例集（要不要塞 5-10 条 ground truth 提高准度）
