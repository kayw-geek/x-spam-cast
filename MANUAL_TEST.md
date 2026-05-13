# Manual Test Checklist (v0.2 — local-only)

Run before tagging any release. Requires a real X login.

## Prereqs
- `pnpm build` succeeds
- Load `dist/chrome-mv3/` as unpacked extension in a Chrome dev profile
- (Optional) DeepSeek / OpenAI key for LLM-related steps

## Day-1 (no config)
- [ ] Install — popup opens, lands on Library, shows the Onboarding card (no LLM key)
- [ ] Open x.com — starter pack matches: tweets containing "DM for crypto signals" / "OnlyFans link in bio" / "🥵👅" etc. are hidden
- [ ] Popup → Library: starter-pack keywords visible
- [ ] Click Onboarding's "Open Settings →" button — switches to Settings tab

## LLM batch flow (with key)
- [ ] Settings → paste DeepSeek baseUrl/key/model → Test connection → ✓ → Save
- [ ] Browse x.com a few minutes, queue grows toward batch threshold (50)
- [ ] Auto-batch fires; new keywords/users land in Library
- [ ] "force now" link only appears when queue is non-empty

## Manual mark
- [ ] 🚮 button visible on each tweet's action row
- [ ] Click 🚮 → tweet hides instantly; author handle appears in Library → Users
- [ ] If LLM key is set, the marked-tweet LLM extraction may add a keyword too

## Library
- [ ] Delete keyword → toast appears with Undo for 6s → Undo restores it; whitelist row also removed
- [ ] Delete keyword and let toast expire → keyword stays in Whitelist
- [ ] Whitelist → click "remove" → entry gone; LLM may re-propose it

## Subscription
- [ ] Sync tab → paste any public spamlist URL (gist raw) → Refresh → counts update; new keywords/users appear in Library

## Cloud sync (chrome.storage.sync)
- [ ] Sync tab → "Push now" → success ("Pushed N KB in X chunks")
- [ ] Open extension in another Chrome profile signed into the same Google account → Library auto-pulls on first install
- [ ] Sync tab → "Restore" → confirm dialog → Library + Whitelist replaced

## Stats
- [ ] Library top strip shows "X hidden today · Y this week"
- [ ] Expand "stats" → grid + 7-day sparkline visible

## Failure paths
- [ ] Disable wifi, "force now" → re-enqueues, error surfaced
- [ ] Bad API key → 401 surfaced, queue preserved

## Known limitations
- Image-only spam not detected
- DOM extractor depends on `article[role="article"]` and standard X markup
- chrome.storage.sync caps at ~91 KB (≈ 3000 short keywords). Beyond that, use Export to file
