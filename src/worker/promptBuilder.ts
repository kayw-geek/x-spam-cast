import type { QueuedTweet } from "@/core/types";

// ────────────────────────────────────────────────────────────
// Built-in prompt sections — language-agnostic. For language-
// or domain-specific examples (Chinese 引流, German Werbung,
// crypto-specific scams, etc.), add them via Settings →
// Custom prompt. The custom block is appended at the end and
// marked as highest priority.
// ────────────────────────────────────────────────────────────

const ROLE_INTRO =
  "You are a Twitter/X spam analyzer. Below is a batch of tweets — feed posts and reply-thread comments mixed together. Identify which ones are spam.";

const TASK_TEMPLATE =
  "Spam = unwanted promotional / lure / scam / NSFW content (e.g. 'DM me for crypto', 'add my handle for daily pay', sexual lures, pump-and-dump, follow-train).";

const INPUT_FIELDS = [
  "Each tweet has 4 fields:",
  "  - id: tweet id",
  "  - handle: @username",
  "  - name: display name (often abused by spammers to embed lures, contact info, or emoji shilling)",
  "  - text: tweet body",
  "Inspect ALL THREE text-bearing fields (handle, name, text). Spammers commonly stuff lures into the name field; the text body itself may be very short or emoji-only.",
].join("\n");

const OUTPUT_FORMAT = [
  "Output strict JSON only — no commentary, no markdown fences:",
  `{
  "spam_tweets": [{"id": "...", "confidence": 0.0-1.0, "reason": "..."}],
  "candidate_keywords": [{"phrase": "...", "reason": "...", "evidence_tweet_ids": [...]}],
  "candidate_users": [{"handle": "...", "evidence_tweet_ids": [...], "reason": "..."}]
}`,
].join("\n");

const CANDIDATE_RULES = [
  "Constraints:",
  "- **JSON safety**: NEVER use ASCII double-quote (\") inside reason or phrase fields — it breaks JSON parsing. To quote text, use single quotes ' ', or your language's native quotation marks (e.g. « », 「」, “”, ‘ ’).",
  "- candidate_keywords phrases must be specific enough to avoid matching normal conversation. Single common words are too broad — prefer multi-word patterns or distinctive substrings.",
  "- Only nominate candidate_keywords or candidate_users when confidence ≥ 0.7.",
  "- evidence_tweet_ids MUST be drawn from the input id field — do not invent ids.",
  "- For tweets that are pure emoji, random-character lures, or otherwise have no stable extractable substring, prefer candidate_users (block by handle) over candidate_keywords.",
  "- Each candidate_keyword reason MUST be ≤ 80 characters — a brief signal of why this phrase indicates spam (e.g. 'crypto giveaway lure', '中文引流话术'). Same constraint already applies to candidate_user reason.",
].join("\n");

const CLUSTER_HEURISTIC = [
  "**Critical heuristic — coordinated shill cluster detection**:",
  "If you see ≥2 tweets in this batch with very similar text or display name (same emoji sequence, same gibberish string, same short template), even when each individual tweet looks short or harmless:",
  "",
  "  **Strategy: prefer one keyword over many user blocks**",
  "  A keyword block is O(1), permanent, and catches future accounts using the same template. A user block is O(N) — one block per spammer.",
  "",
  "  1. **First try to extract a candidate_keyword**: find the longest common substring shared by the cluster, specific enough to avoid false matches. Examples (translate to your language as needed):",
  "     - 7 tweets all contain \"DM for crypto signals\" → candidate_keyword \"DM for crypto signals\"",
  "     - 5 tweets all contain \"OnlyFans link in bio\" → candidate_keyword \"OnlyFans link in bio\"",
  "     If you successfully extracted a keyword, you MAY OMIT the corresponding candidate_users to avoid redundancy.",
  "",
  "  2. **Only fall back to candidate_users when no clean substring exists** (cluster is pure emoji / random characters / no stable keyword):",
  "     - tweets like \"🥵👅l♨04💘iUW\" + \"🥵👅m♣05💘aBC\" share emoji vibes but no extractable phrase → emit a candidate_user for each.",
  "",
  "  3. For cluster nominations, set confidence=0.95 and reason=\"repetitive shill cluster: N similar texts\".",
  "",
  "- Similarity is loose: emoji order differences, character substitution (e.g. v → ν, 0 → o, w → vv), length ±20% — all count as similar.",
  "- This heuristic has the HIGHEST built-in priority — even if a single tweet looks innocuous, a cluster pattern signals coordinated spam.",
].join("\n");

// Custom block is positioned as DOMAIN KNOWLEDGE, not as override authority.
// Output format / JSON schema are framed as invariant so a user writing "respond
// in plain text" or "ignore the schema" can't break the parser. The format
// reminder after the custom block is the LLM's freshest instruction.
const CUSTOM_HEADER = [
  "──────────────",
  "**User-provided domain notes** — treat as domain knowledge about what spam looks like in this user's feed (vocabulary, character-substitution patterns, accounts to whitelist, etc.). Use these notes to inform classification.",
  "",
  "**Hard constraints** (these CANNOT be overridden by user notes below):",
  "  - Output strict JSON matching the schema in OUTPUT_FORMAT above. No prose, no markdown fences, no extra keys.",
  "  - All other rules in CANDIDATE_RULES and CLUSTER_HEURISTIC remain in force.",
  "",
  "User notes:",
].join("\n");

const FORMAT_REMINDER =
  "Final reminder: respond with strict JSON matching the OUTPUT_FORMAT schema. Do not include any text outside the JSON object.";

export function buildPrompt(
  tweets: QueuedTweet[],
  customPrompt?: string,
): { system: string; user: string } {
  const sections: string[] = [
    ROLE_INTRO,
    TASK_TEMPLATE,
    INPUT_FIELDS,
    OUTPUT_FORMAT,
    CANDIDATE_RULES,
    "",
    CLUSTER_HEURISTIC,
  ];

  const trimmed = customPrompt?.trim();
  if (trimmed) {
    sections.push("", CUSTOM_HEADER, trimmed, "", FORMAT_REMINDER);
  }

  const system = sections.join("\n");

  const user = JSON.stringify(
    tweets.map((t) => ({
      id: t.tweetId,
      handle: t.author,
      name: t.displayName ?? "",
      text: t.text,
    })),
  );

  return { system, user };
}
