# urYouTube v3.3.1 — Release Verification

## Verified in this build

- `npm test`: **38 passed, 0 failed** on Node.js v22.16.0 (`linux-x64`).
- JavaScript syntax checks passed for the application, recommendation engine, server, and test runner.
- Local HTTP integration tests passed for health, static app delivery, config-status non-disclosure, Gemini proxy validation, upstream deadlines, path traversal, SSRF query-parameter rejection, and rate limiting.
- Recommendation tests passed for deterministic scoring, configurable objective weights and rule strengths, algorithm toggles, stateless personalization, seeded exploration, diversity, provider resilience, and comparative offline evaluation.
- Regression tests cover the source app, both HTML entry points, and reusable engine; they verify no unconditional live-first sort, no fixed +100 live-result bonus, opt-in-only live scoring, and no refresh-cycle jitter. Behavioral tests verify optional near-duplicate suppression.
- The app defaults to live-result prioritization off, consistent with a no-hidden-recency preference. Users can explicitly enable live prioritization and configure its score contribution.
- Package, server, recommendation-engine, provider, and report metadata identify the release as `3.3.1`.

## Not claimed as verified

- Availability of public Piped/Invidious mirrors at the time of use.
- End-to-end live search with a real user's API keys.
- Broad real-world recommendation quality. Offline evaluation uses a 20-video labeled corpus and three personas.
- A universally optimal recommendation ranking. The application exposes controls for its supported ranking policy; results still depend on the candidate set, metadata quality, and the user's choices.
- Full cross-browser/mobile usability or formal security certification. The UI workflow tests use a simulated DOM.

## Run locally

Requires Node.js 18 or newer:

```bash
npm test
npm start
```

The server binds to `http://127.0.0.1:3000` by default. API keys are optional for launching the local catalog, ranking available candidates, and adding videos manually. Live discovery depends on a reachable provider or optional configured credentials. See `README.md` and `.env.example`.
