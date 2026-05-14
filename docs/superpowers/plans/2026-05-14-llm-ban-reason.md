# LLM Ban Reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the LLM's per-entry ban reason in the Library, so users can audit why each keyword/user was added.

**Architecture:** Extend the data model with optional `reason` and `source` fields end-to-end (LLM response → Candidate → LearnedKeyword/User), then add an inline accordion to the popup Library that reveals the reason on demand. Old entries lacking the new fields show an honest "no reason recorded" fallback. Zero data migration: every new field is optional.

**Tech Stack:** TypeScript, WXT (MV3 build tool), React 18 + Tailwind for popup, Vitest + jsdom + @testing-library/react for tests, Zod for schemas, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-14-llm-ban-reason-design.md`

---

## File Structure

**Modify:**
- `src/core/types.ts` — add `ReasonSource` union; add `reason?` / `source?` to `LearnedKeyword`; add `source?` to `LearnedUser`.
- `src/core/schemas.ts` — extend `LearnedKeywordSchema` and `LearnedUserSchema` with the new optional fields.
- `src/worker/llmClient.ts` — parse `reason` field on `candidate_keywords[]` (currently dropped).
- `src/worker/promptBuilder.ts` — extend `OUTPUT_FORMAT` and `CANDIDATE_RULES` to request a ≤80-char keyword reason.
- `src/worker/batchAnalyzer.ts` — propagate LLM reason through `Candidate.llmReasoning` for keywords (stop overwriting with `"spam pattern"`); add `source` field on `Candidate`; export pure helper `candidateToLearned`.
- `src/worker/subscription.ts` — `applyPack` writes `source: "pack"` on both keyword & user entries.
- `entrypoints/background.ts` — `applyCandidate` uses the helper; `tweet/markSpam` author block sets `source: "manual"`; first-run starter pack uses `applyPack` (gets "pack" source for free).
- `src/popup/components/LearnedList.tsx` — accordion toggle (`···` button), source-icon prefix (`🤖`/`✋`/`📦`), reason block, evidence link, manual-add path sets `source: "manual"` and `reason: "manually added by you"`.

**Create:**
- `tests/worker/batchAnalyzer.test.ts`
- `tests/worker/subscription.test.ts`
- `tests/popup/LearnedList.test.tsx`

**Modify (tests):**
- `tests/core/schemas.test.ts`
- `tests/worker/llmClient.test.ts`
- `tests/worker/promptBuilder.test.ts`

---

## Conventions

- Test runner: `pnpm test` (vitest in run mode, jsdom env, alias `@` → `src/`).
- Type-check: `pnpm compile`.
- Commit style: short imperative title, no Co-Authored trailer. One commit per task.
- After every task, run `pnpm test` and `pnpm compile` before committing.

---

## Task 1: Schema & types — add `reason?` / `source?` fields

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/schemas.ts`
- Test: `tests/core/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add three tests to `tests/core/schemas.test.ts` *inside the existing `describe("schemas", ...)` block*:

```ts
import { LearnedUserSchema } from "@/core/schemas";

it("LearnedKeyword parses old payload (no reason / source)", () => {
  const r = LearnedKeywordSchema.safeParse({
    phrase: "airdrop scam",
    addedAt: 1234567,
    hits: 3,
  });
  expect(r.success).toBe(true);
});

it("LearnedKeyword round-trips with reason + source", () => {
  const input = {
    phrase: "airdrop scam",
    addedAt: 1234567,
    hits: 3,
    reason: "typical crypto giveaway scam pattern",
    source: "llm-batch" as const,
  };
  const r = LearnedKeywordSchema.safeParse(input);
  expect(r.success).toBe(true);
  expect(r.data).toEqual(input);
});

it("LearnedUser parses old payload (no source)", () => {
  const r = LearnedUserSchema.safeParse({
    handle: "spammer123",
    reason: "manually added",
    addedAt: 1234567,
  });
  expect(r.success).toBe(true);
});

it("LearnedUser round-trips with source", () => {
  const r = LearnedUserSchema.safeParse({
    handle: "spammer123",
    reason: "follow-train shill",
    addedAt: 1234567,
    source: "llm-marked" as const,
  });
  expect(r.success).toBe(true);
});

