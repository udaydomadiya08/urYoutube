# Contributing to urYouTube

Thank you for helping build user-owned social media algorithms!

## Ways to Contribute
1. **Share Algorithm Presets**: Export your favorite `.json` profile using the **⇩ Export / Share Algo JSON** button in the app and submit a PR adding it to `presets/`.
2. **Add Public Piped / Invidious Mirrors**: Update `PIPED_INSTANCES` and `INVIDIOUS_INSTANCES` in `index.html` / `src/js/app.js` with fast, reliable CORS-enabled instances.
3. **Improve Heuristic & AI Signals**: Propose new transparent signals (e.g., comment-to-view ratio, sponsor-block integration, or textbook citation detection).

## Local Development
1. Clone the repository and run `node server.js` (or open `index.html` directly).
2. Make your changes in `index.html` (and sync `uryoutube.html`).
3. Test with both Zero-Key mode and API-Key mode before opening a Pull Request.
