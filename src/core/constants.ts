export const SPAM_CATEGORIES = ["spam", "nsfw", "scam"] as const;
export type SpamCategory = (typeof SPAM_CATEGORIES)[number];

// Legacy → current mapping for stored data migration. v1 had 7 fine-grained
// categories; we collapsed to 3 because users don't differentiate ad/promo/marketing.
export const LEGACY_CATEGORY_MAP: Record<string, SpamCategory> = {
  ad: "spam", promo: "spam", marketing: "spam", lure: "spam", rumor: "spam",
  nsfw: "nsfw", scam: "scam",
  spam: "spam",
};

export const HIDE_STYLES = ["collapse", "dim", "nuke"] as const;
export type HideStyle = (typeof HIDE_STYLES)[number];

export const STORAGE_KEY = "tsf_state";
export const QUEUE_MAX = 200;
export const MUTE_RATE_LIMIT_MS = 2500;
export const DEFAULT_BATCH_THRESHOLD = 50;
