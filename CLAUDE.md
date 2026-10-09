# CLAUDE.md — استوديو ريلز الأخبار (news-reels-studio)

Working memory for Claude sessions on this repo. README.md is the user-facing Arabic guide.

## The user
- Egyptian Arabic; answer short and practical. UI text is Egyptian Arabic, RTL.
- Sister project: `powerflash1000/quran-clip-studio` (same stack; code was copied from it, not shared). Separate accounts/brand: this tool is NOT for the Quran account.
- Posts to TikTok, Instagram, Facebook (manual upload; publishing package comes in M4). Subscriptions: ElevenLabs (own voice clone), Higgsfield, Claude, Filmora.

## Hard decisions (don't re-litigate)
- Static site, no build step, vanilla ES modules, GitHub Pages. No server. Keys only in localStorage (`nrs:` prefix).
- News comes from `data/feeds.json`, written hourly by `.github/workflows/fetch-feeds.yml` (`tools/fetch-feeds.mjs`, no deps). Sources in `config/sources.json`.
- Twelve categories: trending (🔥 ترند), politics, economy, sports, science, health, healthtech (طب وتقنية), ai, defense, stories (قصص وأرشيف), entertainment, tech. Feeds also carry `region` (world/us/arab/eg/gulf/eu/asia; eg & gulf ⊂ arab via `regions[].in`), `weight`, optional `kind` (trend/top), `fmt` (gtrends/wikitop/gnews), `keepDays`, `limit`. Sources carry `lang` + `type` (agency/public/state/official/specialist/radar); Reuters/AP/Bloomberg only as Google News radar. Max 20 items kept per source.
- YouTubers = radar/verification only (RSS titles). Never a source. Every reel needs primary source name + URL on screen (export is blocked otherwise); youtube.com links are rejected as source.
- Claim kinds: `fact` (primary source) vs `opinion` (shown as "رأي وتحليل"). Pre-export checklist is mandatory; health reels get an on-screen medical disclaimer.
- No news-site photos, no photos of political figures. Backgrounds from public-domain/CC/own generation only (M3).
- Script is written by the user; AI drafting is opt-in only: `js/draft.js` (providers: Claude, plus free-tier Gemini/Groq/OpenRouter via OpenAI-compatible fetch, `aiProvider` setting; Claude API via raw `fetch` from the browser with `anthropic-dangerous-direct-browser-access`, user's own key `claudeKey`, default model `claude-opus-5-5`, `output_config.effort: low` + json_schema; no `thinking`/sampling params). Drafts use ONLY the feed summary/headline, list `missing` facts, escape `<`/`>` in untrusted text, and always get reviewed by the user.
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
| `media.js` | media search providers (NASA, Commons, Openverse, Archive, Pixabay) → unified items with license tier; `classifyLicense` rejects NC/ND; `fetchBlob` (CORS-direct for Commons/Openverse, via proxy for NASA/Archive/Pixabay) |
| `render.js` templates | story.template: standard / breaking / stat (count-up) / map (offline world, zoom to highlighted countries); reel.ticker = bottom scrolling strip. `setWorld()` loads `assets/data/world.json` (built by `tools/build-map.mjs` with d3-geo; Natural Earth PD). Template animations use `local` = time since story start |
| `mediastore.js`, `bg.js` | story background blobs in IndexedDB `nrs-media`; load/seek/draw (cover + dim); story.media holds only metadata (blob stays on device) |
| `publish.js` + «النشر» tab (main.js) | M4: `buildPack` (titles/desc with sources + media credits + disclaimers/hashtags by category), `compose` per platform, `summarize` posts by platform/tag. Per-reel data: `reel.pack`, `reel.plan {date,platforms}`, `reel.posts[]` (views/likes/comments/shares/saves/tag). Edits go through `patchReel` (library record + in-memory reel, else autosave overwrites them) |
| `feeds.js`, `storage.js` | feed loading helpers; localStorage/IndexedDB |

## Notes
- A reel (حلقة) can hold many stories. Every `news` story needs its own source (name + non-YouTube URL); intro/outro need none. Export validates per story; checklist is the union of rules over present categories/kinds. >90s asks for confirmation.
- Feed: checkbox multi-select → «ابدأ حلقة من المحدد» / «أضفهم للريل الحالي»; per-item «＋ للريل الحالي».
- Official feed items are kept 45 days (YouTube 30), max 40 per source.
- Audio cache key = voice + model + voice settings + text (IndexedDB `nrs-audio`); opening a reel restores cached audio free (`peekLine`).
- `data/feeds.json` has `health[]` per source (ok/empty/stale/error + reason); UI shows it under the news list.
- Cairo font is bundled in `assets/fonts` (no Google Fonts).
- Media: CORS was probed from CI (not guessable): search APIs all allow browser calls; file hosts of NASA (images-assets.nasa.gov) and archive.org downloads did not send ACAO in the CI probe → expect the user's Cloudflare Worker (Pixabay CDN probe was just a 403 from CI and is NOT conclusive: the Quran app downloads Pixabay directly from the browser, so `fetchBlob` now always tries direct first, then the proxy) (`tools/cors-proxy-worker.js`, allowlist includes them). Commons upload/thumb, Flickr, Openverse thumb are fine. Canvas must stay untainted for `VideoFrame`, so media is always fetched as Blob first. Smithsonian API works (DEMO_KEY, shape probed) but is not wired yet.
- On-screen media credit shows for attribution licenses (and NASA); user uploads have none.
- Background music: `reel.music {id,name,vol}`, blob in `nrs-media`, decoded in main.js (`musicBuf`), mixed by `mixTimeline(segs,dur,music)` (loop, fade, ducking to 35% under voice). Idea source: MoneyPrinterTurbo (not used as code).
- Voice: `tts.js prepareText` — v3 audio tags `[sad]` etc. kept (plus optional `[Egyptian Arabic accent]` prefix, `dialectTag`), stripped on v2; tags/bracket chars are dropped from alignment words and `stripTags` keeps them off captions/estimates. No ElevenLabs dialect param exists (dialect = voice + Egyptian script + hint). `langCode` setting sends `language_code:'ar'` (unverified for v3, off by default). Post-FX: `audio.js` pure-JS DSP chain (HP, EQ shelves/peak, de-esser, compressor, room, RMS normalize+limiter) applied in `mixTimeline(segs,dur,music,fx)` from `settings.fx`; cached per buffer. Captions: `render.js bidiRow/isLtr` reverse runs of Latin/digit words so English phrases read LTR inside Arabic; `settings.caps` (size/plate/stroke).
- Formats: `reel.format` v/p/s/h (9:16, 4:5, 1:1, 16:9). `render.js` has live `W,H`, `setFormat`, layout object `L` (vertical = original constants). Standard/breaking are responsive; stat/map/proof templates draw the vertical layout scaled+centered in other formats (fallback, never overlaps). `exportSupport(fmt)` and `exportReel` call `setFormat` first. Backgrounds: `drawBg(..., media)` fit auto/cover/contain (+zoom, fx/fy); contain = blurred backdrop via tiny canvas upscale.
- Map template: static preview draws with `drawFrame(..., {settled:true})` (local=3.5s) so zoom/highlights/count-up are visible without pressing play. Places: `js/geo.js` — local countries/cities + Open-Meteo geocoding (Arabic names, admin1/country/population; CORS ok, probed from CI) + Nominatim on demand (airports/landmarks; CORS ok). Pins `{name,lat,lon,label,detail}`, `map.zoom` auto/world/wide/region/close. Map data is 110m country borders only (no states/provinces).
- Trending/importance: `fetch-feeds.mjs` pulls Google Trends daily RSS per geo, Wikipedia top views (en/ar/fr/es), Google News top/topic editions (US/GB/EG/SA/AE; radar only, outlet split from title), HN front page. Each item gets `rank/of/w/traffic/views/tk`; `scoreItems` clusters similar titles (token Jaccard) → `cov` = distinct outlets, and `imp` = weight·position + 1.6·log2(cov) + traffic/views terms. UI sort «الأهم والترند» uses `imp` × 0.5^(age/24h); region chips, 🔥 trend-only toggle, prefs in `nrs:feedPrefs`. Unverified feed URLs: check the health panel after each Action run and prune.
- Proof template (`story.proof` = status + ≤3 sources with outlet/title/date/url + optional user screenshot blob in `nrs-media`, QR via vendored `qrcode-generator` MIT) replaces the bottom source bar; map pins (`story.map.pins` lat/lon from `assets/data/cities.json`). We never fetch news-site video/photos (copyright); users may upload their own screenshots.
- M3 done (templates). Map data caveats: 110m resolution (small states are tiny), France includes French Guiana, Palestine/Israel are separate entries per CLDR.
- M4 done (publish pack, queue, experiment log; manual posting, no platform APIs).
- Next: M2 (2D avatars + dialogue mouth sync, YouTuber claim comparison), M3 templates (breaking, lower third, stat card, offline SVG map), M4 queue + publish pack (should include media credits).

## Release step (cache busting)
GitHub Pages caches JS modules ~10 min and browsers keep stale modules, so every import and the CSS link carry `?v=<stamp>`. **Run `node tools/bump-version.mjs` before every commit that changes JS/CSS/HTML** (it rewrites all imports consistently; mixing stamps would load a module twice). The footer shows the code version and warns if page and code versions differ.

## Testing
Playwright + chromium from `/opt/pw-browsers`: serve the repo with `python3 -m http.server`, set `window.__nrsTestCodecs = true` before load, inject audio via `window.__nrs.setManual(AudioBuffer)`. RSS parser: `parseFeed` in `tools/fetch-feeds.mjs`.