it("rejects unknown source enum value", () => {
  const r = LearnedKeywordSchema.safeParse({
    phrase: "x", addedAt: 1, hits: 0, source: "voodoo",
  });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test tests/core/schemas.test.ts`
Expected: 5 new tests fail (schema doesn't know `reason` / `source` fields → either rejects or strips them; the round-trip assertions fail).

- [ ] **Step 3: Update `src/core/types.ts`**

Replace the existing `LearnedKeyword` and `LearnedUser` interfaces and add the union:

```ts
export type ReasonSource = "llm-batch" | "llm-marked" | "manual" | "pack";

export interface LearnedKeyword {
  phrase: string;
  addedAt: number;
  hits: number;
  reason?: string;
  source?: ReasonSource;
}

export interface LearnedUser {
  handle: string;
  displayName?: string;
  reason: string;
  addedAt: number;
  source?: ReasonSource;
}
```

- [ ] **Step 4: Update `src/core/schemas.ts`**

Add the source enum near the top (after `HideStyleEnum`):

```ts
export const ReasonSourceEnum = z.enum(["llm-batch", "llm-marked", "manual", "pack"]);
```

Replace `LearnedKeywordSchema` and `LearnedUserSchema`:

```ts
export const LearnedKeywordSchema = z.object({
  phrase: z.string().min(1),
  addedAt: z.number(),
  hits: z.number().int().nonnegative(),
  reason: z.string().optional(),
  source: ReasonSourceEnum.optional(),
});

export const LearnedUserSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().optional(),
  reason: z.string(),
  addedAt: z.number(),
  source: ReasonSourceEnum.optional(),
});
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `pnpm test tests/core/schemas.test.ts`
Expected: all schema tests pass (5 new + existing).

Run: `pnpm compile`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/schemas.ts tests/core/schemas.test.ts
git commit -m "add optional reason and source fields to LearnedKeyword/User"
```

---

## Task 2: LLMClient — parse keyword reason from response

**Files:**
- Modify: `src/worker/llmClient.ts:11-14`
- Test: `tests/worker/llmClient.test.ts`

The LLM is going to be asked for a per-keyword reason in Task 3. The client currently drops it because `LLMCandidateKeywordSchema` doesn't have a `reason` field.

- [ ] **Step 1: Write the failing test**

Add to `tests/worker/llmClient.test.ts` inside the `describe("LLMClient", ...)` block:

```ts
it("parses reason field on candidate_keywords", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        spam_tweets: [],
        candidate_keywords: [
          { phrase: "airdrop scam", evidence_tweet_ids: ["1", "2"], reason: "crypto giveaway lure" },
        ],
        candidate_users: [],
      }) } }],
    }),
  }));
  const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
  expect(result.candidate_keywords).toEqual([
    { phrase: "airdrop scam", evidence_tweet_ids: ["1", "2"], reason: "crypto giveaway lure" },
  ]);
});

