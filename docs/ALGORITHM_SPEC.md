# urYouTube v3.3.1 — Recommendation & Information Retrieval Specification

## 1. Formal Scoring Model

For each candidate video $v$ and user configuration $W = (w_D, w_C, w_I, w_L, w_N, d_{\min}, B_{\text{shorts}}, B_{\text{outrage}})$ with topic preference map $T: \mathcal{T} \to \{-1, 0, +1\}$:

### 1.1 Hard Guard Filters (Pre-Ranking Exclusion)
Unless $v.\text{id} \in \text{manualOverrides}$, video $v$ is marked `isBlocked = true` if any of the following hold:
1. **Topic Block**: $\exists t \in v.\text{topics}$ such that $T(t) = -1$.
2. **Shorts Guard**: $B_{\text{shorts}} = \text{true}$ and $v.\text{durationSec}$ is known ($>0$) and $v.\text{durationSec} < 90$.
3. **Minimum Duration Guard**: $d_{\min} > 0$ and $v.\text{durationSec}$ is known ($>0$) and $v.\text{durationSec} < 60 \cdot d_{\min}$.
4. **Rage-Bait / Clickbait Guard**: $B_{\text{outrage}} = \text{true}$ and $v.\text{clickbaitIndex} \ge 65$.

*Missing-Duration Safety*: When upstream providers omit duration ($v.\text{durationSec} = \text{null}$), `durationKnown` is `false`. The engine neither falsely blocks the video under the `<90s` Shorts Guard nor awards it a high long-form bonus; instead, it assigns a conservative neutral long-form normalization ($L_{\text{norm}} = 40$) and appends `"Duration Unknown"` to `reasons`.

---

### 1.2 Additive Score Contributions
Each component contribution is computed deterministically:

$$C_{\text{depth}}(v) = 0.36 \cdot v.\text{educationalDepth} \cdot \frac{w_D}{100}$$

$$C_{\text{indie}}(v) = 0.22 \cdot v.\text{indieScore} \cdot \frac{w_I}{100}$$

$$L_{\text{norm}}(v) = \begin{cases} \min\!\left(100, \text{round}\!\left(\frac{v.\text{durationSec}}{1800} \cdot 100\right)\right) & \text{if durationKnown} \\ 40 & \text{otherwise} \end{cases}$$

$$C_{\text{long}}(v) = 0.18 \cdot L_{\text{norm}}(v) \cdot \frac{w_L}{100}$$

$$C_{\text{novelty}}(v) = 0.16 \cdot v.\text{noveltyScore} \cdot \frac{w_N}{100}$$

$$C_{\text{clickbait}}(v) = \begin{cases} +0.55 \cdot v.\text{hypeIndex} & \text{if activePreset} = \text{corporate\_trap} \\ -0.45 \cdot v.\text{clickbaitIndex} \cdot \frac{w_{CB}}{100} & \text{otherwise} \end{cases}$$

$$C_{\text{rules}}(v) = w_{TB} \cdot \mathbb{I}[\text{boosted topic}] + w_{CR} \cdot \mathbb{I}[\text{boosted creator}] + w_{KB} \cdot \mathbb{I}[\text{included keyword}] + w_{LF} \cdot \mathbb{I}[\text{live result AND explicit live opt-in}] - 40 \cdot \mathbb{I}[\text{blocked topic}] - 50 \cdot \mathbb{I}[\text{blocked creator}]$$

$$\text{Score}(v) = \text{clamp}\Big(\text{round}\big(b + C_{\text{depth}} + C_{\text{indie}} + C_{\text{long}} + C_{\text{novelty}} + C_{\text{clickbait}} + C_{\text{rules}} + C_{\text{content}} + C_{\text{similarity}} + C_{\text{collaborative}} + C_{\text{exploration}}\big),\; 1,\; 99\Big)$$

### 1.3 Explanation-to-Score Fidelity Guarantee
The base score (`b`), topic boost (`w_TB`), creator boost (`w_CR`), included-keyword boost (`w_KB`), live-result boost (`w_LF`), MMR strength, and maximum videos per creator are user-configurable in bounded ranges. Exported profiles preserve these values. Displayed boost labels are generated from the current policy values; blocked topic/creator rules and excluded keywords remain explicit hard-block actions unless a manual override is applied.

### 1.4 Separation of Observed Metadata vs. Heuristic Estimates
`evaluateVideo()` outputs two distinct sub-objects inside `breakdown`:
- `observedMetadata`: `{ durationSec, durationText, views, channel }` — raw factual fields returned by the provider.
- `heuristicEstimates`: `{ source: 'heuristic_title_metadata_inference' | 'gemini_ai_verified', educationalDepth, clickbaitIndex, indieScore, noveltyScore }` — inferred signals clearly labeled in both the API payload and UI (`Heuristic Est.` vs `AI Verified`).

