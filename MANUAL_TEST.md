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
