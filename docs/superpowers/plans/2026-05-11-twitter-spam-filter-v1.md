# Twitter Spam Filter v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MV3 Chrome extension that learns Chinese Twitter spam patterns via BYOK LLM and sinks them to Twitter native mute.

**Architecture:** `intercept → score → decide → act` pipeline. Content script (DOM extract + local match + DOM hide), service worker (queue + LLM batch + Twitter mute sync), popup (candidate review + settings).

**Tech Stack:** TypeScript, [WXT](https://wxt.dev) (MV3 build tool), React 18 + Tailwind for popup, Vitest for tests, Zod for schema validation, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-11-twitter-spam-filter-design.md`

---

## File Structure

```
twitter-spam-filter/
├── package.json
├── tsconfig.json
├── wxt.config.ts
├── vitest.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── .gitignore
├── README.md
├── MANUAL_TEST.md
├── entrypoints/
│   ├── background.ts
│   ├── content.ts                  # ISOLATED world: extraction + scoring + bridge
│   ├── sniffer.content.ts          # MAIN world: fetch monkey-patch only
│   └── popup/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       └── style.css
├── src/
│   ├── core/
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   ├── storage.ts
│   │   ├── messaging.ts
│   │   └── constants.ts
│   ├── content/
│   │   ├── extractor.ts
│   │   ├── scorer.ts
│   │   ├── hider.ts
│   │   ├── markButton.ts
│   │   └── restIdSniffer.ts
│   ├── worker/
│   │   ├── queue.ts
│   │   ├── promptBuilder.ts
│   │   ├── llmClient.ts
│   │   ├── batchAnalyzer.ts
│   │   └── muteSync.ts
│   └── popup/
│       └── components/
│           ├── Settings.tsx
│           ├── CandidatesList.tsx
│           ├── LearnedList.tsx
│           ├── Stats.tsx
│           └── ImportExport.tsx
├── tests/
│   ├── setup.ts
│   ├── core/
│   │   ├── storage.test.ts
│   │   └── schemas.test.ts
│   ├── content/
│   │   ├── extractor.test.ts
│   │   └── scorer.test.ts
│   ├── worker/
│   │   ├── queue.test.ts
│   │   ├── promptBuilder.test.ts
│   │   ├── llmClient.test.ts
│   │   └── muteSync.test.ts
│   └── fixtures/
│       ├── tweet.html
│       ├── timeline-graphql.json
│       └── llm-response.json
```

**Boundary rationale:**
- `core/` — pure, framework-free utilities shared across runtimes
- `content/` — only used in content script context (touches DOM)
- `worker/` — only used in service worker (HTTP, storage mutations)
- `popup/components/` — UI only
- `entrypoints/` — WXT convention; thin wiring only, all logic in `src/`

---

## Phase 0: Project Setup

### Task 1: Initialize WXT project + install dependencies

**Files:**
- Create: `/Users/kaiwei/Projects/Github/twitter-spam-filter/package.json`
- Create: `/Users/kaiwei/Projects/Github/twitter-spam-filter/.gitignore`

- [ ] **Step 1: Initialize package.json**

Run from project root `/Users/kaiwei/Projects/Github/twitter-spam-filter/`:
```bash
cat > package.json <<'EOF'
{
  "name": "twitter-spam-filter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "wxt prepare"
  }
}
EOF
```

- [ ] **Step 2: Install dependencies via pnpm**

```bash
pnpm add -D wxt typescript @types/chrome @types/node vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom react react-dom @types/react @types/react-dom tailwindcss postcss autoprefixer @wxt-dev/module-react zod
```

Expected: All packages install without error. `pnpm-lock.yaml` created.

- [ ] **Step 3: Create .gitignore**

```bash
cat > .gitignore <<'EOF'
node_modules
.wxt
.output
dist
.DS_Store
*.log
coverage
.vscode
.idea
EOF
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "Initialize WXT-based Chrome extension project skeleton"
```

---

### Task 2: Configure TypeScript, WXT, Vitest, Tailwind

**Files:**
- Create: `tsconfig.json`
- Create: `wxt.config.ts`
- Create: `vitest.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`

- [ ] **Step 1: Create tsconfig.json**

```bash
cat > tsconfig.json <<'EOF'
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "entrypoints/**/*", "tests/**/*"]
}
EOF
```

- [ ] **Step 2: Create wxt.config.ts**

```bash
cat > wxt.config.ts <<'EOF'
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Twitter Spam Filter",
    description: "Learning-based Chinese Twitter spam filter",
    permissions: ["storage", "webRequest", "scripting"],
    host_permissions: ["https://x.com/*", "https://twitter.com/*"],
    action: { default_popup: "popup/index.html", default_title: "Spam Filter" },
  },
});
EOF
```

- [ ] **Step 3: Create vitest.config.ts**

```bash
cat > vitest.config.ts <<'EOF'
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
EOF
```

- [ ] **Step 4: Create Tailwind configs**

```bash
cat > tailwind.config.ts <<'EOF'
import type { Config } from "tailwindcss";
export default {
  content: ["./entrypoints/popup/**/*.{tsx,html}", "./src/popup/**/*.tsx"],
  theme: { extend: {} },
} satisfies Config;
EOF

cat > postcss.config.js <<'EOF'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
EOF
```

- [ ] **Step 5: Verify WXT compiles**

```bash
pnpm postinstall
pnpm compile
```

Expected: No errors. `.wxt/` dir created.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json wxt.config.ts vitest.config.ts tailwind.config.ts postcss.config.js
git commit -m "Configure TypeScript, WXT, Vitest, Tailwind"
```

---

### Task 3: Create test setup with chrome API mocks

**Files:**
- Create: `tests/setup.ts`

- [ ] **Step 1: Create tests/setup.ts with chrome.storage mock**

```bash
mkdir -p tests
cat > tests/setup.ts <<'EOF'
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const storageMem = new Map<string, unknown>();

const storageArea = {
  get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(storageMem);
    }
    if (typeof keys === "string") {
      return storageMem.has(keys) ? { [keys]: storageMem.get(keys) } : {};
    }
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (storageMem.has(k)) out[k] = storageMem.get(k);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, def] of Object.entries(keys)) out[k] = storageMem.has(k) ? storageMem.get(k) : def;
    return out;
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) storageMem.set(k, v);
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) storageMem.delete(k);
  }),
  clear: vi.fn(async () => storageMem.clear()),
  getBytesInUse: vi.fn(async () => 0),
};

(globalThis as any).chrome = {
  storage: { local: storageArea, sync: storageArea },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    id: "test-extension-id",
    lastError: undefined,
  },
  webRequest: {
    onBeforeSendHeaders: { addListener: vi.fn() },
    onCompleted: { addListener: vi.fn() },
  },
};

export const __resetStorage = () => storageMem.clear();
EOF
```

- [ ] **Step 2: Verify vitest runs**

```bash
pnpm test
```

Expected: "No test files found" (no tests yet) — but vitest itself runs cleanly.

- [ ] **Step 3: Commit**

```bash
git add tests/setup.ts
git commit -m "Add Vitest setup with chrome API mocks"
```

---

## Phase 1: Core Types & Storage

### Task 4: Define core types and Zod schemas

**Files:**
- Create: `src/core/constants.ts`
- Create: `src/core/types.ts`
- Create: `src/core/schemas.ts`
- Test: `tests/core/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p tests/core src/core
cat > tests/core/schemas.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { ConfigSchema, LearnedKeywordSchema, StateSchema, defaultState } from "@/core/schemas";

describe("schemas", () => {
  it("validates default config", () => {
    const result = ConfigSchema.safeParse(defaultState().config);
    expect(result.success).toBe(true);
  });

  it("rejects invalid hideStyle", () => {
    const result = ConfigSchema.safeParse({
      llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "x", model: "deepseek-chat" },
      batchThreshold: 50,
      hideStyle: "explode",
      enabledCategories: ["ad"],
      syncToTwitterMute: true,
    });
    expect(result.success).toBe(false);
  });

  it("validates LearnedKeyword", () => {
    const result = LearnedKeywordSchema.safeParse({
      phrase: "加我vx",
      category: "lure",
      addedAt: 1234567,
      hits: 0,
      syncedToTwitter: false,
    });
    expect(result.success).toBe(true);
  });

  it("default state passes full StateSchema", () => {
    const result = StateSchema.safeParse(defaultState());
    expect(result.success).toBe(true);
  });
});
EOF
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/core/schemas.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create constants.ts**

```bash
cat > src/core/constants.ts <<'EOF'
export const SPAM_CATEGORIES = ["ad", "promo", "rumor", "marketing", "nsfw", "lure", "scam"] as const;
export type SpamCategory = (typeof SPAM_CATEGORIES)[number];

export const HIDE_STYLES = ["collapse", "dim", "nuke"] as const;
export type HideStyle = (typeof HIDE_STYLES)[number];

export const STORAGE_KEY = "tsf_state";
export const QUEUE_MAX = 200;
export const MUTE_RATE_LIMIT_MS = 500;
export const DEFAULT_BATCH_THRESHOLD = 50;
EOF
```

- [ ] **Step 4: Create types.ts**

