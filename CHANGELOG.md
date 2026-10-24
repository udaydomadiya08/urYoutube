# Changelog — urYouTube

## [3.3.1] — 2026-10-24 — Final User-Control Audit Fixes

### Fixed — Reusable Recommendation Engine Policy Consistency
- Removed live-status-first sorting and the fixed `+100` live bonus from the reusable ranking engine; live status cannot outrank a higher-scored candidate by itself.
- Changed live-result score boosts to be strictly opt-in (`prioritizeLiveVideos: true`). Omitting the option now means zero live boost, matching the UI's off-by-default policy.
- Made near-duplicate title suppression conditional on the optional diversity/MMR module. Exact duplicate video IDs remain deduplicated as input hygiene.
- Aligned reusable-engine MMR defaults and bounds with the documented UI policy, including a default strength of `32`, a creator cap of `1..10`, a 4-item similarity window, and the documented similarity penalty scale.
- Added regression tests for live-score opt-in, live reranking order, and disabling MMR without disabling exact-ID deduplication.
- Updated algorithm specification and release evidence to describe behavior actually present in the source.

## [3.3.0] — 2026-10-24 — User-Controlled Ranking Release

### Fixed — Removed Hidden Ranking Overrides
- Removed unconditional live-result-first sorting and the hard-coded `+100` live bonus from MMR reranking. Live-result preference is now opt-in by default and contributes only through the visible, bounded `liveFreshnessBoost` control.
- Removed undocumented refresh-cycle jitter from MMR selection; reproducible exploration is driven by the user's configured seed.
- Made near-duplicate title suppression part of the optional diversity/MMR module. Exact duplicate video IDs remain deduplicated as candidate-data hygiene.
- Synchronized release/version metadata and documented the scope and limits of user control: users control the ranking policy implemented here, while discovery quality remains dependent on candidate coverage and metadata.
- Added regression checks to prevent hidden live-result ranking precedence from returning.


All notable architectural, algorithmic, security, and user-control changes to **urYouTube** are documented in this file.

## [3.2.2] — 2026-10-24

### Added — User-Controlled Rule Magnitudes
- Added visible sliders for base score, topic boost, creator boost, included-keyword boost, live-result boost, MMR strength, and maximum results per creator. Creator overflow is deferred lower in the list rather than silently deleted.
- Wired the sliders to the actual standalone application scoring state, score explanations, profile export/import, and local-data reset.
- Added bounded validation for imported values and regression tests for both the reusable recommendation engine and the user-facing app workflow.
- Updated release metadata and excluded the generated per-run test artifact from the release package so integrity manifests remain reproducible.

## [3.2.1] — 2026-10-24

### Fixed — Complete Local Data Reset & Accurate Product Messaging
- Fixed **Wipe All Local Data** so it resets search/prompt state, recommendation weights, topic preferences, creator rules, personalization controls, exploration seed, modal state, API-key input fields, and custom topics in addition to clearing browser storage and local interaction data.
- Restored built-in topics and the default local catalog after a wipe; custom user-added videos and custom topics no longer remain in memory after the reset.
- Updated the app title, header status, and tagline to describe urYouTube as a local, user-controlled discovery engine rather than implying live or AI-powered discovery is always active.
- Bumped package and server/engine metadata to v3.2.1.

## [3.2.0] — 2026-10-24

### Added — Genuine User Control & Modular Recommendation Framework
- **Modular 7-Algorithm Selection Studio**: Users can independently enable, disable, and combine:
  1. **Multi-Objective Weighted Scoring** (`weightedScoring`)
  2. **Content-Based BM25 / TF-IDF Filtering** (`contentBased`, informed by `recommenders-team/recommenders`)
  3. **Keyword, Topic & Creator Rules** (`keywordTopic`)
  4. **Item-to-Item Video Similarity** (`videoSimilarity`)
  5. **Novelty & Seeded Exploration** (`noveltyExploration`)
  6. **Diversity-Aware MMR Reranking** (`diversityReranking`)
  7. **Hybrid Collaborative / Feature-Interaction Affinity** (`collaborativeFiltering`, inspired by Maciej Kula's `lyst/lightfm` hybrid embedding formulation)
- **Full Ranking Objective Controls**:
  - Added **Query & Content Relevance (`0..100%`)**, **Popularity Influence (`-100%..+100%`, defaulting to `0%` with a one-click `Set 0%` button)**, and **Recency & Freshness Priority (`0..100%`, defaulting to `0%` Timeless Mode)**.
  - Added **Creator Boost (`+18 pts`) & Creator Hard-Block (`✕`)** controls in both the Algorithm Equalizer and the Video Player Modal (`#modalBlockCreatorBtn`).
  - Added **Included Keywords (`+15 pts`)** and **Excluded Keywords (Hard-Block)** filter inputs.
- **Preference Ownership & Stateless Personalization Control**:
  - Added `#enablePersonalizationCheckbox` (**Personalization & Interaction Learning** toggle): unchecking disables all interaction-based similarity and collaborative boosts (`similarityContrib = 0`, `collaborativeContrib = 0`) for 100% stateless policy-driven ranking.
  - Added `#wipeAllLocalDataBtn` (**Wipe All Local Data**) in the Algorithm Profile Modal to delete all stored preferences, custom topics, creator rules, saved queue items, manual overrides, and API keys from memory, `sessionStorage`, and `localStorage`.
  - Added `#explorationSeedInput` (`mulberry32` deterministic PRNG seed) for bit-for-bit reproducible exploration.
- **Local-First Operation Without Mandatory API Keys**:
  - Added **Manual YouTube URL / Video ID Entry** (`#manualVideoFormSection`, `extractYoutubeVideoId`, `createManualVideoRecord`) supporting `youtube.com/watch?v=...`, `youtu.be/...`, `youtube-nocookie.com/embed/...`, `youtube.com/shorts/...`, and raw 11-character IDs while rejecting non-YouTube domains and `javascript:`/`data:` URLs.
  - Clearly labeled all 32 included demonstration videos with `isSampleData: true` (`📦 Sample Demo` badge) and added `#showSampleDataCheckbox` so users can hide or include sample demonstration data at any time.
- **Comparative Multi-Algorithm Evaluation Suite**:
  - Added `compareRecommendationAlgorithms()`, `computeCatalogCoverageAtK()`, and `computeNoveltyAtK()` in `src/js/recommendation-engine.js` and expanded `tests/run_tests.js` to **33 automated tests**.

## [3.1.0] — 2026-10-24

### Security, Reliability & Hardening
- Added server-side `.env` credential support (`loadDotEnv()`, `GET /api/config-status`, server-key prioritization in `GET /api/youtube-search`, and `POST /api/gemini-proxy`) in `server.js`.
- Defaulted browser-entered API keys to session-only `sessionStorage` with opt-in `localStorage` persistence (`#persistKeysCheckbox`).
- Enforced HTTP `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, wall-clock upstream request deadlines (`fetchAllowlistedJson`), and sliding-window rate limiting (`60 req/min`).
- Embedded standalone offline fallback CSS utilities and system font stacks in `uryoutube.html`, `index.html`, and `src/css/styles.css`, and guarded `window.tailwind` initialization when the optional CDN is unreachable.