---

## 2. Near-Duplicate Suppression & MMR Diversification

1. **Deterministic Base Ordering**: Candidates are sorted by `(score DESC, id ASC)`. Live status is not a separate sort key. A live-result contribution applies only when the user explicitly enables live prioritization; its magnitude is controlled by `liveFreshnessBoost`.
2. **Exact-ID Deduplication and Optional Near-Duplicate Suppression**: Exact duplicate YouTube IDs are always removed as candidate-data hygiene. When MMR/diversity is enabled, titles are normalized to lowercase alphanumeric token sets ($|\text{token}| > 2$); a candidate whose token set has Jaccard similarity $\ge 0.82$ with an already-accepted higher-ranked video is suppressed. Length-ratio pruning ($\min(|A|,|B|) / \max(|A|,|B|) < 0.80$) skips comparisons in $O(1)$ time. Disabling MMR disables near-duplicate suppression.
3. **Greedy Maximal Marginal Relevance (MMR) with Creator Cap**:
   - Enforces `maxPerCreator` (default `2`, bounded `1..10`) across the primary ranked list.
   - At each step, selects candidate $c$ maximizing:
     $$\text{MMR}(c) = (1 - \lambda)\cdot \text{Score}(c) - \lambda \cdot 28 \cdot \max_{s \in \text{Recent}_4} \text{Sim}(c, s) + E(c)$$
     where `lambda` is the user-configurable MMR strength (default `0.32`, bounded to `0..0.85`), `Recent_4` is the last four selected items, `Sim` uses documented channel/category overlap coefficients, and `E(c)` is zero unless a deterministic exploration offset is explicitly supplied. The channel/category coefficients are implementation parameters rather than independently exposed controls.

---

## 3. Offline Information Retrieval Evaluation Dataset & Results

- **Dataset Origin & Construction**: `LABELED_CORPUS_20` in `tests/run_tests.js` comprises $N = 20$ representative videos spanning Computer Science & Mathematics, AI & Systems, Indie Hardware/OS Craft, Architectural Essays, Long-Form History & Philosophy Documentaries, and Viral/Clickbait Shorts (`60` total profile-video relevance judgments).
- **Relevance Grading Rubric**:
  - `3` = Highly relevant (rigorous, long-form, directly aligned with persona intent)
  - `2` = Relevant (solid educational or craft value aligned with secondary interests)
  - `1` = Tangential (high quality but outside the persona's primary domain)
  - `0` = Non-relevant / Attention Trap (clickbait, prank, rage-bait, or `<90s` short clip)
- **Measured Results (`v22.16.0` on `linux-x64`)**:
  - **Profile A (Deep CS & Systems Learner)**: `Precision@5 = 1.00`, `Recall@5 = 0.4545`, `NDCG@5 = 1.0000`, `ILD@10 = 0.9333`
  - **Profile B (Indie Craft & Architecture Explorer)**: `Precision@5 = 1.00`, `NDCG@5 = 1.0000`, `ILD@10 = 0.9556`
  - **Profile C (Long-Form History & Philosophy Scholar)**: `Precision@5 = 1.00`, `NDCG@5 = 0.9250`, `ILD@10 = 0.9422`
  - **1,000-Video Throughput Benchmark (acceptance threshold <150 ms; timing is environment-dependent)**: `20.39 ms` (`evaluateVideo` across 1,000 synthetic videos + `rankAndDiversifyFeed` MMR over 200 candidates; measured in the recorded Node.js run).
- **Dataset Limitations**: Because offline heuristic signals rely on title/duration/view metadata when no LLM key or transcript is available, subtle clickbait disguised with academic phrasing cannot be detected without transcript inspection or optional Gemini semantic scoring.


## Release v3.3.1 — User-Control Boundary

Live-result prioritization is disabled by default. In the reusable engine, live score contribution is zero unless `prioritizeLiveVideos: true` is explicitly passed. If enabled, it contributes only through the configured `liveFreshnessBoost`; there is no unconditional live-first ordering or fixed live-result bonus in MMR. MMR no longer injects refresh-cycle jitter. Near-duplicate title suppression is part of the optional diversity module, while exact duplicate video IDs are removed as candidate-data hygiene. The user controls the documented ranking policy implemented by this release; recommendation quality depends on candidate coverage, metadata, and the selected policy and is not universally optimal by guarantee.