```bash
cat > src/core/types.ts <<'EOF'
import type { SpamCategory, HideStyle } from "./constants";

export interface LLMConfig { baseUrl: string; apiKey: string; model: string; }

export interface Config {
  llm: LLMConfig;
  batchThreshold: number;
  hideStyle: HideStyle;
  enabledCategories: SpamCategory[];
  syncToTwitterMute: boolean;
}

export interface LearnedKeyword {
  phrase: string;
  category: SpamCategory;
  addedAt: number;
  hits: number;
  syncedToTwitter: boolean;
}

export interface LearnedUser {
  handle: string;
  restId?: string;
  reason: string;
  addedAt: number;
  syncedToTwitter: boolean;
}

export interface QueuedTweet {
  tweetId: string;
  author: string;
  text: string;
  restId?: string;
  observedAt: number;
}

export interface Candidate {
  type: "keyword" | "user";
  value: string;
  category?: SpamCategory;
  evidence: string[];
  suggestedAt: number;
  llmReasoning: string;
}

export interface Stats {
  totalAnalyzed: number;
  totalLLMCalls: number;
  totalLocalHits: number;
  last7DaysLLMCallRate: number;
  lastBatchAt: number;
}

export interface ExtensionState {
  config: Config;
  learned: { keywords: LearnedKeyword[]; users: LearnedUser[] };
  pending: { queue: QueuedTweet[]; candidates: Candidate[]; userMarked: { tweetId: string; markedAt: number }[] };
  cache: { handleToRestId: Record<string, string> };
  stats: Stats;
}

export interface ExtractedTweet {
  tweetId: string;
  authorHandle: string;
  text: string;
  isReply: boolean;
  parentTweetId?: string;
  restId?: string;
}
EOF
```

- [ ] **Step 5: Create schemas.ts**

```bash
cat > src/core/schemas.ts <<'EOF'
import { z } from "zod";
import { SPAM_CATEGORIES, HIDE_STYLES, DEFAULT_BATCH_THRESHOLD } from "./constants";
import type { ExtensionState } from "./types";

export const SpamCategoryEnum = z.enum(SPAM_CATEGORIES);
export const HideStyleEnum = z.enum(HIDE_STYLES);

export const LLMConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string(),
  model: z.string().min(1),
});

export const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  batchThreshold: z.number().int().positive(),
  hideStyle: HideStyleEnum,
  enabledCategories: z.array(SpamCategoryEnum),
  syncToTwitterMute: z.boolean(),
});

export const LearnedKeywordSchema = z.object({
  phrase: z.string().min(1),
  category: SpamCategoryEnum,
  addedAt: z.number(),
  hits: z.number().int().nonnegative(),
  syncedToTwitter: z.boolean(),
});

export const LearnedUserSchema = z.object({
  handle: z.string().min(1),
  restId: z.string().optional(),
  reason: z.string(),
  addedAt: z.number(),
  syncedToTwitter: z.boolean(),
});

export const QueuedTweetSchema = z.object({
  tweetId: z.string(),
  author: z.string(),
  text: z.string(),
  restId: z.string().optional(),
  observedAt: z.number(),
});

export const CandidateSchema = z.object({
  type: z.enum(["keyword", "user"]),
  value: z.string(),
  category: SpamCategoryEnum.optional(),
  evidence: z.array(z.string()),
  suggestedAt: z.number(),
  llmReasoning: z.string(),
});

export const StatsSchema = z.object({
  totalAnalyzed: z.number().int().nonnegative(),
  totalLLMCalls: z.number().int().nonnegative(),
  totalLocalHits: z.number().int().nonnegative(),
  last7DaysLLMCallRate: z.number().min(0).max(1),
  lastBatchAt: z.number(),
});

export const StateSchema = z.object({
  config: ConfigSchema,
  learned: z.object({
    keywords: z.array(LearnedKeywordSchema),
    users: z.array(LearnedUserSchema),
  }),
  pending: z.object({
    queue: z.array(QueuedTweetSchema),
    candidates: z.array(CandidateSchema),
    userMarked: z.array(z.object({ tweetId: z.string(), markedAt: z.number() })),
  }),
  cache: z.object({ handleToRestId: z.record(z.string(), z.string()) }),
  stats: StatsSchema,
});

export const defaultState = (): ExtensionState => ({
  config: {
    llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
    batchThreshold: DEFAULT_BATCH_THRESHOLD,
    hideStyle: "collapse",
    enabledCategories: [...SPAM_CATEGORIES],
    syncToTwitterMute: true,
  },
  learned: { keywords: [], users: [] },
  pending: { queue: [], candidates: [], userMarked: [] },
  cache: { handleToRestId: {} },
  stats: { totalAnalyzed: 0, totalLLMCalls: 0, totalLocalHits: 0, last7DaysLLMCallRate: 0, lastBatchAt: 0 },
});
EOF
```

- [ ] **Step 6: Run test, expect pass**

```bash
pnpm test tests/core/schemas.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/ tests/core/schemas.test.ts
git commit -m "Add core types, Zod schemas, and constants"
```

---

### Task 5: Build storage wrapper

**Files:**
- Create: `src/core/storage.ts`
- Test: `tests/core/storage.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
cat > tests/core/storage.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from "vitest";
import { loadState, saveState, mutateState } from "@/core/storage";
import { defaultState } from "@/core/schemas";
import { __resetStorage } from "../setup";

describe("storage", () => {
  beforeEach(() => __resetStorage());

  it("returns default state when storage empty", async () => {
    const state = await loadState();
    expect(state).toEqual(defaultState());
  });

  it("round-trips state", async () => {
    const s = defaultState();
    s.stats.totalAnalyzed = 42;
    await saveState(s);
    const loaded = await loadState();
    expect(loaded.stats.totalAnalyzed).toBe(42);
  });

  it("mutateState applies and persists", async () => {
    await mutateState((s) => { s.stats.totalLLMCalls += 1; });
    const loaded = await loadState();
    expect(loaded.stats.totalLLMCalls).toBe(1);
  });

  it("loadState repairs corrupt schema by returning defaults", async () => {
    await chrome.storage.local.set({ tsf_state: { garbage: true } });
    const loaded = await loadState();
    expect(loaded).toEqual(defaultState());
  });
});
EOF
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/core/storage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage.ts**

```bash
cat > src/core/storage.ts <<'EOF'
import { StateSchema, defaultState } from "./schemas";
import type { ExtensionState } from "./types";
import { STORAGE_KEY } from "./constants";

export async function loadState(): Promise<ExtensionState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const parsed = StateSchema.safeParse(raw[STORAGE_KEY]);
  if (parsed.success) return parsed.data;
  return defaultState();
}

export async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function mutateState(fn: (s: ExtensionState) => void): Promise<ExtensionState> {
  const state = await loadState();
  fn(state);
  await saveState(state);
  return state;
}

export function subscribeState(cb: (s: ExtensionState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      const parsed = StateSchema.safeParse(changes[STORAGE_KEY]!.newValue);
      if (parsed.success) cb(parsed.data);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
EOF
```

- [ ] **Step 4: Add storage.onChanged to mock**

Edit `tests/setup.ts` — add to the `chrome.storage` mock object:

```ts
// Inside the chrome.storage object literal, add:
onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
```

Use Edit on `tests/setup.ts`:

Find: `(globalThis as any).chrome = {`
Replace block (find the existing chrome.storage block ending and replace `}` with the onChanged addition). Use this Edit:

OLD:
```
  storage: { local: storageArea, sync: storageArea },
```
NEW:
```
  storage: {
    local: storageArea,
    sync: storageArea,
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/core/storage.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/storage.ts tests/core/storage.test.ts tests/setup.ts
git commit -m "Add chrome.storage wrapper with schema validation"
```

---

### Task 6: Build typed messaging bus

**Files:**
- Create: `src/core/messaging.ts`

- [ ] **Step 1: Implement messaging.ts (no separate test — covered by integration usage)**

```bash
cat > src/core/messaging.ts <<'EOF'
import type { QueuedTweet, ExtractedTweet } from "./types";

export type Message =
  | { kind: "tweet/observed"; payload: QueuedTweet }
  | { kind: "tweet/markSpam"; payload: { tweetId: string; tweet: QueuedTweet } }
  | { kind: "batch/trigger"; payload?: undefined }
  | { kind: "candidate/approve"; payload: { idx: number } }
  | { kind: "candidate/reject"; payload: { idx: number } }
  | { kind: "learned/delete"; payload: { type: "keyword" | "user"; value: string } }
  | { kind: "muteSync/retry"; payload?: undefined }
  | { kind: "auth/captured"; payload: { bearer: string; csrf: string } };

export async function send<M extends Message>(msg: M): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

export function onMessage(handler: (msg: Message, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const result = handler(msg as Message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
      return true;
    }
    sendResponse(result);
    return false;
  });
}

export function tweetSignature(t: ExtractedTweet): QueuedTweet {
  return {
    tweetId: t.tweetId,
    author: t.authorHandle,
    text: t.text,
    restId: t.restId,
    observedAt: Date.now(),
  };
}
EOF
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm compile
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/messaging.ts
git commit -m "Add typed message bus for content/worker/popup"
```

---

## Phase 2: Content Script — Extraction & Scoring

### Task 7: Implement LocalScorer (keyword + user matching)

**Files:**
- Create: `src/content/scorer.ts`
- Test: `tests/content/scorer.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p tests/content src/content
cat > tests/content/scorer.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { LocalScorer } from "@/content/scorer";

describe("LocalScorer", () => {
  it("matches keyword substring", () => {
    const s = new LocalScorer({ keywords: ["加我vx"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "alice", text: "你好 加我vx 12345", isReply: false }))
      .toMatchObject({ spam: true, reason: { type: "keyword", match: "加我vx" } });
  });

  it("matches user handle case-insensitively", () => {
    const s = new LocalScorer({ keywords: [], users: ["SpammerBot"] });
    expect(s.score({ tweetId: "1", authorHandle: "spammerbot", text: "hi", isReply: false }))
      .toMatchObject({ spam: true, reason: { type: "user", match: "SpammerBot" } });
  });

  it("returns spam:false when no match", () => {
    const s = new LocalScorer({ keywords: ["加我vx"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "alice", text: "今天天气不错", isReply: false }))
      .toEqual({ spam: false });
  });

  it("update() rebuilds index", () => {
    const s = new LocalScorer({ keywords: [], users: [] });
    s.update({ keywords: ["新词"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "x", text: "包含新词", isReply: false }).spam).toBe(true);
  });

  it("empty keyword/user lists never match", () => {
    const s = new LocalScorer({ keywords: [], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "x", text: "anything", isReply: false }).spam).toBe(false);
  });
});
EOF
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/content/scorer.test.ts
```

Expected: FAIL — `LocalScorer` not found.

- [ ] **Step 3: Implement scorer.ts**

```bash
cat > src/content/scorer.ts <<'EOF'
import type { ExtractedTweet } from "@/core/types";

export interface ScorerInput { keywords: string[]; users: string[]; }

export type ScoreReason =
  | { type: "keyword"; match: string }
  | { type: "user"; match: string };

export type ScoreResult = { spam: true; reason: ScoreReason } | { spam: false };

export class LocalScorer {
  private keywords: string[] = [];
  private userSet = new Set<string>();
  private userOriginal = new Map<string, string>();

  constructor(input: ScorerInput) { this.update(input); }

  update(input: ScorerInput): void {
    this.keywords = [...input.keywords];
    this.userSet.clear();
    this.userOriginal.clear();
    for (const u of input.users) {
      const lower = u.toLowerCase();
      this.userSet.add(lower);
      this.userOriginal.set(lower, u);
    }
  }

  score(t: Pick<ExtractedTweet, "tweetId" | "authorHandle" | "text" | "isReply">): ScoreResult {
    const handleLower = t.authorHandle.toLowerCase();
    if (this.userSet.has(handleLower)) {
      return { spam: true, reason: { type: "user", match: this.userOriginal.get(handleLower)! } };
    }
    for (const kw of this.keywords) {
      if (t.text.includes(kw)) {
        return { spam: true, reason: { type: "keyword", match: kw } };
      }
    }
    return { spam: false };
  }
}
EOF
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test tests/content/scorer.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/scorer.ts tests/content/scorer.test.ts
git commit -m "Add LocalScorer for keyword and user matching"
```

---

### Task 8: Implement TweetExtractor (DOM parsing)

**Files:**
- Create: `src/content/extractor.ts`
- Create: `tests/fixtures/tweet.html`
- Test: `tests/content/extractor.test.ts`

- [ ] **Step 1: Create HTML fixture mimicking X's structure**

```bash
mkdir -p tests/fixtures
cat > tests/fixtures/tweet.html <<'EOF'
<article role="article" data-testid="tweet" aria-labelledby="id__abc">
  <div data-testid="User-Name">
    <a href="/spammer123" role="link">
      <div><span>SpammyMcSpamFace</span></div>
    </a>
    <a href="/spammer123/status/1234567890" role="link">
      <time datetime="2026-05-11T10:00:00.000Z">2h</time>
    </a>
  </div>
  <div data-testid="tweetText" lang="zh">
    <span>找情侣 加我vx</span><span>123456</span>
  </div>
</article>

<article role="article" data-testid="tweet" aria-labelledby="id__def">
  <div>Replying to <a href="/parentuser" role="link"><span>@parentuser</span></a></div>
  <div data-testid="User-Name">
    <a href="/replier" role="link"><div><span>Replier</span></div></a>
    <a href="/replier/status/9876543210" role="link"><time>1h</time></a>
  </div>
  <div data-testid="tweetText" lang="zh"><span>认同！</span></div>
</article>
EOF
```

- [ ] **Step 2: Write the failing test**

```bash
cat > tests/content/extractor.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TweetExtractor } from "@/content/extractor";

