# Security Policy & Threat Model — urYouTube v3.3.1

## 1. Threat Model & Security Controls

### 1.1 Contextual Output Encoding & DOM XSS Prevention
- Every untrusted string interpolated into an HTML template (`video.title`, `video.channel`, `video.subscribers`, `video.durationText`, `video.summary`, `video.aiReason`, `blockedReason`, preset names/IDs, topic labels, category chips, and API test logs) is passed through `escapeHtml()`, which encodes `&`, `<`, `>`, `"`, `'`, `/`, and `` ` ``.
- Numeric score fields interpolated into `createVideoCardHTML` and `openVideoModal` (`educationalDepth`, `indieScore`, `noveltyScore`, `clickbaitIndex`, `depthContrib`, `indieContrib`, `longFormContrib`, `noveltyContrib`, `clickbaitEffect`, `score`) are explicitly coerced via `Number(...) || 0`.
- Video identifiers are validated against `/^[A-Za-z0-9_-]{11}$/` (`isValidYoutubeId`) before constructing thumbnail URLs (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`), embed iframe URLs (`https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0`), or external watch links (`sanitizeExternalUrl`).

### 1.2 Preset Import Validation & Prototype Pollution Defense
- `validatePresetProfile()` in `src/js/recommendation-engine.js` and the `#applyImportedAlgoJsonBtn` handler in `uryoutube.html` reject any JSON payload containing `__proto__`, `constructor`, or `prototype`.
- All slider weights are clamped to their valid numeric domain (`[0, 100]` for percentages, `[0, 30]` for `minDurationMin`, `[0, 85]` for `diversityWeight`, `[1, 10]` for `maxPerCreator`).
- `topicPrefs` entries are validated key-by-key against `/^[a-zA-Z0-9_-]{1,36}$/` and restricted to `{-1, 0, 1}` values (never merged via unvalidated `Object.assign`).
- Imported `customTopics` are capped at 25 items, stripped of `<` and `>` characters, and restricted to alphanumeric/hyphen/underscore IDs.

### 1.3 Content Security Policy (CSP) Architecture
- When served via `node server.js`, Vercel (`vercel.json`), or Netlify (`netlify.toml`), urYouTube delivers a strict HTTP `Content-Security-Policy` response header:
  ```text
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com data:;
  img-src 'self' https://i.ytimg.com data:;
  frame-src https://www.youtube-nocookie.com https://www.youtube.com;
  connect-src 'self' https://www.googleapis.com https://generativelanguage.googleapis.com https://pipedapi.kavin.rocks https://pipedapi.tokhmi.xyz https://pipedapi.moomoo.me https://pipedapi.syncpundit.io https://api.piped.private.coffee https://pipedapi.drgns.space https://pipedapi.ducks.party https://inv.tux.pizza https://invidious.nerdvpn.de https://invidious.privacyredirect.com https://vid.puffyan.us https://yewtu.be https://inv.nadeko.net https://api.allorigins.win;
  object-src 'none';
  base-uri 'self';
  frame-ancestors 'self'
  ```
- **Why HTTP Headers Instead of `<meta http-equiv="Content-Security-Policy">`**: Delivering CSP via HTTP response headers enables `frame-ancestors 'self'` (which browsers ignore in `<meta>` tags) and preserves compatibility with sandboxed iframe preview environments that reject `<meta http-equiv="Content-Security-Policy">`. Because `uryoutube.html` is architected as a zero-build single-file distributable with inline `<script>` and `<style>`, `script-src` and `style-src` include `'unsafe-inline'`, while `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, and the explicit `connect-src` allowlist restrict data exfiltration and plugin execution.

### 1.4 API Key Privacy & Server-Side `.env` Isolation
- **Server-Side Path**: Setting `YOUTUBE_API_KEY` and `GEMINI_API_KEY` in `.env` keeps credentials strictly inside the Node.js server process (`server.js`). `GET /api/config-status` returns only boolean availability flags (`serverYoutubeKeyConfigured`, `serverGeminiKeyConfigured`) and never exposes raw key strings.
- **Browser Storage Path**: When keys are entered in the browser UI without a backend server, they default to **session-only `sessionStorage`** (wiped when the tab closes) unless the user explicitly checks `#persistKeysCheckbox` to use `localStorage`.
- **Strict Endpoint Isolation**: `ytApiKey` is transmitted exclusively to `https://www.googleapis.com/youtube/v3/*`. `geminiApiKey` is transmitted exclusively to `https://generativelanguage.googleapis.com/*`. Neither key is ever sent to Piped, Invidious, AllOrigins, or written to logs/presets.

### 1.5 Server-Side Request Forgery (SSRF), Rate Limiting & Path Traversal Guards
- `GET /api/youtube-search` rejects any request containing `url`, `target`, or `host` parameters (`HTTP 400`), only connects to hardcoded `https://` allowlisted hosts, disables automatic redirect following (`3xx` responses are rejected immediately), and aborts upstream responses exceeding `2 MB`.
- `POST /api/gemini-proxy` enforces a `32 KB` request body cap and connects exclusively to `https://generativelanguage.googleapis.com`.
- All API routes enforce a per-IP sliding-window rate limit (`60 requests / 60 seconds`, returning `HTTP 429` when exceeded).
- Static file serving resolves paths against `ROOT_DIR`, blocks null bytes and URL-encoded traversal (`/..%2f..%2fetc/passwd` -> `HTTP 403`), and blocks dotfiles (`/.env`, `/.env.example`, `/.git` -> `HTTP 403`).


## Upstream request deadlines

The Node.js server applies a wall-clock deadline to outbound HTTPS requests in addition to socket timeouts, because DNS or connection setup can stall before a socket timeout is effective. The YouTube search endpoint also uses a bounded overall budget for the official API attempt and public-mirror fallbacks. If upstream DNS or services are unavailable, the endpoint returns `UPSTREAM_UNAVAILABLE` rather than waiting indefinitely. Actual provider availability depends on the deployment network and must be verified there.
