# LLM Ban Reason — Design Spec

**Date:** 2026-05-14
**Author:** Brainstormed with Claude (Opus 4.7)
**Status:** Approved by user, ready for implementation plan

---

## Problem

XSpamCast's LLM silently adds keywords / users to the user's Library. The user has no way to inspect the LLM's reasoning at the time of the decision. Symptoms:

- A user opens Library, sees `"今晚月色真美"` blocked, can't tell if it's a real spam pattern or a misfire.
- LearnedUser already carries a `reason` field (schema-required) but the popup never displays it — wasted data.
- LearnedKeyword has no `reason` field at all. The LLM does return per-keyword reasons (see `LLMClient.analyze` output shape), but `batchAnalyzer.ts:115` overwrites it with the literal string `"spam pattern"` and discards the original.

**Result:** trust gap. Users either over-delete (low trust in LLM) or rubber-stamp the Library (excessive trust). Neither is healthy for an automation product.

## Goals

1. Every Library entry exposes *why* it's there, on demand.
2. Every entry tells the user *who/what* added it (LLM batch / manual add / pack import / 🚮 marked-tweet).
3. The user can spot-check the LLM by jumping to live X search for a blocked phrase.
4. Old entries (added before this feature) degrade gracefully — no fake reasons, no silent LLM re-calls.

## Non-Goals (YAGNI)

- ❌ "Re-analyze with LLM" button → costs the user money on click.
- ❌ Background backfill of old entries → opaque, expensive, surprising.
- ❌ Confidence scores from the LLM → self-reported confidence is noise.
- ❌ Feedback loop where users vote on reason quality → no product evidence yet.
- ❌ Reason on the in-feed collapse banner (`hider.ts`) → deferred to a follow-up PR to keep this change scoped.
- ❌ Reason translation layer → reasons are written in whatever language the LLM responds in (driven by `customPrompt`).

## Data Model Changes

### `src/core/types.ts`

```ts
interface LearnedKeyword {
  phrase: string;
  addedAt: number;
  hits: number;
  reason?: string;        // NEW — optional so old entries deserialize cleanly
  source?: ReasonSource;  // NEW — provenance icon driver, see below
}

interface LearnedUser {
  handle: string;
  displayName?: string;
  reason: string;         // existing — required
  addedAt: number;
  source?: ReasonSource;  // NEW
}

type ReasonSource = "llm-batch" | "llm-marked" | "manual" | "pack";
```

> Why no `evidence` field? The "evidence ↗" link is generated from `phrase` (→ `x.com/search?q=...`) or `handle` (→ `x.com/<handle>`). Storing tweet IDs would 404 within weeks; the live search is the better evidence surface. Don't pay storage cost for data we don't need.

### `src/core/schemas.ts`

- `LearnedKeywordSchema`: add `reason: z.string().optional()`, `source: z.enum([...]).optional()`.
- `LearnedUserSchema`: add `source: z.enum([...]).optional()`. Keep `reason` required (no breaking change).

### Backwards compatibility

- Old `chrome.storage.sync` entries and old exported backups have neither `reason` (on keywords) nor `evidence` nor `source`. All three are optional → zod parses cleanly, UI falls back to "no reason recorded".
- Old user entries with placeholder reasons like `"manually added"` or `"... · from marked-tweet xxx"` keep their text. The UI just renders whatever string is there.

## Reason Sources & How They're Set

| Origin | `source` | `reason` written |
|---|---|---|
| `BatchAnalyzer.analyze` (auto-batch) | `"llm-batch"` | The LLM's per-keyword/user `reason` field, verbatim |
| `BatchAnalyzer.analyzeMarkedTweet` (🚮) | `"llm-marked"` | LLM reason verbatim — no ` · from marked-tweet xxx` suffix anymore (the icon does that job) |
| Library "Add" input (`LearnedList.tsx`) | `"manual"` | Literal `"manually added by you"` |
| Subscription / pack import (`subscription.ts`, `pack/import` handler) | `"pack"` | Pack's `reason` field if present, else `"from subscription pack"` |

No separate evidence storage — the link target is derived from `phrase` / `handle` at render time.

## Prompt Change

`src/worker/promptBuilder.ts` — extend the JSON schema we ask the LLM to return so each `candidate_keyword` includes a `reason` field:

```jsonc
{
  "candidate_keywords": [
    {
      "phrase": "...",
      "reason": "≤80 chars: why this phrase signals spam",
      "evidence_tweet_ids": ["..."]
    }
  ],
  "candidate_users": [ /* existing shape — no change */ ]
}
```

Constraint: `reason` must be ≤80 characters. Rationale:
- Fits the 380px popup without word-wrapping into a paragraph.
- Token cost is negligible relative to the per-batch prompt (the LLM is already producing user-side reasons).
- Forces the LLM to give a signal, not an essay.