describe("TweetExtractor", () => {
  beforeEach(() => {
    document.body.innerHTML = readFileSync(
      path.resolve(__dirname, "../fixtures/tweet.html"),
      "utf-8",
    );
  });

  it("extracts top-level tweet", () => {
    const e = new TweetExtractor();
    const articles = document.querySelectorAll('article[role="article"]');
    const tweet = e.extract(articles[0] as HTMLElement);
    expect(tweet).toMatchObject({
      tweetId: "1234567890",
      authorHandle: "spammer123",
      text: "找情侣 加我vx123456",
      isReply: false,
    });
  });

  it("extracts reply with parent", () => {
    const e = new TweetExtractor();
    const articles = document.querySelectorAll('article[role="article"]');
    const tweet = e.extract(articles[1] as HTMLElement);
    expect(tweet).toMatchObject({
      tweetId: "9876543210",
      authorHandle: "replier",
      isReply: true,
    });
  });

  it("returns null for unparseable element", () => {
    const div = document.createElement("div");
    expect(new TweetExtractor().extract(div)).toBeNull();
  });
});
EOF
```

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm test tests/content/extractor.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement extractor.ts**

```bash
cat > src/content/extractor.ts <<'EOF'
import type { ExtractedTweet } from "@/core/types";

export class TweetExtractor {
  extract(el: HTMLElement): ExtractedTweet | null {
    try {
      const userNameBlock = el.querySelector('[data-testid="User-Name"]');
      if (!userNameBlock) return null;

      const links = userNameBlock.querySelectorAll<HTMLAnchorElement>('a[role="link"]');
      let handle: string | null = null;
      let tweetId: string | null = null;
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        const statusMatch = href.match(/^\/([^/]+)\/status\/(\d+)/);
        if (statusMatch) { handle = statusMatch[1]!; tweetId = statusMatch[2]!; continue; }
        const profMatch = href.match(/^\/([^/]+)$/);
        if (profMatch && !handle) handle = profMatch[1]!;
      }
      if (!handle || !tweetId) return null;

      const textNode = el.querySelector('[data-testid="tweetText"]');
      const text = textNode ? this.collectText(textNode) : "";

      const replyHeader = Array.from(el.querySelectorAll("div"))
        .some((d) => /^Replying to/i.test(d.textContent ?? ""));
      let parentTweetId: string | undefined;
      if (replyHeader) {
        const parentLinks = el.querySelectorAll<HTMLAnchorElement>('a[role="link"][href*="/status/"]');
        for (const a of parentLinks) {
          const m = a.getAttribute("href")?.match(/^\/[^/]+\/status\/(\d+)/);
          if (m && m[1] !== tweetId) { parentTweetId = m[1]; break; }
        }
      }

      const tweet: ExtractedTweet = {
        tweetId,
        authorHandle: handle,
        text,
        isReply: replyHeader,
      };
      if (parentTweetId !== undefined) tweet.parentTweetId = parentTweetId;
      return tweet;
    } catch {
      return null;
    }
  }

  private collectText(node: Element): string {
    return (node.textContent ?? "").replace(/\s+/g, " ").trim();
  }
}
EOF
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test tests/content/extractor.test.ts
```

Expected: All 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content/extractor.ts tests/content/extractor.test.ts tests/fixtures/tweet.html
git commit -m "Add TweetExtractor with DOM fixture tests"
```

---

### Task 9: Implement Hider (three styles)

**Files:**
- Create: `src/content/hider.ts`

- [ ] **Step 1: Implement hider.ts (UI utility — manual verification only)**

```bash
cat > src/content/hider.ts <<'EOF'
import type { HideStyle } from "@/core/constants";
import type { ScoreReason } from "./scorer";

const HIDE_ATTR = "data-tsf-hidden";

export class Hider {
  constructor(private style: HideStyle) {}
  setStyle(s: HideStyle): void { this.style = s; }

  hide(el: HTMLElement, reason: ScoreReason): void {
    if (el.hasAttribute(HIDE_ATTR)) return;
    el.setAttribute(HIDE_ATTR, this.style);
    switch (this.style) {
      case "nuke":   el.style.display = "none"; break;
      case "dim":    el.style.opacity = "0.15"; el.style.filter = "blur(2px)"; break;
      case "collapse": this.collapseEl(el, reason); break;
    }
  }

  private collapseEl(el: HTMLElement, reason: ScoreReason): void {
    const banner = document.createElement("div");
    banner.style.cssText = "padding:8px 16px;color:#888;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;";
    const reasonText = reason.type === "keyword" ? `keyword "${reason.match}"` : `user @${reason.match}`;
    banner.textContent = `🚫 spam (${reasonText}) — click to expand`;
    banner.addEventListener("click", () => {
      banner.remove();
      el.style.display = "";
      el.removeAttribute(HIDE_ATTR);
    });
    el.style.display = "none";
    el.parentElement?.insertBefore(banner, el);
  }
}
EOF
```

- [ ] **Step 2: Typecheck**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add src/content/hider.ts
git commit -m "Add Hider with collapse/dim/nuke styles"
```

---

### Task 10: Implement MarkButton injector

**Files:**
- Create: `src/content/markButton.ts`

- [ ] **Step 1: Implement markButton.ts**

```bash
cat > src/content/markButton.ts <<'EOF'
import type { ExtractedTweet } from "@/core/types";
import { send, tweetSignature } from "@/core/messaging";

const BTN_ATTR = "data-tsf-mark-btn";

export class MarkButton {
  inject(articleEl: HTMLElement, tweet: ExtractedTweet): void {
    if (articleEl.querySelector(`[${BTN_ATTR}]`)) return;
    const actionBar = articleEl.querySelector('[role="group"]');
    if (!actionBar) return;

    const btn = document.createElement("button");
    btn.setAttribute(BTN_ATTR, "1");
    btn.title = "Mark as spam";
    btn.textContent = "🚮";
    btn.style.cssText = "background:none;border:none;cursor:pointer;font-size:18px;padding:4px 8px;color:#888;";
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      btn.disabled = true;
      btn.textContent = "✓";
      await send({ kind: "tweet/markSpam", payload: { tweetId: tweet.tweetId, tweet: tweetSignature(tweet) } });
    });
    actionBar.appendChild(btn);
  }
}
EOF
```

- [ ] **Step 2: Typecheck**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add src/content/markButton.ts
git commit -m "Add MarkButton injector for active spam feedback"
```

---

### Task 11: Implement RestIdSniffer (MAIN-world fetch patcher)

