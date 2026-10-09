# CLAUDE.md — استوديو ريلز الأخبار (news-reels-studio)

Working memory for Claude sessions on this repo. README.md is the user-facing Arabic guide.

## The user
- Egyptian Arabic; answer short and practical. UI text is Egyptian Arabic, RTL.
- Sister project: `powerflash1000/quran-clip-studio` (same stack; code was copied from it, not shared). Separate accounts/brand: this tool is NOT for the Quran account.
- Posts to TikTok, Instagram, Facebook (manual upload; publishing package comes in M4). Subscriptions: ElevenLabs (own voice clone), Higgsfield, Claude, Filmora.

## Hard decisions (don't re-litigate)
- Static site, no build step, vanilla ES modules, GitHub Pages. No server. Keys only in localStorage (`nrs:` prefix).
- News comes from `data/feeds.json`, written hourly by `.github/workflows/fetch-feeds.yml` (`tools/fetch-feeds.mjs`, no deps). Sources in `config/sources.json`.
- Five categories: politics, economy, sports, science, health.
- YouTubers = radar/verification only (RSS titles). Never a source. Every reel needs primary source name + URL on screen (export is blocked otherwise); youtube.com links are rejected as source.
- Claim kinds: `fact` (primary source) vs `opinion` (shown as "رأي وتحليل"). Pre-export checklist is mandatory; health reels get an on-screen medical disclaimer.
- No news-site photos, no photos of political figures. Backgrounds from public-domain/CC/own generation only (M3).
- Script is written by the user; AI drafting only as opt-in later (Claude API key, M2).
- Dialogue lines `أ:` / `ب:`, two ElevenLabs voices (`voiceA`, `voiceB`), per-line IndexedDB cache, with-timestamps for word sync.
- Milestones: M1 feeds+script+voice+source template+export (done) → M2 dialogue avatars (2D mouth sync) + YouTuber claim comparison → M3 templates (breaking, lower third, stat card, offline SVG map) + multi backgrounds → M4 queue, publish pack (titles/desc/hashtags), experiment log.

## Code map (`js/`)
| file | what |
|---|---|
| `main.js` | UI wiring + state (feed, studio, settings, export checklist) |
| `reel.js` | reel = `stories[]` (kind news/intro/outro; each has its own category, headline, source, script); `normalizeReel` migrates old flat reels; `buildReelTimeline` → `{tl:{segs,stories,duration}, real, lines, hasB}` |
| `tts.js` | ElevenLabs with-timestamps + cache + char counter |
| `audio.js` | decode, recorder, timeline mix |
| `render.js` | canvas frame (1080×1920), same function for preview and export |
| `export.js` | WebCodecs H.264/AAC + mp4-muxer (`window.__nrsTestCodecs` allows VP9/Opus in headless tests) |
| `library.js` | reels library (localStorage `nrs:reels`), status, backup/restore (secrets excluded) |
| `feeds.js`, `storage.js` | feed loading helpers; localStorage/IndexedDB |

## Notes
- A reel (حلقة) can hold many stories. Every `news` story needs its own source (name + non-YouTube URL); intro/outro need none. Export validates per story; checklist is the union of rules over present categories/kinds. >90s asks for confirmation.
- Feed: checkbox multi-select → «ابدأ حلقة من المحدد» / «أضفهم للريل الحالي»; per-item «＋ للريل الحالي».
- Official feed items are kept 45 days (YouTube 30), max 40 per source.
- Audio cache key = voice + model + voice settings + text (IndexedDB `nrs-audio`); opening a reel restores cached audio free (`peekLine`).
- `data/feeds.json` has `health[]` per source (ok/empty/stale/error + reason); UI shows it under the news list.
- Cairo font is bundled in `assets/fonts` (no Google Fonts).
- Next batch: media library (NASA, Wikimedia Commons, Openverse, CDC/NIH/NOAA, Smithsonian, Internet Archive, Pixabay) with license + credit line; then M2.

## Testing
Playwright + chromium from `/opt/pw-browsers`: serve the repo with `python3 -m http.server`, set `window.__nrsTestCodecs = true` before load, inject audio via `window.__nrs.setManual(AudioBuffer)`. RSS parser: `parseFeed` in `tools/fetch-feeds.mjs`.