`LLMClient` parses the new field; `batchAnalyzer.ts:109-117` stops discarding it and writes it through `collectCandidates` → `LearnedKeyword.reason`.

## UI

### Library row — collapsed (default)

```
┌──────────────────────────────────────┐
│ airdrop scam                ···  delete │
└──────────────────────────────────────┘
```

The `···` button is new. It sits between the phrase and the existing `delete` button. ARIA `aria-expanded`, `aria-controls` to the reason panel.

### Library row — expanded

```
┌──────────────────────────────────────┐
│ airdrop scam                ▾   delete │
│ ┌──────────────────────────────────┐ │
│ │ 🤖 typical crypto giveaway scam  │ │
│ │    pattern (mentions wallet+DM)  │ │
│ │ added 2026-05-12 · evidence ↗    │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- Reason block: `bg-neutral-900` with a 2px left accent border (`border-l-2 border-neutral-700`) to read as "child info".
- **Source icon prefix** (1-character emoji + space):
  - `🤖` LLM (batch or marked — same icon, source distinction is in the metadata line)
  - `✋` manual
  - `📦` pack
- Metadata line, `text-[10px] text-neutral-500`:
  - `added <YYYY-MM-DD>` (always)
  - ` · evidence ↗` — always shown. Anchor with `target="_blank" rel="noreferrer"`, href = `https://x.com/search?q=<encodeURIComponent(phrase)>` for keywords, `https://x.com/<handle>` for users. Works equally for old entries (we have phrase/handle regardless of reason presence).
- **No-reason fallback** (old entries without `reason`):
  ```
  💭 no reason recorded
  added before reason tracking · added <YYYY-MM-DD>
  ```
  Color: `text-neutral-500 italic`. Honest, not faked.

### Mosaic mode

`mosaic` already blurs phrase / handle / display name. Reason text frequently restates the spam phrase, so it gets the same `maskCls` treatment. Evidence link text (`evidence ↗`) is not blurred — it's UI chrome, not user-readable spam.

### State management

```ts
const [expanded, setExpanded] = useState<Set<string>>(new Set());
// keyed by `kw:${phrase}` or `user:${handle}` — collisions impossible across types
```

In-memory only. Closing the popup resets. No persistence in storage / sync — accordion state is ephemeral by design (Apple-style: don't remember UI state the user didn't ask you to remember).

### What we're NOT doing in UI

- No first-time auto-expand / onboarding hint. The `···` is discoverable, and adding a one-time tour costs more code than it earns.
- No keyboard shortcut to expand all (yet).
- No copy-reason button — users can text-select the reason block normally.

## Files Touched

| File | Change |
|---|---|
| `src/core/types.ts` | Add `reason?` / `source?` to `LearnedKeyword`. Add `source?` to `LearnedUser`. Add `ReasonSource` union. |
| `src/core/schemas.ts` | Make new optional fields parseable in zod schemas. |
| `src/worker/promptBuilder.ts` | Ask LLM for `candidate_keywords[].reason` (≤80 chars). |
| `src/worker/llmClient.ts` | Parse the new `reason` field on keyword candidates (currently dropped). |
| `src/worker/batchAnalyzer.ts` | Stop overwriting keyword reason; write `source`, `reason`, `evidence` for both keyword & user. Drop the ` · from ${source}` suffix on user reasons (icon handles provenance now). |
| `src/worker/subscription.ts` | When importing pack entries, set `source: "pack"` and `reason: <pack reason or default>`. |
| `src/popup/components/LearnedList.tsx` | Add `···` toggle, expanded reason block, source icon, metadata line, evidence link. Manual-add path sets `source: "manual"`, `reason: "manually added by you"`. |
| `tests/core/schemas.test.ts` | Old payload (no reason/source on keyword) parses; new payload round-trips. |
| `tests/worker/batchAnalyzer.test.ts` | LLM-returned keyword reason persists into LearnedKeyword. |
| `tests/popup/LearnedList.test.tsx` | Toggle expand/collapse; old entry shows fallback; mosaic blurs reason; evidence link href correct. |

## Migration

Zero migration code. New fields are optional. Existing users open the popup → see their old entries without `···` showing reason data → expand → fallback message tells them why. Future entries get the full treatment automatically.

## Risks

- **LLM ignores the 80-char limit** → UI wraps gracefully (`break-words`), but list density suffers. Mitigation: prompt explicitly says "max 80 characters" and we truncate to 200 chars at parse time as a hard guard.
- **LLM produces misleading reasons** → user mis-decides. Mitigation: that's exactly what evidence ↗ exists for. We're surfacing the LLM's claim, not asserting it.
- **Old entries dominate the Library** → fallback message is everywhere, feels broken. Mitigation: it's only visible *on expand*. Most users never expand most rows.

## Open Questions

None at this stage. Implementation plan to follow via `writing-plans` skill.
