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

function tryParse(s: string): unknown | null {
  try { return JSON.parse(s); } catch { return null; }
}

// LLMs frequently emit near-JSON: trailing commas, smart quotes, comments, fences.
// Walk a few normalization passes before giving up.
function parseLooseJson(raw: string): unknown {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // Pass 1: as-is
  const direct = tryParse(stripped);
  if (direct !== null) return direct;

  // Pass 2: clip to first { ... matching last }
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  const sliced = first !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
  const sliceTry = tryParse(sliced);
  if (sliceTry !== null) return sliceTry;

  // Pass 3: strip trailing commas and JS-style line comments
  const cleaned = sliced
    .replace(/\/\/[^\n\r]*/g, "")          // // comments
    .replace(/\/\*[\s\S]*?\*\//g, "")      // /* block comments */
    .replace(/,(\s*[}\]])/g, "$1")         // trailing commas
    .replace(/[“”]/g, '"')       // smart double quotes
    .replace(/[‘’]/g, "'");      // smart single quotes
  const cleanTry = tryParse(cleaned);
  if (cleanTry !== null) return cleanTry;

  // Pass 4: escape stray unescaped " inside string values (LLM commonly does this in
  // Chinese reason fields, e.g. `"reason": "含引流文案"看简介"，正文..."`).
  // State-machine: track string context, treat a " as string-end only if the next
  // non-whitespace char is a structural token (, } ] :), otherwise escape it.
  const escaped = escapeStrayQuotes(cleaned);
  const escapedTry = tryParse(escaped);
  if (escapedTry !== null) return escapedTry;

  // Give up — surface raw content (truncated) so user can see what model returned
  const preview = stripped.length > 300 ? stripped.slice(0, 300) + "…" : stripped;
  throw new Error(`LLM returned malformed JSON. Raw response: ${preview}`);
}

function escapeStrayQuotes(s: string): string {
  let out = "";
  let inString = false;
  let prevEscaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (prevEscaped) { out += c; prevEscaped = false; continue; }
    if (c === "\\") { out += c; prevEscaped = true; continue; }
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
    } else if (c !== '"') {
      out += c;
    } else {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      const next = s[j];
      if (next === undefined || next === "," || next === "}" || next === "]" || next === ":") {
        out += c;
        inString = false;
      } else {
        out += '\\"';
      }
    }
  }
  return out;
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
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`LLM ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseLooseJson(content) as LLMAnalysisResult;
    return {
      spam_tweets: parsed.spam_tweets ?? [],
      candidate_keywords: parsed.candidate_keywords ?? [],
      candidate_users: parsed.candidate_users ?? [],
    };
  }
}