it("accepts candidate_keywords without reason field (back-compat)", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        spam_tweets: [],
        candidate_keywords: [{ phrase: "airdrop scam", evidence_tweet_ids: ["1"] }],
        candidate_users: [],
      }) } }],
    }),
  }));
  const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
  expect(result.candidate_keywords).toHaveLength(1);
  expect(result.candidate_keywords[0]).toEqual({ phrase: "airdrop scam", evidence_tweet_ids: ["1"] });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test tests/worker/llmClient.test.ts`
Expected: first test fails because reason gets stripped (current schema has no `reason`); second test passes coincidentally — keep it as a regression guard.

- [ ] **Step 3: Update `src/worker/llmClient.ts:11-14`**

Replace:

```ts
const LLMCandidateKeywordSchema = z.object({
  phrase: z.string().min(1),
  evidence_tweet_ids: z.array(z.string()),
});
```

With:

```ts
const LLMCandidateKeywordSchema = z.object({
  phrase: z.string().min(1),
  evidence_tweet_ids: z.array(z.string()),
  // Optional in the schema so an LLM that ignores the prompt instruction
  // doesn't cause us to drop an otherwise-valid keyword candidate.
  reason: z.string().optional(),
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test tests/worker/llmClient.test.ts`
Expected: both new tests pass; existing tests still pass.

Run: `pnpm compile`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/worker/llmClient.ts tests/worker/llmClient.test.ts
git commit -m "preserve LLM-provided reason on candidate keywords"
```

---

## Task 3: PromptBuilder — request keyword reason in OUTPUT_FORMAT

**Files:**
- Modify: `src/worker/promptBuilder.ts:26-42`
- Test: `tests/worker/promptBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/worker/promptBuilder.test.ts` inside the `describe("promptBuilder", ...)` block:

```ts
it("OUTPUT_FORMAT requests a reason field for candidate_keywords", () => {
  const { system } = buildPrompt([]);
  const fmtIdx = system.indexOf("\"candidate_keywords\"");
  expect(fmtIdx).toBeGreaterThan(0);
  // reason field must appear between candidate_keywords and the next array close
  const slice = system.slice(fmtIdx, fmtIdx + 200);
  expect(slice).toMatch(/"reason"/);
});

it("constrains the keyword reason to <=80 characters", () => {
  const { system } = buildPrompt([]);
  expect(system).toMatch(/keyword.*reason.*80/i);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test tests/worker/promptBuilder.test.ts`
Expected: both new tests fail — current OUTPUT_FORMAT line `"candidate_keywords": [{"phrase": "...", "evidence_tweet_ids": [...]}]` has no reason field.

- [ ] **Step 3: Update `src/worker/promptBuilder.ts:26-33`**

Replace the OUTPUT_FORMAT constant:

```ts
const OUTPUT_FORMAT = [
  "Output strict JSON only — no commentary, no markdown fences:",
  `{
  "spam_tweets": [{"id": "...", "confidence": 0.0-1.0, "reason": "..."}],
  "candidate_keywords": [{"phrase": "...", "reason": "...", "evidence_tweet_ids": [...]}],
  "candidate_users": [{"handle": "...", "evidence_tweet_ids": [...], "reason": "..."}]
}`,
].join("\n");
```

Then update `CANDIDATE_RULES` (around line 35) — append a new bullet at the end of the array:

```ts
const CANDIDATE_RULES = [
  "Constraints:",
  "- **JSON safety**: NEVER use ASCII double-quote (\") inside reason or phrase fields — it breaks JSON parsing. To quote text, use single quotes ' ', or your language's native quotation marks (e.g. « », 「」, “”, ‘ ’).",
  "- candidate_keywords phrases must be specific enough to avoid matching normal conversation. Single common words are too broad — prefer multi-word patterns or distinctive substrings.",
  "- Only nominate candidate_keywords or candidate_users when confidence ≥ 0.7.",
  "- evidence_tweet_ids MUST be drawn from the input id field — do not invent ids.",
  "- For tweets that are pure emoji, random-character lures, or otherwise have no stable extractable substring, prefer candidate_users (block by handle) over candidate_keywords.",
  "- Each candidate_keyword reason MUST be ≤ 80 characters — a brief signal of why this phrase indicates spam (e.g. 'crypto giveaway lure', '中文引流话术'). Same constraint already applies to candidate_user reason.",
].join("\n");
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test tests/worker/promptBuilder.test.ts`
Expected: both new tests pass; existing pass.

- [ ] **Step 5: Commit**

```bash
git add src/worker/promptBuilder.ts tests/worker/promptBuilder.test.ts
git commit -m "ask LLM for a short reason on each candidate keyword"
```

---

## Task 4: BatchAnalyzer — propagate reason + source through Candidate

**Files:**
- Modify: `src/core/types.ts` (add `source?` to `Candidate`)
- Modify: `src/core/schemas.ts` (extend `CandidateSchema`)
- Modify: `src/worker/batchAnalyzer.ts:93-130` (rewrite `collectCandidates`, export `candidateToLearned`)
- Test: `tests/worker/batchAnalyzer.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `tests/worker/batchAnalyzer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { candidateToLearned } from "@/worker/batchAnalyzer";
import type { Candidate } from "@/core/types";

describe("candidateToLearned", () => {
  it("converts a keyword candidate to LearnedKeyword with reason + source", () => {
    const c: Candidate = {
      type: "keyword",
      value: "airdrop scam",
      evidence: ["1", "2"],
      suggestedAt: 1000,
      llmReasoning: "crypto giveaway lure",
      source: "llm-batch",
    };
    const result = candidateToLearned(c, 5000);
    expect(result).toEqual({
      kind: "keyword",
      entry: {
        phrase: "airdrop scam",
        addedAt: 5000,
        hits: 0,
        reason: "crypto giveaway lure",
        source: "llm-batch",
      },
    });
  });

  it("converts a user candidate to LearnedUser with reason + source", () => {
    const c: Candidate = {
      type: "user",
      value: "spammer123",
      evidence: ["3"],
      suggestedAt: 1000,
      llmReasoning: "follow-train shill",
      source: "llm-marked",
    };
    const result = candidateToLearned(c, 5000);
    expect(result).toEqual({
      kind: "user",
      entry: {
        handle: "spammer123",
        reason: "follow-train shill",
        addedAt: 5000,
        source: "llm-marked",
      },
    });
  });

  it("falls back to llm-batch source when missing (back-compat for in-flight Candidates)", () => {
    const c: Candidate = {
      type: "keyword",
      value: "x",
      evidence: [],
      suggestedAt: 0,
      llmReasoning: "y",
    };
    const result = candidateToLearned(c, 0);
    expect(result.entry).toMatchObject({ source: "llm-batch" });
  });

  it("omits reason on keyword when llmReasoning is empty (no fake reason)", () => {
    const c: Candidate = {
      type: "keyword", value: "x", evidence: [], suggestedAt: 0, llmReasoning: "", source: "llm-batch",
    };
    const result = candidateToLearned(c, 0);
    expect(result.entry).not.toHaveProperty("reason");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test tests/worker/batchAnalyzer.test.ts`
Expected: import error (`candidateToLearned` not exported) + Candidate has no `source` field. All 4 tests fail.

- [ ] **Step 3: Extend `Candidate` type in `src/core/types.ts`**

Update the `Candidate` interface:

```ts
export interface Candidate {
  type: "keyword" | "user";
  value: string;
  evidence: string[];
  suggestedAt: number;
  llmReasoning: string;
  source?: ReasonSource;
}
```

- [ ] **Step 4: Extend `CandidateSchema` in `src/core/schemas.ts`**

Replace `CandidateSchema`:

```ts
export const CandidateSchema = z.object({
  type: z.enum(["keyword", "user"]),
  value: z.string(),
  evidence: z.array(z.string()),
  suggestedAt: z.number(),
  llmReasoning: z.string(),
  source: ReasonSourceEnum.optional(),
});
```

- [ ] **Step 5: Rewrite `collectCandidates` and add helper in `src/worker/batchAnalyzer.ts`**

Replace lines 93-130 (the `collectCandidates` function) and add the new helper at the bottom of the file:

```ts
function collectCandidates(
  result: LLMAnalysisResult,
  state: ExtensionState,
  source: "llm-batch" | "llm-marked",
): { newCandidates: Candidate[]; whitelistRejected: number } {
  const wlKeywords = new Set(state.whitelist.keywords);
  const wlUsers = new Set(state.whitelist.users.map((u) => u.toLowerCase()));
  const learnedKeywords = new Set(state.learned.keywords.map((k) => k.phrase));
  const learnedUsers = new Set(state.learned.users.map((u) => u.handle.toLowerCase()));

  const newCandidates: Candidate[] = [];
  let whitelistRejected = 0;

  for (const k of result.candidate_keywords) {
    if (learnedKeywords.has(k.phrase)) continue;
    if (wlKeywords.has(k.phrase)) { whitelistRejected++; continue; }
    newCandidates.push({
      type: "keyword",
      value: k.phrase,
      evidence: k.evidence_tweet_ids,
      suggestedAt: Date.now(),
      llmReasoning: k.reason ?? "",
      source,
    });
  }
  for (const u of result.candidate_users) {
    const lower = u.handle.toLowerCase();
    if (learnedUsers.has(lower)) continue;
    if (wlUsers.has(lower)) { whitelistRejected++; continue; }
    newCandidates.push({
      type: "user",
      value: u.handle,
      evidence: u.evidence_tweet_ids,
      suggestedAt: Date.now(),
      llmReasoning: u.reason,
      source,
    });
  }

  return { newCandidates, whitelistRejected };
}

export type LearnedConversion =
  | { kind: "keyword"; entry: import("@/core/types").LearnedKeyword }
  | { kind: "user"; entry: import("@/core/types").LearnedUser };

// Pure transform: Candidate → the LearnedKeyword/User entry the caller will push.
// Lives here so the popup-side manual-add path and the background apply path can
// share the same shape decisions (reason fallback, source default).
export function candidateToLearned(c: Candidate, addedAt: number): LearnedConversion {
  const source = c.source ?? "llm-batch";
  if (c.type === "keyword") {
    const entry: import("@/core/types").LearnedKeyword = {
      phrase: c.value,
      addedAt,
      hits: 0,
      source,
    };
    if (c.llmReasoning) entry.reason = c.llmReasoning;
    return { kind: "keyword", entry };
  }
  const entry: import("@/core/types").LearnedUser = {
    handle: c.value,
    reason: c.llmReasoning,
    addedAt,
    source,
  };
  return { kind: "user", entry };
}
```

Also update the two callers inside the same file to pass the new typed `source`:

In `BatchAnalyzer.analyze()` (around line 41) change:

```ts
    const collected = collectCandidates(result, state, "batch");
```

to:

```ts
    const collected = collectCandidates(result, state, "llm-batch");
```

In `BatchAnalyzer.analyzeMarkedTweet()` (around line 61) change:

```ts
    const collected = collectCandidates(result, state, `marked-tweet ${tweet.tweetId}`);
```

to:

```ts
    const collected = collectCandidates(result, state, "llm-marked");
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `pnpm test tests/worker/batchAnalyzer.test.ts`
Expected: all 4 tests pass.

Run: `pnpm test`
Expected: full suite passes.

Run: `pnpm compile`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/schemas.ts src/worker/batchAnalyzer.ts tests/worker/batchAnalyzer.test.ts
git commit -m "carry LLM reason and source from Candidate into LearnedKeyword/User"
```

---

## Task 5: subscription.applyPack — write `source: "pack"`

**Files:**
- Modify: `src/worker/subscription.ts:55-96`
- Test: `tests/worker/subscription.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `tests/worker/subscription.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyPack } from "@/worker/subscription";
import { loadState, saveState } from "@/core/storage";
import { defaultState } from "@/core/schemas";
import { __resetStorage } from "../setup";

describe("applyPack", () => {
  beforeEach(async () => {
    __resetStorage();
    await saveState(defaultState());
  });

  it("writes source: 'pack' on imported keyword and user entries", async () => {
    await applyPack(
      {
        version: 1,
        name: "test-pack",
        keywords: [{ phrase: "airdrop scam" }],
        users: [{ handle: "spammer1", reason: "shill" }],
      },
      "test source",
      9999,
    );
    const s = await loadState();
    const kw = s.learned.keywords.find((k) => k.phrase === "airdrop scam");
    const usr = s.learned.users.find((u) => u.handle === "spammer1");
    expect(kw).toBeDefined();
    expect(kw!.source).toBe("pack");
    expect(kw!.reason).toBe("from test source");
    expect(usr).toBeDefined();
    expect(usr!.source).toBe("pack");
    expect(usr!.reason).toBe("shill");
  });

  it("user without pack-supplied reason falls back to 'from <source>'", async () => {
    await applyPack(
      { version: 1, keywords: [], users: [{ handle: "spammer2" }] },
      "starter pack",
      0,
    );
    const s = await loadState();
    const usr = s.learned.users.find((u) => u.handle === "spammer2");
    expect(usr!.reason).toBe("from starter pack");
    expect(usr!.source).toBe("pack");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test tests/worker/subscription.test.ts`
Expected: both tests fail — `applyPack` currently writes no `source` field.

- [ ] **Step 3: Update `src/worker/subscription.ts:71-90`**

In the `applyPack` function, replace the keyword-push block:

```ts
      const entry: LearnedKeyword = {
        phrase: k.phrase,
        addedAt: appliedAt,
        hits: 0,
      };
```

with:

```ts
      const entry: LearnedKeyword = {
        phrase: k.phrase,
        addedAt: appliedAt,
        hits: 0,
        reason: `from ${source}`,
        source: "pack",
      };
```

(Default reason mirrors what user entries already do — keeps the UI from showing the "no reason recorded" fallback for pack-imported keywords.)

And replace the user-push block:

```ts
      const entry: LearnedUser = {
        handle: u.handle,
        reason: u.reason ?? `from ${source}`,
        addedAt: appliedAt,
      };
```

with:

```ts
      const entry: LearnedUser = {
        handle: u.handle,
        reason: u.reason ?? `from ${source}`,
        addedAt: appliedAt,
        source: "pack",
      };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test tests/worker/subscription.test.ts`
Expected: both new tests pass.

Run: `pnpm test`
Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/worker/subscription.ts tests/worker/subscription.test.ts
git commit -m "tag pack-imported entries with source: pack"
```

---

## Task 6: background.ts — applyCandidate uses helper, manual paths set source

**Files:**
- Modify: `entrypoints/background.ts:23-41` (first-run seed → use applyPack)
- Modify: `entrypoints/background.ts:108-131` (applyCandidate uses helper)
- Modify: `entrypoints/background.ts:161-186` (tweet/markSpam author block sets `source: "manual"`)

This task has no dedicated unit tests — it's wiring code. The helper functions it calls are already covered. Verify by running the full suite + manual `pnpm dev` smoke test at the end.

- [ ] **Step 1: Replace first-run seed (lines 23-41) to use `applyPack`**

Replace the entire `chrome.runtime.onInstalled.addListener(...)` block with:

```ts
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== "install") return;
    const s = await loadState();
    if (s.learned.keywords.length > 0 || s.learned.users.length > 0) return;
    const stats = await applyPack(
      {
        version: 1,
        name: DEFAULT_PACK.name,
        keywords: DEFAULT_PACK.keywords.map((k) => ({ phrase: k.phrase })),
        users: DEFAULT_PACK.users.map((u) => ({ handle: u.handle, reason: u.reason })),
      },
      `starter pack ${DEFAULT_PACK.name}`,
    );
    console.log("[tsf] first-run: seeded", stats.newKeywords, "keywords from", DEFAULT_PACK.name);
  });
```

Then update the import line at the top of the file (line 4) to add `applyPack`:

```ts
import { refreshSubscription, importPack, applyPack, SpamPackSchema, type RefreshReport, type ImportPackReport } from "@/worker/subscription";
```

The manual `LearnedKeyword` / `LearnedUser` imports (line 9) `LearnedKeyword` is no longer used here — drop it from the import:

```ts
import type { Candidate, LearnedUser } from "@/core/types";
```

- [ ] **Step 2: Replace `applyCandidate` (lines 109-131)**

Add an import for the helper at the top:

```ts
import { BatchAnalyzer, candidateToLearned } from "@/worker/batchAnalyzer";
```

Replace the `applyCandidate` function:

```ts
  const applyCandidate = async (candidate: Candidate): Promise<void> => {
    await mutateState((s) => {
      const conv = candidateToLearned(candidate, Date.now());
      if (conv.kind === "keyword") {
        if (s.learned.keywords.some((k) => k.phrase === conv.entry.phrase)) return;
        s.learned.keywords.push(conv.entry);
      } else {
        const lower = conv.entry.handle.toLowerCase();
        if (s.learned.users.some((u) => u.handle.toLowerCase() === lower)) return;
        const entry = { ...conv.entry };
        const cachedDn = s.cache.handleToDisplayName[entry.handle];
        if (cachedDn !== undefined) entry.displayName = cachedDn;
        s.learned.users.push(entry);
      }
    });
  };
```

- [ ] **Step 3: Tag the markSpam author block with `source: "manual"`**

Inside `case "tweet/markSpam":` (around line 166), update the `LearnedUser` literal:

```ts
            const newUser: LearnedUser = {
              handle,
              reason: `manually marked from tweet ${msg.payload.tweetId}`,
              addedAt: Date.now(),
              source: "manual",
            };
```

- [ ] **Step 4: Run full suite + type-check**

Run: `pnpm test`
Expected: all pass (no new tests added in this task — relying on coverage from Tasks 4 & 5).

Run: `pnpm compile`
Expected: zero errors.

- [ ] **Step 5: Manual smoke check (optional but recommended)**

Run: `pnpm dev`
Open `chrome://extensions` → reload the unpacked extension → open the popup → confirm:
- Library still renders existing entries.
- No console errors.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/background.ts
git commit -m "wire LLM reason and source into the background apply paths"
```

---

## Task 7: LearnedList UI — accordion, source icon, reason block, evidence link

**Files:**
- Modify: `src/popup/components/LearnedList.tsx`
- Test: `tests/popup/LearnedList.test.tsx` (new file)

This is the largest task; we'll split it into rendering tests + interaction tests.

- [ ] **Step 1: Write the failing tests**

Create `tests/popup/LearnedList.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearnedList } from "@/popup/components/LearnedList";
import type { ExtensionState } from "@/core/types";
import { defaultState } from "@/core/schemas";
import { __resetStorage } from "../setup";

function stateWith(partial: Partial<ExtensionState["learned"]>): ExtensionState {
  const s = defaultState();
  s.learned = { ...s.learned, ...partial };
  return s;
}

// jsdom does not auto-toggle <details> on summary click; force-open the section.
function openSection(label: RegExp): void {
  const summary = screen.getByText(label);
  const details = summary.closest("details") as HTMLDetailsElement | null;
  if (!details) throw new Error(`no <details> ancestor for ${label}`);
  details.open = true;
}

beforeEach(() => {
  __resetStorage();
  vi.restoreAllMocks();
});

describe("LearnedList — reason accordion", () => {
  it("does not show the reason block by default", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "crypto lure", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    expect(screen.queryByText("crypto lure")).not.toBeInTheDocument();
  });

  it("expands the reason block when the toggle is clicked", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "crypto lure", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was airdrop scam blocked/i));
    expect(screen.getByText(/crypto lure/)).toBeInTheDocument();
  });

  it("shows the LLM source icon for llm-batch entries", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "crypto lure", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was airdrop scam blocked/i));
    expect(screen.getByText(/🤖/)).toBeInTheDocument();
  });

  it("shows the manual-add icon for manual-source entries", () => {
    const state = stateWith({
      keywords: [{ phrase: "spam", addedAt: 1, hits: 0, reason: "manually added by you", source: "manual" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was spam blocked/i));
    expect(screen.getByText(/✋/)).toBeInTheDocument();
  });

  it("shows the pack-import icon for pack-source entries", () => {
    const state = stateWith({
      keywords: [{ phrase: "scam", addedAt: 1, hits: 0, source: "pack" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was scam blocked/i));
    expect(screen.getByText(/📦/)).toBeInTheDocument();
  });

  it("shows fallback message when no reason recorded", () => {
    const state = stateWith({
      keywords: [{ phrase: "old entry", addedAt: 1, hits: 0 }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was old entry blocked/i));
    expect(screen.getByText(/no reason recorded/i)).toBeInTheDocument();
  });

  it("renders evidence link to x.com search for keywords", () => {
    const state = stateWith({
      keywords: [{ phrase: "airdrop scam", addedAt: 1, hits: 0, reason: "x", source: "llm-batch" }],
      users: [],
    });
    render(<LearnedList state={state} />);
    openSection(/Keywords/);
    fireEvent.click(screen.getByLabelText(/why was airdrop scam blocked/i));
    const link = screen.getByRole("link", { name: /evidence/i });
    expect(link).toHaveAttribute("href", "https://x.com/search?q=airdrop%20scam");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders evidence link to user profile for users", () => {
    const state = stateWith({
      keywords: [],
      users: [{ handle: "spammer", reason: "x", addedAt: 1, source: "llm-batch" }],
    });
    render(<LearnedList state={state} />);
    openSection(/Users/);
    fireEvent.click(screen.getByLabelText(/why was spammer blocked/i));
    const link = screen.getByRole("link", { name: /evidence/i });
    expect(link).toHaveAttribute("href", "https://x.com/spammer");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test tests/popup/LearnedList.test.tsx`
Expected: all 8 tests fail — current `LearnedList.tsx` has no `···` toggle, no reason block, no evidence link.

- [ ] **Step 3: Update `src/popup/components/LearnedList.tsx`**

Three sub-changes inside this file:

**3a. Add accordion state + helpers near the top of the component (after the existing `useState` block, around line 28):**

```tsx
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const sourceIcon = (src: ReasonSource | undefined): string => {
    switch (src) {
      case "llm-batch":
      case "llm-marked": return "🤖";
      case "manual": return "✋";
      case "pack": return "📦";
      default: return "💭";
    }
  };

  const formatDate = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
```

Add the `ReasonSource` import at the top:

```tsx
import type { ExtensionState, LearnedKeyword, LearnedUser, ReasonSource } from "@/core/types";
```

**3b. Replace the keyword-list `<li>` rendering (around lines 264-272) with:**

```tsx
          {sortedKeywords.map((k) => {
            const key = `kw:${k.phrase}`;
            const isOpen = expanded.has(key);
            return (
              <li key={k.phrase} className="bg-neutral-800 rounded">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="font-mono text-xs min-w-0 truncate">
                    <span className={maskCls}>{k.phrase}</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleExpand(key)}
                      aria-expanded={isOpen}
                      aria-label={`why was ${k.phrase} blocked`}
                      className="text-neutral-500 hover:text-neutral-300 px-1 text-xs"
                    >
                      {isOpen ? "▾" : "···"}
                    </button>
                    <button onClick={() => deleteKeyword(k)}
                      className="text-red-400 hover:text-red-300 text-xs">delete</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-l-2 border-neutral-700 ml-2 mr-2 mb-2 px-2 py-1 bg-neutral-900 rounded-sm text-[11px]">
                    {k.reason ? (
                      <div className={maskCls}>
                        <span>{sourceIcon(k.source)} </span>
                        <span className="text-neutral-300">{k.reason}</span>
                      </div>
                    ) : (
                      <div className="italic text-neutral-500">
                        💭 no reason recorded
                        <div className="text-[10px]">added before reason tracking</div>
                      </div>
                    )}
                    <div className="text-[10px] text-neutral-500 mt-1">
                      added {formatDate(k.addedAt)} ·{" "}
                      <a
                        href={`https://x.com/search?q=${encodeURIComponent(k.phrase)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-neutral-300"
                      >
                        evidence ↗
                      </a>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
```

**3c. Replace the user-list `<li>` rendering (around lines 299-308) with:**

```tsx
          {sortedUsers.map((u) => {
            const key = `user:${u.handle}`;
            const isOpen = expanded.has(key);
            return (
              <li key={u.handle} className="bg-neutral-800 rounded">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs min-w-0 truncate">
                    {u.displayName && <span className={`text-neutral-200 ${maskCls}`}>{u.displayName} </span>}
                    <span className={`font-mono text-neutral-500 ${maskCls}`}>@{u.handle}</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleExpand(key)}
                      aria-expanded={isOpen}
                      aria-label={`why was ${u.handle} blocked`}
                      className="text-neutral-500 hover:text-neutral-300 px-1 text-xs"
                    >
                      {isOpen ? "▾" : "···"}
                    </button>
                    <button onClick={() => deleteUser(u)}
                      className="text-red-400 hover:text-red-300 text-xs">delete</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-l-2 border-neutral-700 ml-2 mr-2 mb-2 px-2 py-1 bg-neutral-900 rounded-sm text-[11px]">
                    <div className={maskCls}>
                      <span>{sourceIcon(u.source)} </span>
                      <span className="text-neutral-300">{u.reason}</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-1">
                      added {formatDate(u.addedAt)} ·{" "}
                      <a
                        href={`https://x.com/${u.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-neutral-300"
                      >
                        evidence ↗
                      </a>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
```

**3d. Update the manual-add paths (`addKeyword`, `addUser`) to set `source: "manual"` and `reason`.**

In `addKeyword` (around line 112) replace:

```tsx
      s.learned.keywords.push({ phrase, addedAt: Date.now(), hits: 0 });
```

with:

```tsx
      s.learned.keywords.push({
        phrase,
        addedAt: Date.now(),
        hits: 0,
        reason: "manually added by you",
        source: "manual",
      });
```

In `addUser` (around lines 142-145) replace:

```tsx
      const entry = dn !== undefined
        ? { handle, displayName: dn, reason: "manually added", addedAt: Date.now() }
        : { handle, reason: "manually added", addedAt: Date.now() };
      s.learned.users.push(entry);
```

with:

```tsx
      const entry: import("@/core/types").LearnedUser = dn !== undefined
        ? { handle, displayName: dn, reason: "manually added by you", addedAt: Date.now(), source: "manual" }
        : { handle, reason: "manually added by you", addedAt: Date.now(), source: "manual" };
      s.learned.users.push(entry);
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test tests/popup/LearnedList.test.tsx`
Expected: all 8 tests pass.

Run: `pnpm test`
Expected: full suite passes.

Run: `pnpm compile`
Expected: zero errors.

- [ ] **Step 5: Manual smoke check**

Run: `pnpm dev` → reload extension → open popup:
- Expand Keywords. Click `···` on a row → reason block appears with icon + reason + `evidence ↗`.
- Click the link → opens `x.com/search?q=...` in a new tab.
- Add a new keyword via the input → expand it → see `✋ manually added by you`.
- For a row that has no `reason` field (old entry), expand → see `💭 no reason recorded`.
- Toggle 🫥 mosaic → reason text gets blurred along with the phrase.

- [ ] **Step 6: Commit**

```bash
git add src/popup/components/LearnedList.tsx tests/popup/LearnedList.test.tsx
git commit -m "show LLM ban reason in Library via inline accordion"
```

---

## Task 8: README screenshot refresh (optional)

**Files:**
- Modify: `docs/screenshots/library.png` (replace file)
- Modify: `README.md` and `README.zh-CN.md` (update caption text describing the new ··· toggle)

This task is OPTIONAL — no functional code change. Skip unless the user asks for the screenshot refresh in the same PR.

If skipping, just confirm the README's library description still makes sense at a glance and move to the wrap-up step below.

---

## Wrap-up

- [ ] **Final verification**

Run all checks one more time:

```bash
pnpm test
pnpm compile
pnpm build
```

Expected: all green.

- [ ] **Manual end-to-end smoke**

1. `pnpm dev` → load unpacked.
2. Open `x.com`, scroll until queue passes batchThreshold.
3. Wait for auto-batch → confirm new entries in popup Library.
4. Expand the new entries → reason should be the LLM's actual text (not "spam pattern").
5. Try the 🚮 button on a tweet → expand the new user entry → see `✋ manually marked from tweet ...`.
6. Verify export: Library → export full backup → open the JSON → both keyword + user entries have `reason` and `source`.

- [ ] **Final commit (only if README updated in Task 8)**

If the screenshots/README were updated in Task 8, commit them now:

```bash
git add docs/screenshots/library.png README.md README.zh-CN.md
git commit -m "refresh Library screenshot to show the why-this-was-blocked accordion"
```

---

## Self-Review Notes (for plan author)

**Spec coverage check:**
- ✅ Section 2 (Data Model) → Task 1
- ✅ Section 3 (Reason sources table) → Tasks 4, 5, 6
- ✅ Section 4 (Prompt change) → Tasks 2, 3
- ✅ Section 5 (UI) → Task 7
- ✅ Section 6 (Files Touched) → covered across Tasks 1–7
- ✅ Section 7 (Migration: zero) → no migration code in any task
- ✅ Section 8 (Risks: LLM ignores 80-char) → mitigation already in `LLMCandidateKeywordSchema` (no length cap on parsing); `break-words` already on the reason block via the existing parent grid

**Out-of-scope sanity check:**
- ❌ in-feed banner reason → not touched ✓
- ❌ re-analyze button → not touched ✓
- ❌ feedback voting → not touched ✓
