// Tiny starter pack — applied once on fresh install so the extension shows
// value from minute one without any setup. Conservative on purpose: each
// phrase is a near-zero-false-positive marker of spam/lure content.
//
// Users can delete any item (auto-whitelists) or override via their own
// LLM training. Subscribe to a community pack for richer coverage.

export interface DefaultPack {
  version: number;
  name: string;
  keywords: { phrase: string }[];
  users: { handle: string; reason: string }[];
}

export const DEFAULT_PACK: DefaultPack = {
  version: 1,
  name: "XSpamCast starter pack v1",
  keywords: [
    { phrase: "DM for crypto signals" },
    { phrase: "DM for trading signals" },
    { phrase: "DM for signals" },
    { phrase: "OnlyFans link in bio" },
    { phrase: "link in my bio 👅" },
    { phrase: "claim free airdrop" },
    { phrase: "free airdrop claim" },
    { phrase: "100x gem 💎" },
    { phrase: "next 100x gem" },
    { phrase: "join my telegram for signals" },
    { phrase: "follow back train" },
    { phrase: "F4F follow back" },
    { phrase: "🥵👅" },
    { phrase: "🔞🍑" },
  ],
  users: [],
};
