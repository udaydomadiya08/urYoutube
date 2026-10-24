# urYouTube v3.3.1 — Principal Engineering & Architecture Report

## 1. Executive Summary

**urYouTube v3.3.1** transforms the project into a local-first, modular, user-controlled video recommendation and discovery platform. Users have direct mathematical control over which recommendation algorithms run, how ranking objectives are weighted (including setting Popularity and Recency influence to `0%`), how creators and keywords are filtered, and whether personalization is active or stateless—while allowing local ranking and manual video entry without mandatory API keys. Live discovery still depends on accessible external sources.

The automated verification suite is run with `npm test`; release verification reports only checks executed in this repository. The test suite now covers advanced rule-strength controls in both the reusable recommendation engine and the simulated user-facing app workflow.

---

## 2. Open-Source Recommender Research & Modular Integration

1. **[`bjsi/open-recommender`](https://github.com/bjsi/open-recommender)**:
   - Inspected its profile-to-query generation pipeline and "Timeless vs. Trending / Niche Craft" philosophy. Implemented clean-room local query expansion and a dedicated **Recency & Freshness slider defaulting to `0%` (Timeless Mode)** so classic high-depth lectures are never penalized by upload age unless the user explicitly raises `recency`.
2. **[`lyst/lightfm`](https://github.com/lyst/lightfm)** (Apache-2.0):
   - Inspected Maciej Kula's hybrid matrix factorization model where users and items are represented as the sum of latent feature embeddings. Implemented `scoreHybridCollaborative()` in `src/js/recommendation-engine.js`, computing latent feature-interaction affinity across topics, channels, educational depth, and duration from the user's saved/liked interaction history.
3. **[`recommenders-team/recommenders`](https://github.com/recommenders-team/recommenders)** (MIT):
   - Implemented modular **Content-Based BM25/TF-IDF (`scoreContentBasedBM25`)**, **Item-to-Item Cosine/Jaccard Similarity (`scoreItemSimilarity`)**, **Maximal Marginal Relevance (`rankAndDiversifyFeed`)**, and a 4-strategy comparative evaluation benchmark measuring `Precision@5`, `Recall@5`, `NDCG@5`, `ILD@10`, `Novelty@5`, and `Catalog Coverage@5`.

---

## 3. Genuine User Control & Local-First Capabilities Implemented

- **7 Independently Toggleable Algorithms (`state.algorithms`)**: Users can enable, disable, or combine `weightedScoring`, `contentBased` (BM25/TF-IDF), `keywordTopic`, `videoSimilarity`, `noveltyExploration`, `diversityReranking` (MMR), and `collaborativeFiltering` (LightFM-inspired hybrid). Disabling any algorithm immediately sets its mathematical contribution to `0`.
- **Full Objective & Rule Control**:
  - **Popularity Influence (`-100%..+100%`, default `0%`)** with a one-click `Set 0%` button so view counts have zero influence by default.
  - User-configurable **base score, topic boost, creator boost, included-keyword boost, live-result boost, MMR strength, and maximum per-creator count**; values are bounded, reflected in the UI, and included in algorithm profile import/export.
  - **Recency Priority (`0..100%`, default `0%`)**, **Query Relevance (`0..100%`)**, **Educational Depth**, **Anti-Clickbait**, **Indie Boost**, **Long-Form**, **Novelty**, and **Minimum Duration (`0..30m`)**.
  - User-configurable **topic, creator, included-keyword, live-result, and base-score magnitudes**, plus explicit creator/topic blocks and excluded-keyword hard-blocks.
- **Preference Ownership, Stateless Mode & Reproducibility**:
  - `#enablePersonalizationCheckbox` disables all interaction learning (`similarityContrib = 0`, `collaborativeContrib = 0`) when unchecked.
  - `#wipeAllLocalDataBtn` deletes all local preferences, custom topics, creator rules, saved videos, and keys from `localStorage`, `sessionStorage`, and memory.
  - `#explorationSeedInput` provides deterministic seeded PRNG (`mulberry32`) exploration.
- **Zero-Key Local-First Operation**:
  - Built-in demonstration videos (`N = 32`) are explicitly tagged with `isSampleData: true` (`📦 Sample Demo` badge) and can be hidden or shown via `#showSampleDataCheckbox`.
  - Users can add any YouTube video via `#manualVideoFormSection` (`➕ Add YouTube URL / ID Locally`) without any API keys.
  - Live discovery across all YouTube videos requires an accessible data source (official YouTube Data API v3 key, `.env` server proxy, or reachable public Piped/Invidious mirrors); when offline or unreachable, the app clearly reports `Offline Seed Pool (Mirrors Unreachable)` rather than fabricating live results.


## v3.3.1 Final Policy Audit

The final source audit found that the reusable recommendation module still contained a live-first tie-break/bonus and suppressed near-duplicate titles even when MMR was disabled. These behaviors contradicted the release's stated user-control boundary. v3.3.1 removes the hidden live ranking precedence, makes live-score contribution opt-in, and limits near-duplicate suppression to the enabled MMR module. New regression tests cover those behaviors. The user-facing standalone app and reusable module remain separate implementations; the release reports this rather than claiming a single shared scoring implementation.