**Critical context:** Reading XHR response bodies requires monkey-patching `window.fetch` in the page's MAIN world. MAIN-world scripts have **no access to `chrome.*` APIs** — they must communicate via `window.postMessage` to an ISOLATED-world bridge (built in Task 12).

**Files:**
- Create: `src/content/restIdSniffer.ts`

- [ ] **Step 1: Implement restIdSniffer.ts using window.postMessage (no chrome API)**

```bash
cat > src/content/restIdSniffer.ts <<'EOF'
export const TSF_BRIDGE_TAG = "__TSF_BRIDGE__";

export type BridgeMessage =
  | { tag: typeof TSF_BRIDGE_TAG; kind: "restId"; handle: string; restId: string }
  | { tag: typeof TSF_BRIDGE_TAG; kind: "auth"; bearer: string; csrf: string };

export class RestIdSniffer {
  install(): void {
    const originalFetch = window.fetch.bind(window);
    const self = this;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isGraphql = url.includes("/i/api/graphql/");
      if (isGraphql) {
        const headers = new Headers(init?.headers);
        const auth = headers.get("authorization");
        const csrf = headers.get("x-csrf-token");
        if (auth && csrf) {
          window.postMessage({ tag: TSF_BRIDGE_TAG, kind: "auth", bearer: auth, csrf } satisfies BridgeMessage, "*");
        }
      }
      const resp = await originalFetch(input as RequestInfo, init);
      if (isGraphql && resp.ok) {
        try {
          const cloned = resp.clone();
          const json = await cloned.json();
          self.walkAndPost(json);
        } catch { /* non-JSON, ignore */ }
      }
      return resp;
    };
  }

  private walkAndPost(node: unknown): void {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) this.walkAndPost(item); return; }
    const obj = node as Record<string, unknown>;
    const restId = obj["rest_id"];
    const legacy = obj["legacy"] as Record<string, unknown> | undefined;
    const screenName = legacy?.["screen_name"];
    if (typeof restId === "string" && typeof screenName === "string") {
      window.postMessage({ tag: TSF_BRIDGE_TAG, kind: "restId", handle: screenName, restId } satisfies BridgeMessage, "*");
    }
    for (const v of Object.values(obj)) this.walkAndPost(v);
  }
}
EOF
```

- [ ] **Step 2: Typecheck**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add src/content/restIdSniffer.ts
git commit -m "Add MAIN-world fetch patcher posting bridge messages via window"
```

---

### Task 12: Wire content script entrypoints (ISOLATED bridge + MAIN sniffer)

**Files:**
- Create: `entrypoints/content.ts` (ISOLATED world — has chrome.* APIs)
- Create: `entrypoints/sniffer.content.ts` (MAIN world — runs in page context)

- [ ] **Step 1: Update messaging.ts to add `restId/update` message kind**

Edit `src/core/messaging.ts`:

OLD:
```
  | { kind: "auth/captured"; payload: { bearer: string; csrf: string } };
```
NEW:
```
  | { kind: "auth/captured"; payload: { bearer: string; csrf: string } }
  | { kind: "restId/update"; payload: { handle: string; restId: string } };
```

- [ ] **Step 2: Create entrypoints/content.ts (ISOLATED world)**

```bash
mkdir -p entrypoints
cat > entrypoints/content.ts <<'EOF'
import { defineContentScript } from "wxt/sandbox";
import { TweetExtractor } from "@/content/extractor";
import { LocalScorer } from "@/content/scorer";
import { Hider } from "@/content/hider";
import { MarkButton } from "@/content/markButton";
import { TSF_BRIDGE_TAG, type BridgeMessage } from "@/content/restIdSniffer";
import { loadState, subscribeState } from "@/core/storage";
import { send, tweetSignature } from "@/core/messaging";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  runAt: "document_start",
  async main() {
    const state = await loadState();
    const scorer = new LocalScorer({
      keywords: state.learned.keywords.map((k) => k.phrase),
      users: state.learned.users.map((u) => u.handle),
    });
    const hider = new Hider(state.config.hideStyle);
    const extractor = new TweetExtractor();
    const markBtn = new MarkButton();

    subscribeState((s) => {
      scorer.update({
        keywords: s.learned.keywords.map((k) => k.phrase),
        users: s.learned.users.map((u) => u.handle),
      });
      hider.setStyle(s.config.hideStyle);
    });

    // Bridge: receive messages from MAIN-world sniffer via window.postMessage
    window.addEventListener("message", (ev) => {
      const data = ev.data as BridgeMessage | undefined;
      if (!data || data.tag !== TSF_BRIDGE_TAG) return;
      if (data.kind === "restId") {
        chrome.runtime.sendMessage({ kind: "restId/update", payload: { handle: data.handle, restId: data.restId } }).catch(() => {});
      } else if (data.kind === "auth") {
        chrome.runtime.sendMessage({ kind: "auth/captured", payload: { bearer: data.bearer, csrf: data.csrf } }).catch(() => {});
      }
    });

    const seen = new Set<string>();
    const processArticle = (article: HTMLElement): void => {
      const tweet = extractor.extract(article);
      if (!tweet) return;
      if (seen.has(tweet.tweetId)) return;
      seen.add(tweet.tweetId);
      const result = scorer.score(tweet);
      if (result.spam) {
        hider.hide(article, result.reason);
        return;
      }
      markBtn.inject(article, tweet);
      send({ kind: "tweet/observed", payload: tweetSignature(tweet) }).catch(() => {});
    };

    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches?.('article[role="article"]')) processArticle(node);
          for (const a of node.querySelectorAll?.('article[role="article"]') ?? []) {
            processArticle(a as HTMLElement);
          }
        }
      }
    });

    const start = () => {
      observer.observe(document.body, { childList: true, subtree: true });
      for (const a of document.querySelectorAll<HTMLElement>('article[role="article"]')) {
        processArticle(a);
      }
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  },
});
EOF
```

- [ ] **Step 3: Create entrypoints/sniffer.content.ts (MAIN world)**

```bash
cat > entrypoints/sniffer.content.ts <<'EOF'
import { defineContentScript } from "wxt/sandbox";
import { RestIdSniffer } from "@/content/restIdSniffer";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    new RestIdSniffer().install();
  },
});
EOF
```

- [ ] **Step 4: Build and verify no errors**

```bash
pnpm build
```

Expected: Build succeeds. `.output/chrome-mv3/manifest.json` declares 2 content scripts (one MAIN, one ISOLATED).

- [ ] **Step 5: Commit**

```bash
git add entrypoints/content.ts entrypoints/sniffer.content.ts src/core/messaging.ts
git commit -m "Wire ISOLATED content bridge and MAIN-world sniffer entrypoints"
```

---

## Phase 3: Service Worker — Analysis Pipeline

### Task 13: Implement Queue with ring-buffer + storage dual-write

**Files:**
- Create: `src/worker/queue.ts`
- Test: `tests/worker/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p tests/worker src/worker
cat > tests/worker/queue.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from "vitest";
import { Queue } from "@/worker/queue";
import { loadState } from "@/core/storage";
import { __resetStorage } from "../setup";

const t = (id: string) => ({ tweetId: id, author: "a", text: "hi", observedAt: 1 });

describe("Queue", () => {
  beforeEach(() => __resetStorage());

  it("starts empty", async () => {
    const q = new Queue();
    await q.hydrate();
    expect(q.size()).toBe(0);
  });

  it("enqueue persists to storage", async () => {
    const q = new Queue();
    await q.hydrate();
    await q.enqueue(t("1"));
    const s = await loadState();
    expect(s.pending.queue).toHaveLength(1);
  });

  it("ring buffer drops oldest beyond cap", async () => {
    const q = new Queue();
    await q.hydrate();
    for (let i = 0; i < 205; i++) await q.enqueue(t(String(i)));
    expect(q.size()).toBe(200);
    expect(q.snapshot()[0]!.tweetId).toBe("5");
  });

  it("drainAll empties queue", async () => {
    const q = new Queue();
    await q.hydrate();
    await q.enqueue(t("1"));
    await q.enqueue(t("2"));
    const drained = await q.drainAll();
    expect(drained).toHaveLength(2);
    expect(q.size()).toBe(0);
    const s = await loadState();
    expect(s.pending.queue).toHaveLength(0);
  });

  it("dedupes by tweetId", async () => {
    const q = new Queue();
    await q.hydrate();
    await q.enqueue(t("1"));
    await q.enqueue(t("1"));
    expect(q.size()).toBe(1);
  });
});
EOF
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test tests/worker/queue.test.ts
```

- [ ] **Step 3: Implement queue.ts**

```bash
cat > src/worker/queue.ts <<'EOF'
import { mutateState, loadState } from "@/core/storage";
import type { QueuedTweet } from "@/core/types";
import { QUEUE_MAX } from "@/core/constants";

export class Queue {
  private items: QueuedTweet[] = [];
  private ids = new Set<string>();

  async hydrate(): Promise<void> {
    const s = await loadState();
    this.items = [...s.pending.queue];
    this.ids = new Set(this.items.map((i) => i.tweetId));
  }

  size(): number { return this.items.length; }
  snapshot(): QueuedTweet[] { return [...this.items]; }

  async enqueue(t: QueuedTweet): Promise<void> {
    if (this.ids.has(t.tweetId)) return;
    this.ids.add(t.tweetId);
    this.items.push(t);
    while (this.items.length > QUEUE_MAX) {
      const removed = this.items.shift();
      if (removed) this.ids.delete(removed.tweetId);
    }
    await mutateState((s) => { s.pending.queue = [...this.items]; });
  }

  async drainAll(): Promise<QueuedTweet[]> {
    const drained = [...this.items];
    this.items = [];
    this.ids.clear();
    await mutateState((s) => { s.pending.queue = []; });
    return drained;
  }
}
EOF
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test tests/worker/queue.test.ts
```

Expected: All 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/queue.ts tests/worker/queue.test.ts
git commit -m "Add Queue with ring buffer and storage persistence"
```

