# urYouTube v3.3.1 — Open-Source, Local-First, User-Controlled YouTube Discovery Platform

**urYouTube** is an open-source, local-first video recommendation and discovery platform where **the user—not the platform developer—controls the recommendation algorithm**. Users can select and combine recommendation algorithms, tune ranking objectives (including setting Popularity and Recency influence to zero), define creator and keyword rules, disable personalization, add YouTube videos manually without API keys, and audit the exact mathematical score breakdown of every video.

---

## 1. Core Capabilities

### 1.1 Modular Algorithm Selection (Enable, Disable & Combine)
In the **Algorithm Equalizer & Dynamic Niche Controller**, you can toggle any combination of 7 recommendation methods:
1. **Multi-Objective Weighted Scoring** (`weightedScoring`): Linear combination of your chosen quality, depth, indie, duration, popularity, and recency weights.
2. **Content-Based BM25 / TF-IDF Filtering** (`contentBased`): Lexical relevance matching (`k1 = 1.5, b = 0.75`) against your active search query and natural-language prompt.
3. **Keyword, Topic & Creator Rules** (`keywordTopic`): User-configurable topic, creator, keyword, and live-result boost magnitudes; topic/creator blocks and excluded-keyword hard-blocks remain explicit rule actions.
4. **Item-to-Item Video Similarity** (`videoSimilarity`): Cosine/Jaccard feature similarity against videos in your Intentional Queue.
5. **Novelty & Seeded Exploration** (`noveltyExploration`): Self-information novelty + reproducible PRNG exploration controlled by your **Seed (`0..999999`)**.
6. **Diversity-Aware MMR Reranking** (`diversityReranking`): Maximal Marginal Relevance with user-configurable strength (`0..85%`) and per-creator cap (`1..10`).
7. **Hybrid Collaborative Affinity** (`collaborativeFiltering`): LightFM-inspired feature-interaction embedding model across your saved/liked interaction history.

### 1.2 Full Objective Control & Preference Ownership
- **Advanced Rule Strengths**: Configure base score, topic boost, creator boost, included-keyword boost, live-result boost, MMR strength, and maximum videos per creator (with bounded ranges and imported-profile validation).
- **Set Popularity Influence to Zero**: `Popularity Influence (-100%..+100%)` defaults to **`0%`** (with a one-click `Set 0%` button) so global view counts never bias your feed unless you want them to.
- **Timeless Mode by Default**: `Recency & Freshness Priority (0..100%)` defaults to **`0%`** so classic lectures and documentaries compete fairly with recent uploads.
- **Disable Automatic Personalization**: Uncheck **Personalization & Interaction Learning** at any time to run in 100% stateless policy mode (`similarityContrib = 0`, `collaborativeContrib = 0`).
- **Inspect, Export, Import & Wipe Local Data**: Export/edit your full policy JSON or click **🗑️ Wipe All Local Data** in the profile modal to clear all browser storage (`sessionStorage` and `localStorage`).

### 1.3 Works Locally Without Mandatory API Keys
- **Included Sample Demonstration Catalog (`📦 Sample Demo`)**: Ships with 32 curated demonstration videos clearly badged as `📦 Sample Demo`, which you can toggle on or off via **Include Sample Demo Data (32)**.
- **Manual YouTube URL / Video ID Entry (`➕ Add YouTube URL / ID Locally`)**: Paste any YouTube link (`https://www.youtube.com/watch?v=...`, `https://youtu.be/...`) or 11-character Video ID to add, score, and play videos locally without any API keys.
- **Honest Live Discovery Boundaries**: Local ranking scores candidates already in your pool; discovering *new* videos across YouTube requires an accessible network data source (the zero-key public Piped/Invidious mirror pool, a server-side `.env` key, or an optional browser-supplied YouTube Data API v3 key). When offline or when public mirrors are unreachable, urYouTube transparently reports `Offline Seed Pool (Mirrors Unreachable)` and never fabricates live results.

---

### 1.4 No Hidden Live-Result Ranking Override
- Live-result prioritization is **off by default** and is opt-in through the visible user control.
- When enabled, live-result preference contributes only the configured `liveFreshnessBoost` points; live videos do not receive an unconditional first-place sort or hidden `+100` MMR bonus.
- The refresh cycle does not inject an undocumented ranking bonus. Seeded exploration is controlled by the selected exploration configuration.
- Near-duplicate title suppression is part of the optional diversity/MMR module; exact duplicate video IDs are still removed as candidate-data hygiene.

### 1.5 What “User-Controlled” Means
urYouTube exposes the supported ranking algorithms, documented objective weights, creator/topic/keyword rules, personalization toggle, live preference, and diversity controls to the user. This is **control over the ranking policy implemented by this release**, not a claim that every possible algorithm exists or that any ranking can be proven universally optimal. Recommendation quality depends on the available candidate videos, metadata, and the user's policy choices. Live discovery depends on external providers and may be unavailable.

## 2. Installation & Launch Instructions

### Option A: Local Hardened Node.js Server (Recommended)
Requires **Node.js >= 18.0.0** (zero third-party `npm` runtime packages required):
```bash
# 1. Optional: copy .env.example to .env if you want server-side API keys
cp .env.example .env

# 2. Start the localhost-only server (binds to http://127.0.0.1:3000 by default)
npm start
```

### Option B: Standalone Zero-Server Browser Launch
Open `uryoutube.html` (or `index.html`) directly in any modern desktop or mobile browser.

### Option C: Run Automated Verification & Comparative IR Benchmark Suite
```bash
npm test
# Runs all 38 unit, user-control, comparative IR evaluation, provider resilience,
# security regression, UI workflow, and HTTP server penetration tests.
```

---

## 3. Privacy & Data Transmission Summary

| Data Item | Local Storage Default | External Transmission |
| :--- | :--- | :--- |
| **Algorithm Weights, Enabled Methods, Topic/Creator Rules** | In-memory state (exportable to `.json` file; wiped via `🗑️ Wipe All Local Data`) | Never transmitted to third parties; only search query terms are sent when fetching live videos. |
| **YouTube Data API v3 Key (Optional)** | Server `.env` (`YOUTUBE_API_KEY`) or browser `sessionStorage` by default (opt-in `localStorage`) | Sent **exclusively** to `https://www.googleapis.com/youtube/v3/*`. Never logged or exported. |
| **Gemini API Key (Optional)** | Server `.env` (`GEMINI_API_KEY`) or browser `sessionStorage` by default (opt-in `localStorage`) | Sent **exclusively** to `https://generativelanguage.googleapis.com/*`. Never logged or exported. |

---

## 4. Troubleshooting

- **"Offline Seed Pool (Mirrors Unreachable)" shown in telemetry**: Public Piped/Invidious mirrors may be blocked by your firewall/ISP or rate-limited. You can still rank the 32 sample videos, add any YouTube video via **➕ Add YouTube URL / ID Locally**, or configure a free `YOUTUBE_API_KEY` in `.env` (or the settings modal).
- **Port `3000` already in use**: Start the server on a custom port with `PORT=8080 npm start`.
- **Resetting a broken or overly restrictive filter policy**: Click the **Reset** button next to the prompt bar or open **⇧ Import Algo JSON -> 🗑️ Wipe All Local Data**.

---

## 5. License

Released under the **MIT License**. See [LICENSE](./LICENSE).
