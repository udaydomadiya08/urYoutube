# urYouTube v3.3.1 — Test & Evaluation Report

## Execution summary

- **Executed:** 2026-10-24
- **Runtime:** Node.js v22.16.0 (`linux-x64`)
- **Command:** `npm test`
- **Result:** **38 passed, 0 failed**
- **Coverage:** recommendation scoring and user controls; diversity/deduplication; offline information-retrieval evaluation; provider adapters; security regressions; simulated UI workflow; and local HTTP server integration/security.
- JavaScript syntax checks passed for `src/js/app.js`, `src/js/recommendation-engine.js`, `server.js`, and `tests/run_tests.js`.

## Performance and offline evaluation

The 1,000-video ranking microbenchmark measured **26.27 ms** in the recorded run. This is an environment-dependent local microbenchmark, not an end-to-end latency guarantee.

The comparative evaluation uses a 20-video labeled corpus and three personas. These are small offline results, not proof of general superiority:

| Strategy | Precision@5 | Recall@5 | NDCG@5 | ILD@10 | Novelty@5 | Catalog coverage@5 |
|---|---:|---:|---:|---:|---:|---:|
| Popularity/hype baseline | 0.2000 | 0.1057 | 0.1035 | 0.8578 | 0.1155 | 0.2500 |
| Content BM25 + topic rules | 1.0000 | 0.5285 | 1.0000 | 0.9348 | 0.3999 | 0.7000 |
| LightFM-inspired hybrid | 1.0000 | 0.5285 | 1.0000 | 0.9363 | 0.4075 | 0.6500 |
| User-controlled ensemble + MMR | 1.0000 | 0.5285 | 0.9750 | 0.9437 | 0.4270 | 0.6000 |

These metrics depend on the small hand-labeled corpus and its relevance labels. They do not establish that the app will produce the universally optimal feed for every person.

## v3.3.1 user-control regression

Regression tests now cover the user-facing app, both standalone HTML entry points, and the reusable engine: no unconditional live-first sort, no fixed `+100` live-result MMR bonus, opt-in-only live scoring, and no undocumented refresh-cycle ranking jitter. Additional behavioral tests verify that turning MMR off preserves near-duplicate candidates while still removing exact duplicate IDs. Live-result preference is off by default and is applied only through the explicit, bounded user-configured score contribution. Near-duplicate title suppression is part of the optional MMR/diversity module; exact duplicate video IDs remain deduplicated as candidate-data hygiene.

## Verification boundaries

The suite includes automated unit tests, a simulated DOM workflow, and local HTTP integration tests. It does **not** prove that every public Piped/Invidious mirror is available, verify real external API credentials, establish broad real-world recommendation quality, or replace manual accessibility and cross-device usability testing.