---

### Task 14: Implement promptBuilder

**Files:**
- Create: `src/worker/promptBuilder.ts`
- Test: `tests/worker/promptBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
cat > tests/worker/promptBuilder.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/worker/promptBuilder";

describe("promptBuilder", () => {
  it("includes all category names in system prompt", () => {
    const { system, user } = buildPrompt([], ["ad", "lure", "scam"]);
    expect(system).toContain("广告");
    expect(system).toContain("引流");
    expect(system).toContain("金融骗局");
    expect(user).toBe("[]");
  });

  it("serializes tweets compactly", () => {
    const tweets = [
      { tweetId: "1", author: "a", text: "x", observedAt: 0 },
      { tweetId: "2", author: "b", text: "y", observedAt: 0 },
    ];
    const { user } = buildPrompt(tweets, ["ad"]);
    const parsed = JSON.parse(user);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "1", author: "a", text: "x" });
  });

  it("only mentions enabled categories", () => {
    const { system } = buildPrompt([], ["nsfw"]);
    expect(system).toContain("色情");
    expect(system).not.toContain("造谣");
  });
});
EOF
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/worker/promptBuilder.test.ts
```

- [ ] **Step 3: Implement promptBuilder.ts**

```bash
cat > src/worker/promptBuilder.ts <<'EOF'
import type { QueuedTweet } from "@/core/types";
import type { SpamCategory } from "@/core/constants";

const CATEGORY_LABELS: Record<SpamCategory, string> = {
  ad: "广告",
  promo: "推广",
  rumor: "造谣",
  marketing: "营销",
  nsfw: "色情",
  lure: "隐晦引流（如 找情侣加vx 等）",
  scam: "金融骗局",
};

export function buildPrompt(tweets: QueuedTweet[], categories: SpamCategory[]): { system: string; user: string } {
  const labels = categories.map((c) => CATEGORY_LABELS[c]).join("、");
  const system = [
    "你是中文 Twitter 反垃圾分析器。下面给你一批推文。",
    `任务：识别其中属于以下垃圾类别的: ${labels}。`,
    "输出严格的 JSON，不带任何解释文字或 markdown：",
    `{
  "spam_tweets": [{"id": "...", "category": "ad|promo|rumor|marketing|nsfw|lure|scam", "confidence": 0.0-1.0, "reason": "..."}],
  "candidate_keywords": [{"phrase": "...", "evidence_tweet_ids": [...], "category": "..."}],
  "candidate_users": [{"handle": "...", "evidence_tweet_ids": [...], "reason": "..."}]
}`,
    "约束：",
    "- candidate_keywords 中的 phrase 必须 ≥3 字且不会误伤正常对话",
    "- 只在 confidence ≥ 0.7 时才提名 candidate_keywords/users",
    "- evidence_tweet_ids 必须取自输入的 id 字段",
  ].join("\n");

  const user = JSON.stringify(
    tweets.map((t) => ({ id: t.tweetId, author: t.author, text: t.text })),
  );

  return { system, user };
}
EOF
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/worker/promptBuilder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/worker/promptBuilder.ts tests/worker/promptBuilder.test.ts
git commit -m "Add LLM prompt builder with category-aware system prompt"
```

---

### Task 15: Implement LLMClient (OpenAI-compatible)

**Files:**
- Create: `src/worker/llmClient.ts`
- Test: `tests/worker/llmClient.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
cat > tests/worker/llmClient.test.ts <<'EOF'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMClient } from "@/worker/llmClient";

const cfg = { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-chat" };

describe("LLMClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to /chat/completions and returns parsed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"spam_tweets":[],"candidate_keywords":[],"candidate_users":[]}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = new LLMClient(cfg);
    const result = await c.analyze({ system: "sys", user: "u" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer sk-test" }),
      }),
    );
    expect(result.spam_tweets).toEqual([]);
  });

  it("throws on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }));
    await expect(new LLMClient(cfg).analyze({ system: "s", user: "u" })).rejects.toThrow(/401/);
  });

  it("strips markdown fences from response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n{"spam_tweets":[],"candidate_keywords":[],"candidate_users":[]}\n```' } }] }),
    }));
    const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
    expect(result.candidate_keywords).toEqual([]);
  });

  it("throws if response not parseable JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json at all" } }] }),
    }));
    await expect(new LLMClient(cfg).analyze({ system: "s", user: "u" })).rejects.toThrow();
  });
});
EOF
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/worker/llmClient.test.ts
```

- [ ] **Step 3: Implement llmClient.ts**

```bash
cat > src/worker/llmClient.ts <<'EOF'
import type { LLMConfig } from "@/core/types";
import type { SpamCategory } from "@/core/constants";

export interface LLMSpamTweet { id: string; category: SpamCategory; confidence: number; reason: string; }
export interface LLMCandidateKeyword { phrase: string; evidence_tweet_ids: string[]; category: SpamCategory; }
export interface LLMCandidateUser { handle: string; evidence_tweet_ids: string[]; reason: string; }

export interface LLMAnalysisResult {
  spam_tweets: LLMSpamTweet[];
  candidate_keywords: LLMCandidateKeyword[];
  candidate_users: LLMCandidateUser[];
}

export class LLMClient {
  constructor(private cfg: LLMConfig) {}

  async analyze(prompt: { system: string; user: string }): Promise<LLMAnalysisResult> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`LLM ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as LLMAnalysisResult;
    return {
      spam_tweets: parsed.spam_tweets ?? [],
      candidate_keywords: parsed.candidate_keywords ?? [],
      candidate_users: parsed.candidate_users ?? [],
    };
  }
}
EOF
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/worker/llmClient.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/worker/llmClient.ts tests/worker/llmClient.test.ts
git commit -m "Add OpenAI-compatible LLMClient with markdown-fence cleanup"
```

---

### Task 16: Implement BatchAnalyzer (orchestration)

**Files:**
- Create: `src/worker/batchAnalyzer.ts`

- [ ] **Step 1: Implement batchAnalyzer.ts (logic tested via worker integration in Task 17)**

```bash
cat > src/worker/batchAnalyzer.ts <<'EOF'
import { Queue } from "./queue";
import { LLMClient } from "./llmClient";
import { buildPrompt } from "./promptBuilder";
import { mutateState } from "@/core/storage";
import type { ExtensionState, Candidate, QueuedTweet } from "@/core/types";

export class BatchAnalyzer {
  constructor(private queue: Queue) {}

  shouldTrigger(state: ExtensionState): boolean {
    return this.queue.size() >= state.config.batchThreshold;
  }

  async analyze(state: ExtensionState): Promise<{ candidatesAdded: number; analyzed: number }> {
    const tweets = await this.queue.drainAll();
    if (tweets.length === 0) return { candidatesAdded: 0, analyzed: 0 };

    if (!state.config.llm.apiKey) {
      // Re-enqueue and bail; user must configure
      for (const t of tweets) await this.queue.enqueue(t);
      throw new Error("LLM API key not configured");
    }

    const client = new LLMClient(state.config.llm);
    const prompt = buildPrompt(tweets, state.config.enabledCategories);
    const result = await client.analyze(prompt);

    const newCandidates: Candidate[] = [
      ...result.candidate_keywords.map<Candidate>((k) => ({
        type: "keyword",
        value: k.phrase,
        category: k.category,
        evidence: k.evidence_tweet_ids,
        suggestedAt: Date.now(),
        llmReasoning: `category=${k.category}`,
      })),
      ...result.candidate_users.map<Candidate>((u) => ({
        type: "user",
        value: u.handle,
        evidence: u.evidence_tweet_ids,
        suggestedAt: Date.now(),
        llmReasoning: u.reason,
      })),
    ];

    await mutateState((s) => {
      const existing = new Set(s.pending.candidates.map((c) => `${c.type}:${c.value}`));
      for (const nc of newCandidates) {
        if (!existing.has(`${nc.type}:${nc.value}`)) s.pending.candidates.push(nc);
      }
      s.stats.totalAnalyzed += tweets.length;
      s.stats.totalLLMCalls += 1;
      s.stats.lastBatchAt = Date.now();
    });

    return { candidatesAdded: newCandidates.length, analyzed: tweets.length };
  }

  async analyzeMarkedTweet(tweet: QueuedTweet, state: ExtensionState): Promise<void> {
    if (!state.config.llm.apiKey) throw new Error("LLM API key not configured");
    const client = new LLMClient(state.config.llm);
    const prompt = buildPrompt([tweet], state.config.enabledCategories);
    const result = await client.analyze(prompt);

    await mutateState((s) => {
      const existing = new Set(s.pending.candidates.map((c) => `${c.type}:${c.value}`));
      for (const k of result.candidate_keywords) {
        const key = `keyword:${k.phrase}`;
        if (!existing.has(key)) s.pending.candidates.push({
          type: "keyword", value: k.phrase, category: k.category,
          evidence: k.evidence_tweet_ids, suggestedAt: Date.now(),
          llmReasoning: `from user-marked tweet ${tweet.tweetId}`,
        });
      }
      const userKey = `user:${tweet.author}`;
      if (!existing.has(userKey)) s.pending.candidates.push({
        type: "user", value: tweet.author,
        evidence: [tweet.tweetId], suggestedAt: Date.now(),
        llmReasoning: "user marked their tweet as spam",
      });
      s.pending.userMarked.push({ tweetId: tweet.tweetId, markedAt: Date.now() });
      s.stats.totalLLMCalls += 1;
    });
  }
}
EOF
```

- [ ] **Step 2: Typecheck**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add src/worker/batchAnalyzer.ts
git commit -m "Add BatchAnalyzer to orchestrate LLM call and candidate persistence"
```

---

### Task 17: Implement MuteSync (Twitter internal API)

**Files:**
- Create: `src/worker/muteSync.ts`
- Test: `tests/worker/muteSync.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
cat > tests/worker/muteSync.test.ts <<'EOF'
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MuteSync } from "@/worker/muteSync";

