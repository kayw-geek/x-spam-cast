export const HIDE_STYLES = ["collapse", "nuke"] as const;
export type HideStyle = (typeof HIDE_STYLES)[number];

export const STORAGE_KEY = "tsf_state";
export const QUEUE_MAX = 200;
export const DEFAULT_BATCH_THRESHOLD = 50;
