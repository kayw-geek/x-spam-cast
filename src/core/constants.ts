export const HIDE_STYLES = ["collapse", "nuke"] as const;
export type HideStyle = (typeof HIDE_STYLES)[number];

export const STORAGE_KEY = "tsf_state";
export const QUEUE_MAX = 200;
export const DEFAULT_BATCH_THRESHOLD = 50;

// Hard cap on LLM-proposed keyword phrases. Substring match is all-or-nothing —
// a long phrase ("DM me for crypto signals every day at 9am") fails as soon as the
// spammer changes one word. Force the LLM to extract the distinctive core, and
// drop anything past the cap at parse time as defence-in-depth.
export const MAX_KEYWORD_LEN = 30;