describe("MuteSync", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("muteKeyword posts to keywords/create.json with auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const m = new MuteSync({ bearer: "Bearer AAA", csrf: "csrftok" });
    await m.muteKeyword("加我vx");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.com/i/api/1.1/mutes/keywords/create.json",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ authorization: "Bearer AAA", "x-csrf-token": "csrftok" }),
      }),
    );
  });

  it("muteUser uses restId param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const m = new MuteSync({ bearer: "Bearer AAA", csrf: "csrftok" });
    await m.muteUser("9999");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).body).toContain("user_id=9999");
  });

  it("throws on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" }));
    await expect(new MuteSync({ bearer: "x", csrf: "y" }).muteKeyword("k")).rejects.toThrow(/401/);
  });

  it("destroyKeyword posts to keywords/destroy.json", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await new MuteSync({ bearer: "x", csrf: "y" }).destroyKeyword("kw");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.com/i/api/1.1/mutes/keywords/destroy.json",
      expect.anything(),
    );
  });
});
EOF
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/worker/muteSync.test.ts
```

- [ ] **Step 3: Implement muteSync.ts**

```bash
cat > src/worker/muteSync.ts <<'EOF'
export interface AuthTokens { bearer: string; csrf: string; }

export class MuteSync {
  constructor(private auth: AuthTokens) {}
  setAuth(a: AuthTokens): void { this.auth = a; }

  private async post(url: string, params: Record<string, string>): Promise<void> {
    const body = new URLSearchParams(params).toString();
    const resp = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: this.auth.bearer.startsWith("Bearer ") ? this.auth.bearer : `Bearer ${this.auth.bearer}`,
        "x-csrf-token": this.auth.csrf,
      },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Twitter ${resp.status}: ${text.slice(0, 200)}`);
    }
  }

  muteKeyword(phrase: string): Promise<void> {
    return this.post("https://x.com/i/api/1.1/mutes/keywords/create.json", {
      keyword: phrase,
      mute_surfaces: "notifications,home_timeline,tweet_replies",
      mute_option: "do_not_notify",
      duration: "",
    });
  }

  destroyKeyword(phrase: string): Promise<void> {
    return this.post("https://x.com/i/api/1.1/mutes/keywords/destroy.json", { keyword: phrase });
  }

  muteUser(restId: string): Promise<void> {
    return this.post("https://x.com/i/api/1.1/mutes/users/create.json", { user_id: restId });
  }

  unmuteUser(restId: string): Promise<void> {
    return this.post("https://x.com/i/api/1.1/mutes/users/destroy.json", { user_id: restId });
  }
}
EOF
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm test tests/worker/muteSync.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/worker/muteSync.ts tests/worker/muteSync.test.ts
git commit -m "Add MuteSync wrapping Twitter internal mute endpoints"
```

---

### Task 18: Wire background entrypoint

**Files:**
- Create: `entrypoints/background.ts`

- [ ] **Step 1: Implement background.ts**

```bash
cat > entrypoints/background.ts <<'EOF'
import { defineBackground } from "wxt/sandbox";
import { Queue } from "@/worker/queue";
import { BatchAnalyzer } from "@/worker/batchAnalyzer";
import { MuteSync, type AuthTokens } from "@/worker/muteSync";
import { loadState, mutateState } from "@/core/storage";
import { onMessage, type Message } from "@/core/messaging";
import { MUTE_RATE_LIMIT_MS } from "@/core/constants";
import type { Candidate, ExtensionState } from "@/core/types";

export default defineBackground(() => {
  const queue = new Queue();
  const analyzer = new BatchAnalyzer(queue);
  let auth: AuthTokens | null = null;
  let muteSync: MuteSync | null = null;

  void queue.hydrate();

  const ensureMuteSync = (): MuteSync | null => {
    if (!auth) return null;
    if (!muteSync) muteSync = new MuteSync(auth);
    else muteSync.setAuth(auth);
    return muteSync;
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const applyCandidate = async (candidate: Candidate, state: ExtensionState): Promise<void> => {
    await mutateState(async (s) => {
      if (candidate.type === "keyword") {
        s.learned.keywords.push({
          phrase: candidate.value,
          category: candidate.category ?? "ad",
          addedAt: Date.now(),
          hits: 0,
          syncedToTwitter: false,
        });
      } else {
        s.learned.users.push({
          handle: candidate.value,
          restId: s.cache.handleToRestId[candidate.value],
          reason: candidate.llmReasoning,
          addedAt: Date.now(),
          syncedToTwitter: false,
        });
      }
    });

    if (state.config.syncToTwitterMute) {
      const sync = ensureMuteSync();
      if (sync) {
        try {
          if (candidate.type === "keyword") {
            await sync.muteKeyword(candidate.value);
            await mutateState((s) => {
              const k = s.learned.keywords.find((x) => x.phrase === candidate.value);
              if (k) k.syncedToTwitter = true;
            });
          } else {
            const restId = state.cache.handleToRestId[candidate.value];
            if (restId) {
              await sync.muteUser(restId);
              await mutateState((s) => {
                const u = s.learned.users.find((x) => x.handle === candidate.value);
                if (u) u.syncedToTwitter = true;
              });
            }
          }
        } catch (e) {
          console.warn("[tsf] mute sync failed", e);
        }
      }
    }
  };

  const retrySync = async (): Promise<void> => {
    const sync = ensureMuteSync();
    if (!sync) return;
    const state = await loadState();
    for (const k of state.learned.keywords) {
      if (k.syncedToTwitter) continue;
      try {
        await sync.muteKeyword(k.phrase);
        await mutateState((s) => { const x = s.learned.keywords.find((y) => y.phrase === k.phrase); if (x) x.syncedToTwitter = true; });
        await sleep(MUTE_RATE_LIMIT_MS);
      } catch (e) { console.warn("[tsf] retry kw failed", e); }
    }
    for (const u of state.learned.users) {
      if (u.syncedToTwitter || !u.restId) continue;
      try {
        await sync.muteUser(u.restId);
        await mutateState((s) => { const x = s.learned.users.find((y) => y.handle === u.handle); if (x) x.syncedToTwitter = true; });
        await sleep(MUTE_RATE_LIMIT_MS);
      } catch (e) { console.warn("[tsf] retry user failed", e); }
    }
  };

  const removeLearned = async (type: "keyword" | "user", value: string): Promise<void> => {
    const sync = ensureMuteSync();
    let restId: string | undefined;
    await mutateState((s) => {
      if (type === "keyword") {
        s.learned.keywords = s.learned.keywords.filter((k) => k.phrase !== value);
      } else {
        const u = s.learned.users.find((x) => x.handle === value);
        restId = u?.restId;
        s.learned.users = s.learned.users.filter((x) => x.handle !== value);
      }
    });
    if (sync) {
      try {
        if (type === "keyword") await sync.destroyKeyword(value);
        else if (restId) await sync.unmuteUser(restId);
      } catch (e) { console.warn("[tsf] destroy failed", e); }
    }
  };

  onMessage(async (msg: Message) => {
    switch (msg.kind) {
      case "tweet/observed": {
        await queue.enqueue(msg.payload);
        const state = await loadState();
        if (analyzer.shouldTrigger(state)) {
          analyzer.analyze(state).catch((e) => console.warn("[tsf] auto-batch failed", e));
        }
        return { ok: true };
      }
      case "tweet/markSpam": {
        const state = await loadState();
        await analyzer.analyzeMarkedTweet(msg.payload.tweet, state).catch((e) => {
          console.warn("[tsf] analyze marked failed", e);
        });
        return { ok: true };
      }
      case "batch/trigger": {
        const state = await loadState();
        await analyzer.analyze(state);
        return { ok: true };
      }
      case "candidate/approve": {
        const state = await loadState();
        const candidate = state.pending.candidates[msg.payload.idx];
        if (!candidate) return { ok: false, error: "candidate not found" };
        await applyCandidate(candidate, state);
        await mutateState((s) => { s.pending.candidates.splice(msg.payload.idx, 1); });
        return { ok: true };
      }
      case "candidate/reject": {
        await mutateState((s) => { s.pending.candidates.splice(msg.payload.idx, 1); });
        return { ok: true };
      }
      case "learned/delete": {
        await removeLearned(msg.payload.type, msg.payload.value);
        return { ok: true };
      }
      case "muteSync/retry": {
        await retrySync();
        return { ok: true };
      }
      case "auth/captured": {
        if (msg.payload.bearer && msg.payload.csrf) {
          auth = { bearer: msg.payload.bearer, csrf: msg.payload.csrf };
        }
        return { ok: true };
      }
      case "restId/update": {
        await mutateState((s) => { s.cache.handleToRestId[msg.payload.handle] = msg.payload.restId; });
        return { ok: true };
      }
    }
  });
});
EOF
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/background.ts
git commit -m "Wire background service worker with message handlers and mute sync"
```

---

## Phase 4: Popup UI

### Task 19: Create popup entry + global storage hook

**Files:**
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.tsx`
- Create: `entrypoints/popup/style.css`
- Create: `entrypoints/popup/App.tsx`
- Create: `src/popup/useStore.ts`

- [ ] **Step 1: Create popup HTML shell**

```bash
mkdir -p entrypoints/popup src/popup/components
cat > entrypoints/popup/index.html <<'EOF'
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Twitter Spam Filter</title>
  </head>
  <body class="bg-neutral-900 text-neutral-100" style="width: 420px; min-height: 480px;">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
EOF
```

- [ ] **Step 2: Create style.css with Tailwind directives**

```bash
cat > entrypoints/popup/style.css <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF
```

- [ ] **Step 3: Create useStore hook**

```bash
cat > src/popup/useStore.ts <<'EOF'
import { useEffect, useState } from "react";
import { loadState, subscribeState } from "@/core/storage";
import type { ExtensionState } from "@/core/types";

export function useStore(): ExtensionState | null {
  const [state, setState] = useState<ExtensionState | null>(null);
  useEffect(() => {
    void loadState().then(setState);
    return subscribeState(setState);
  }, []);
  return state;
}
EOF
```

- [ ] **Step 4: Create main.tsx and App.tsx**

```bash
cat > entrypoints/popup/main.tsx <<'EOF'
import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
EOF

cat > entrypoints/popup/App.tsx <<'EOF'
import React, { useState } from "react";
import { useStore } from "@/popup/useStore";
import { Settings } from "@/popup/components/Settings";
import { CandidatesList } from "@/popup/components/CandidatesList";
import { LearnedList } from "@/popup/components/LearnedList";
import { Stats } from "@/popup/components/Stats";
import { ImportExport } from "@/popup/components/ImportExport";

type Tab = "candidates" | "learned" | "settings" | "stats";

export function App(): JSX.Element {
  const state = useStore();
  const [tab, setTab] = useState<Tab>("candidates");
  if (!state) return <div className="p-4">Loading…</div>;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "candidates", label: "候选", badge: state.pending.candidates.length },
    { id: "learned", label: "已学", badge: state.learned.keywords.length + state.learned.users.length },
    { id: "stats", label: "统计" },
    { id: "settings", label: "设置" },
  ];

  return (
    <div className="flex flex-col h-full">
      <nav className="flex border-b border-neutral-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-3 py-2 text-sm ${tab === t.id ? "bg-neutral-800 text-white" : "text-neutral-400"}`}
          >
            {t.label}{t.badge ? ` (${t.badge})` : ""}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto p-3">
        {tab === "candidates" && <CandidatesList state={state} />}
        {tab === "learned" && <LearnedList state={state} />}
        {tab === "stats" && (<><Stats state={state} /><ImportExport /></>)}
        {tab === "settings" && <Settings state={state} />}
      </main>
    </div>
  );
}
EOF
```

- [ ] **Step 5: Commit**

```bash
git add entrypoints/popup/ src/popup/useStore.ts
git commit -m "Add popup shell with tab navigation and store hook"
```

---

### Task 20: Build Settings component

**Files:**
- Create: `src/popup/components/Settings.tsx`

- [ ] **Step 1: Implement Settings.tsx**

```bash
cat > src/popup/components/Settings.tsx <<'EOF'
import React, { useState } from "react";
import type { ExtensionState } from "@/core/types";
import { mutateState } from "@/core/storage";
import { SPAM_CATEGORIES, HIDE_STYLES, type SpamCategory } from "@/core/constants";

export function Settings({ state }: { state: ExtensionState }): JSX.Element {
  const [config, setConfig] = useState(state.config);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await mutateState((s) => { s.config = config; });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="font-semibold mb-2">LLM (OpenAI-compatible)</h3>
        <label className="block">
          <span className="text-neutral-400">Base URL</span>
          <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.baseUrl}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } })} />
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">API Key (stored locally in plaintext)</span>
          <input type="password" className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.apiKey}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } })} />
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">Model</span>
          <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.model}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, model: e.target.value } })} />
        </label>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Behavior</h3>
        <label className="block">
          <span className="text-neutral-400">Batch threshold (tweets)</span>
          <input type="number" min={10} className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.batchThreshold}
            onChange={(e) => setConfig({ ...config, batchThreshold: Number(e.target.value) || 50 })} />
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">Hide style</span>
          <select className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.hideStyle}
            onChange={(e) => setConfig({ ...config, hideStyle: e.target.value as typeof HIDE_STYLES[number] })}>
            {HIDE_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 mt-2">
          <input type="checkbox" checked={config.syncToTwitterMute}
            onChange={(e) => setConfig({ ...config, syncToTwitterMute: e.target.checked })} />
          <span>Sync to Twitter native mute</span>
        </label>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Categories</h3>
        <div className="grid grid-cols-2 gap-1">
          {SPAM_CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-2">
              <input type="checkbox" checked={config.enabledCategories.includes(cat)}
                onChange={(e) => {
                  const set = new Set(config.enabledCategories);
                  if (e.target.checked) set.add(cat); else set.delete(cat);
                  setConfig({ ...config, enabledCategories: [...set] as SpamCategory[] });
                }} />
              <span>{cat}</span>
            </label>
          ))}
        </div>
      </section>

      <button onClick={save} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded">
        {saved ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}
EOF
```

- [ ] **Step 2: Commit**

```bash
git add src/popup/components/Settings.tsx
git commit -m "Add Settings panel for LLM config, behavior, and categories"
```

---

### Task 21: Build CandidatesList component

**Files:**
- Create: `src/popup/components/CandidatesList.tsx`

- [ ] **Step 1: Implement CandidatesList.tsx**

```bash
cat > src/popup/components/CandidatesList.tsx <<'EOF'
import React from "react";
import type { ExtensionState } from "@/core/types";
import { send } from "@/core/messaging";

export function CandidatesList({ state }: { state: ExtensionState }): JSX.Element {
  const list = state.pending.candidates;

  const trigger = async () => {
    try { await send({ kind: "batch/trigger" }); }
    catch (e) { alert(`Batch failed: ${String(e)}`); }
  };

  return (
    <div className="space-y-2 text-sm">
      <button onClick={trigger} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded">
        Train Now (analyze {state.pending.queue.length} queued)
      </button>
      {list.length === 0 && <p className="text-neutral-500 text-center py-8">No candidates pending review.</p>}
      {list.map((c, idx) => (
        <div key={`${c.type}-${c.value}-${idx}`} className="bg-neutral-800 rounded p-2">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs uppercase text-neutral-500">{c.type}</span>
              <div className="font-mono">{c.value}</div>
              {c.category && <div className="text-xs text-amber-400">{c.category}</div>}
              <div className="text-xs text-neutral-400 mt-1">{c.llmReasoning}</div>
              <div className="text-xs text-neutral-600 mt-1">evidence: {c.evidence.length}</div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => send({ kind: "candidate/approve", payload: { idx } })}
                className="bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-1 rounded text-xs">✓</button>
              <button onClick={() => send({ kind: "candidate/reject", payload: { idx } })}
                className="bg-neutral-700 hover:bg-neutral-600 text-white px-2 py-1 rounded text-xs">✗</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
EOF
```

- [ ] **Step 2: Commit**

```bash
git add src/popup/components/CandidatesList.tsx
git commit -m "Add CandidatesList with approve/reject and Train Now"
```

---

### Task 22: Build LearnedList component

**Files:**
- Create: `src/popup/components/LearnedList.tsx`

- [ ] **Step 1: Implement LearnedList.tsx**

```bash
cat > src/popup/components/LearnedList.tsx <<'EOF'
import React from "react";
import type { ExtensionState } from "@/core/types";
import { send } from "@/core/messaging";

export function LearnedList({ state }: { state: ExtensionState }): JSX.Element {
  const unsynced = [
    ...state.learned.keywords.filter((k) => !k.syncedToTwitter).map((k) => `kw: ${k.phrase}`),
    ...state.learned.users.filter((u) => !u.syncedToTwitter).map((u) => `user: @${u.handle}`),
  ];

  return (
    <div className="space-y-3 text-sm">
      {unsynced.length > 0 && (
        <div className="bg-amber-900/40 border border-amber-700 rounded p-2 text-xs">
          ⚠️ {unsynced.length} items not synced to Twitter mute.{" "}
          <button onClick={() => send({ kind: "muteSync/retry" })}
            className="underline text-amber-300">Retry</button>
        </div>
      )}

      <section>
        <h3 className="font-semibold mb-1">Keywords ({state.learned.keywords.length})</h3>
        <ul className="space-y-1">
          {state.learned.keywords.map((k) => (
            <li key={k.phrase} className="flex items-center justify-between bg-neutral-800 rounded px-2 py-1">
              <span className="font-mono text-xs">
                {k.phrase} <span className="text-neutral-500">[{k.category}]</span>
                {!k.syncedToTwitter && <span className="text-amber-400 ml-1">●</span>}
              </span>
              <button onClick={() => send({ kind: "learned/delete", payload: { type: "keyword", value: k.phrase } })}
                className="text-red-400 hover:text-red-300 text-xs">delete</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Users ({state.learned.users.length})</h3>
        <ul className="space-y-1">
          {state.learned.users.map((u) => (
            <li key={u.handle} className="flex items-center justify-between bg-neutral-800 rounded px-2 py-1">
              <span className="font-mono text-xs">
                @{u.handle}
                {!u.syncedToTwitter && <span className="text-amber-400 ml-1">●</span>}
              </span>
              <button onClick={() => send({ kind: "learned/delete", payload: { type: "user", value: u.handle } })}
                className="text-red-400 hover:text-red-300 text-xs">delete</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
EOF
```

- [ ] **Step 2: Commit**

```bash
git add src/popup/components/LearnedList.tsx
git commit -m "Add LearnedList with delete and unsynced warning"
```

---

### Task 23: Build Stats component

**Files:**
- Create: `src/popup/components/Stats.tsx`

- [ ] **Step 1: Implement Stats.tsx**

```bash
cat > src/popup/components/Stats.tsx <<'EOF'
import React from "react";
import type { ExtensionState } from "@/core/types";

export function Stats({ state }: { state: ExtensionState }): JSX.Element {
  const { stats } = state;
  const rawRate = stats.totalAnalyzed > 0 ? stats.totalLLMCalls / stats.totalAnalyzed : 0;
  const callRate = stats.totalAnalyzed > 0 ? (rawRate * 100).toFixed(1) : "—";
  const lastBatch = stats.lastBatchAt ? new Date(stats.lastBatchAt).toLocaleString() : "never";
  const ready = stats.totalAnalyzed > 500 && rawRate < 0.05;

  return (
    <div className="space-y-2 text-sm">
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">Tweets analyzed</div>
        <div className="text-2xl font-mono">{stats.totalAnalyzed}</div>
      </div>
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">LLM calls</div>
        <div className="text-2xl font-mono">{stats.totalLLMCalls} ({callRate}%)</div>
      </div>
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">Local hits</div>
        <div className="text-2xl font-mono">{stats.totalLocalHits}</div>
      </div>
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">Last batch</div>
        <div className="font-mono text-xs">{lastBatch}</div>
      </div>
      {ready && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded p-3 text-xs">
          🎓 Convergence detected — LLM call rate &lt; 5% over 7 days. Safe to disable extension and rely on Twitter native mute.
        </div>
      )}
    </div>
  );
}
EOF
```

- [ ] **Step 2: Commit**

```bash
git add src/popup/components/Stats.tsx
git commit -m "Add Stats panel with convergence indicator"
```

---

### Task 24: Build ImportExport component

**Files:**
- Create: `src/popup/components/ImportExport.tsx`

- [ ] **Step 1: Implement ImportExport.tsx**

```bash
cat > src/popup/components/ImportExport.tsx <<'EOF'
import React, { useRef } from "react";
import { loadState, saveState } from "@/core/storage";
import { StateSchema } from "@/core/schemas";

export function ImportExport(): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = async () => {
    const state = await loadState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twitter-spam-filter-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    const text = await file.text();
    const parsed = StateSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      alert(`Invalid JSON: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
      return;
    }
    if (!confirm("Replace current state with imported data?")) return;
    await saveState(parsed.data);
  };

  return (
    <div className="mt-4 flex gap-2">
      <button onClick={exportJson} className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-1 rounded text-xs">Export JSON</button>
      <button onClick={() => fileRef.current?.click()} className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-1 rounded text-xs">Import JSON</button>
      <input ref={fileRef} type="file" accept="application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); }} />
    </div>
  );
}
EOF
```

- [ ] **Step 2: Build full extension**

```bash
pnpm build
```

Expected: clean build. `.output/chrome-mv3/` contains manifest, content.js, background.js, popup.

- [ ] **Step 3: Commit**

```bash
git add src/popup/components/ImportExport.tsx
git commit -m "Add JSON import/export for state backup and migration"
```

---

## Phase 5: Polish, Docs, Manual Test

### Task 25: Wire stats updates on local hits

**Files:**
- Modify: `entrypoints/content.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Update content.ts to send local hit events**

Edit `entrypoints/content.ts` — modify `processArticle` to notify on local hits.

OLD:
```
      if (result.spam) {
        hider.hide(article, result.reason);
        return;
      }
```
NEW:
```
      if (result.spam) {
        hider.hide(article, result.reason);
        chrome.runtime.sendMessage({ kind: "stats/localHit" }).catch(() => {});
        return;
      }
```

- [ ] **Step 2: Add `stats/localHit` message kind**

Edit `src/core/messaging.ts` — add to Message union:

OLD:
```
  | { kind: "restId/update"; payload: { handle: string; restId: string } };
```
NEW:
```
  | { kind: "restId/update"; payload: { handle: string; restId: string } }
  | { kind: "stats/localHit"; payload?: undefined };
```

- [ ] **Step 3: Handle in background.ts**

Edit `entrypoints/background.ts` — add a case to the message switch:

OLD:
```
      case "restId/update": {
        await mutateState((s) => { s.cache.handleToRestId[msg.payload.handle] = msg.payload.restId; });
        return { ok: true };
      }
```
NEW:
```
      case "restId/update": {
        await mutateState((s) => { s.cache.handleToRestId[msg.payload.handle] = msg.payload.restId; });
        return { ok: true };
      }
      case "stats/localHit": {
        await mutateState((s) => { s.stats.totalLocalHits += 1; });
        return { ok: true };
      }
```

- [ ] **Step 4: Build**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add entrypoints/content.ts entrypoints/background.ts src/core/messaging.ts
git commit -m "Track local hit stats from content script"
```

---

### Task 26: Write README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```bash
cat > README.md <<'EOF'
# Twitter Spam Filter

Learning-based Chrome extension for filtering Chinese spam on x.com / twitter.com.

## How it works

1. **Local match first** — known keywords and usernames are blocked instantly without any LLM call.
2. **Batch LLM analysis** — unknown tweets accumulate; when threshold reached, a single LLM call extracts candidate spam patterns.
3. **You approve candidates** — popup shows proposed keyword/user blocks; click ✓ to accept.
4. **Sync to Twitter native mute** — accepted entries are pushed to Twitter's own mute list, so they work even when the extension is disabled.

The system **converges** — as the local list grows, LLM calls drop toward zero. Truly cheap.

## Setup

1. `pnpm install`
2. `pnpm dev` — loads unpacked into Chrome dev profile
3. Open extension popup → Settings → set OpenAI-compatible LLM (DeepSeek, OneAPI relay, official OpenAI, etc.)

## Build for distribution

```bash
pnpm build
pnpm zip
```

Upload `.output/twitter-spam-filter-*.zip` to Chrome Web Store.

## Privacy

- API key stored in `chrome.storage.local` **as plaintext** (Chrome extension limitation)
- Tweet text is sent to **your configured LLM endpoint only** during batch analysis
- Local match never sends data anywhere

## Tech

TypeScript · WXT · React · Tailwind · Vitest · Zod

See `docs/superpowers/specs/2026-05-11-twitter-spam-filter-design.md` for the full design.
EOF
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with setup, privacy, and tech overview"
```

---

### Task 27: Write MANUAL_TEST.md checklist

**Files:**
- Create: `MANUAL_TEST.md`

- [ ] **Step 1: Write manual test checklist**

```bash
cat > MANUAL_TEST.md <<'EOF'
# Manual Test Checklist (v1)

Run this before tagging any release. Requires a real Twitter/X login.

## Prereqs
- `pnpm build` succeeds
- Load `.output/chrome-mv3/` as unpacked extension in Chrome dev profile
- Test account (don't pollute your real mute list)

## Flow

- [ ] **Install & smoke**: extension icon visible; popup opens; "Loading…" resolves to tabs
- [ ] **Configure LLM**: Settings → enter DeepSeek baseUrl/key/model → Save → "Saved ✓" appears
- [ ] **Open x.com home** with extension active. Confirm no console errors in DevTools (page console + extension service worker console)
- [ ] **Browse for ~5 minutes** scrolling timeline
- [ ] **Verify queue grows**: open popup → Stats → "Tweets analyzed" stays 0, but check chrome.storage via DevTools → Application → Storage that `tsf_state.pending.queue` is populated
- [ ] **Mark a spam tweet**: click 🚮 button on any tweet → button turns to ✓ → after a moment, popup → Candidates shows new entries (keyword and user)
- [ ] **Trigger batch manually**: popup → Candidates → "Train Now" → spinner/no error → candidates list grows
- [ ] **Approve a keyword candidate**: click ✓ on a candidate → moves out of pending → appears in Learned tab
- [ ] **Verify DOM hide**: scroll back to a tweet matching that keyword → it's hidden per the configured style
- [ ] **Verify Twitter native mute**: x.com → Settings → Privacy and safety → Mute and block → Muted words → confirm the keyword is there
- [ ] **Reject a candidate**: click ✗ → disappears from list, does not appear in Learned
- [ ] **Delete a learned keyword**: Learned tab → click delete → also removed from Twitter native mute (verify in Twitter settings)
- [ ] **Test offline LLM failure**: disable wifi, click Train Now → graceful error in alert, queue preserved
- [ ] **Test bad API key**: set apiKey to "bad" → Train Now → 401 error surfaced, queue preserved
- [ ] **Test export**: Stats tab → Export JSON → file downloads with state
- [ ] **Test import**: clear extension storage → Import JSON → state restored

## Known Limitations (v1)

- Image-only spam tweets not detected
- DOM extractor depends on stable `data-testid` selectors; may break if X changes markup
- Mute API is reverse-engineered; if X removes the endpoint, fallback to manual export from Learned tab
EOF
```

- [ ] **Step 2: Commit**

```bash
git add MANUAL_TEST.md
git commit -m "Add manual test checklist for v1 release"
```

---

### Task 28: Final test sweep + build

**Files:** none

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all unit tests pass.

- [ ] **Step 2: Typecheck whole project**

```bash
pnpm compile
```

Expected: no errors.

- [ ] **Step 3: Production build**

```bash
pnpm build
```

Expected: clean output in `.output/chrome-mv3/`.

- [ ] **Step 4: Verify manifest output**

```bash
cat .output/chrome-mv3/manifest.json
```

Expected: contains `permissions: ["storage", "webRequest", "scripting"]`, `host_permissions` for x.com and twitter.com, action popup, content script, background service worker.

- [ ] **Step 5: Run MANUAL_TEST.md checklist** (human in the loop)

Document any deviations as new tasks.

- [ ] **Step 6: Tag**

```bash
git tag -a v0.1.0 -m "v0.1.0 — initial release"
```

---

## Done

All v1 features delivered:
- Local keyword + user matching (DOM hide instant)
- Batch LLM analysis on threshold or "Train Now"
- Manual "mark as spam" feedback
- Candidate approval UI
- Twitter native mute sync (with retry on failure)
- Convergence stats dashboard
- JSON export/import
- Privacy disclosure for plaintext API key

**Non-goals reminder** (do NOT add in v1):
- Image content analysis
- Embedding-based fingerprints
- Cloud sync / cross-user keyword sharing
- Block (only mute)
- Multi-LLM-provider native adapters
