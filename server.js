#!/usr/bin/env node
/**
 * urYouTube — Hardened Production & Local HTTP Server
 * ===================================================
 * Version: 3.3.1
 * License: MIT
 *
 * Security & Reliability Controls:
 * 1. Content Security Policy (CSP) & Security Headers: Enforces HTTP `Content-Security-Policy`,
 *    `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
 *    `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.
 * 2. Server-Side API Key Configuration Path (`.env` / `process.env`):
 *    - Allows operators to configure `YOUTUBE_API_KEY` and `GEMINI_API_KEY` on the server
 *      so credentials never need to be stored in browser storage (`localStorage`/`sessionStorage`).
 *    - `GET /api/config-status` reports boolean availability (`serverYoutubeKeyConfigured`,
 *      `serverGeminiKeyConfigured`) without ever exposing raw key strings to the client.
 *    - `GET /api/youtube-search` uses server-side `YOUTUBE_API_KEY` (if configured) before
 *      falling back to allowlisted HTTPS Piped/Invidious mirrors.
 *    - `POST /api/gemini-proxy` proxies structured prompt requests to `gemini-2.5-flash`
 *      using server-side `GEMINI_API_KEY` (if configured) with a strict 32 KB body limit.
 * 3. Strict SSRF Protection: Outbound requests only connect to hardcoded allowlisted HTTPS
 *    endpoints with manual redirect handling (never follows 3xx redirects, never accepts custom URLs).
 * 4. Rate Limiting: Sliding-window limiter (60 req/min per IP) on API routes.
 * 5. Response Size Cap: Streams are aborted if upstream payload exceeds 2 MB.
 * 6. Path Traversal & Dotfile Guard: Rejects dotfiles (`.env`, `.git`) and any path escaping `ROOT_DIR`.
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;

// Minimal zero-dependency .env loader so local users can store keys in .env outside browser storage
function loadDotEnv(envFilePath = path.join(ROOT_DIR, '.env')) {
  try {
    if (!fs.existsSync(envFilePath)) return;
    const raw = fs.readFileSync(envFilePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (/^[A-Z0-9_]+$/.test(key) && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    // Ignore unreadable .env and fall back to process.env
  }
}

loadDotEnv();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024; // 2 MB cap
const MAX_POST_BODY_BYTES = 32 * 1024; // 32 KB cap for /api/gemini-proxy
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQ = 60;

// Unified Strict SSRF Allowlist of HTTPS YouTube Indexers (7 Piped + 6 Invidious)
const ALLOWED_UPSTREAM_SEARCH_BUILDERS = Object.freeze([
  q => `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://pipedapi.tokhmi.xyz/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://pipedapi.moomoo.me/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://pipedapi.syncpundit.io/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://api.piped.private.coffee/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://pipedapi.drgns.space/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://pipedapi.ducks.party/search?q=${encodeURIComponent(q)}&filter=videos`,
  q => `https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  q => `https://invidious.nerdvpn.de/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  q => `https://invidious.privacyredirect.com/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  q => `https://vid.puffyan.us/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  q => `https://yewtu.be/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  q => `https://inv.nadeko.net/api/v1/search?q=${encodeURIComponent(q)}&type=video`
]);

const ALLOWED_STATIC_EXTENSIONS = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
});

const CSP_HEADER_VALUE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https://i.ytimg.com data:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "connect-src 'self' https://www.googleapis.com https://generativelanguage.googleapis.com https://pipedapi.kavin.rocks https://pipedapi.tokhmi.xyz https://pipedapi.moomoo.me https://pipedapi.syncpundit.io https://api.piped.private.coffee https://pipedapi.drgns.space https://pipedapi.ducks.party https://inv.tux.pizza https://invidious.nerdvpn.de https://invidious.privacyredirect.com https://vid.puffyan.us https://yewtu.be https://inv.nadeko.net https://api.allorigins.win",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
].join('; ');

const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQ - 1 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX_REQ) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQ - entry.count };
}

function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP_HEADER_VALUE);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function fetchAllowlistedJson(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      reject(new Error('Invalid upstream URL'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('Disallowed protocol'));
      return;
    }

    // A wall-clock deadline is required in addition to Node's socket timeout:
    // DNS resolution can stall before a socket exists, so req.setTimeout alone
    // does not guarantee that a public-provider request finishes promptly.
    const timeoutMs = Math.max(1, Number(options.timeout) || 4500);
    let settled = false;
    let hardTimer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      fn(value);
    };

    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'urYouTube-OpenSource/3.3.1',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      timeout: timeoutMs
    };

    const req = https.request(targetUrl, reqOptions, res => {
      // Never follow redirects to prevent SSRF redirect bypass.
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        finish(reject, new Error(`Redirect disallowed (HTTP ${res.statusCode})`));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        finish(reject, new Error(`Upstream HTTP ${res.statusCode}`));
        return;
      }

      let body = '';
      let receivedBytes = 0;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (settled) return;
        receivedBytes += Buffer.byteLength(chunk, 'utf8');
        if (receivedBytes > MAX_UPSTREAM_BYTES) {
          finish(reject, new Error('Upstream payload exceeded 2MB limit'));
          req.destroy();
          res.destroy();
          return;
        }
        body += chunk;
      });
      res.on('end', () => {
        if (settled) return;
        try {
          finish(resolve, JSON.parse(body));
        } catch (e) {
          finish(reject, new Error('Invalid JSON from upstream'));
        }
      });
      res.on('error', err => finish(reject, err));
    });

    hardTimer = setTimeout(() => {
      const err = new Error('Upstream request deadline exceeded');
      finish(reject, err);
      req.destroy(err);
    }, timeoutMs);

    req.on('timeout', () => {
      const err = new Error('Upstream timeout');
      finish(reject, err);
      req.destroy(err);
    });
    req.on('error', err => finish(reject, err));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function readRequestBody(req, maxBytes = MAX_POST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      received += Buffer.byteLength(chunk, 'utf8');
      if (received > maxBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getClientIp(req) {
  const forwarded = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return (req && req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

async function parseRequestBody(req, maxBytes = MAX_POST_BODY_BYTES) {
  if (req && req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') {
      return req.body;
    }
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
        throw new Error('PAYLOAD_TOO_LARGE');
      }
      return JSON.parse(req.body);
    }
  }
  const rawBody = await readRequestBody(req, maxBytes);
  return JSON.parse(rawBody);
}

// 1. Health Check Handler
function handleHealth(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'uryoutube',
      version: '3.3.1',
      uptimeSec: Math.round(process.uptime())
    })
  );
}

// 2. Server-Side Configuration Status Handler (Never exposes raw API keys)
function handleConfigStatus(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      serverYoutubeKeyConfigured: Boolean((process.env.YOUTUBE_API_KEY || '').trim()),
      serverGeminiKeyConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      storageRecommendation: 'Prefer server-side .env keys or session-only storage over persistent localStorage on shared machines.'
    })
  );
}

// 3. Allowlisted YouTube Search Proxy Handler
async function handleYoutubeSearch(req, res, parsedUrl, clientIp = getClientIp(req)) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const rl = checkRateLimit(clientIp);
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in 60 seconds.', category: 'QUOTA_EXCEEDED' }));
    return;
  }

  // Reject any attempt to pass a custom upstream URL parameter (SSRF guard)
  if (parsedUrl.searchParams.has('url') || parsedUrl.searchParams.has('target') || parsedUrl.searchParams.has('host')) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Custom upstream URLs are forbidden (SSRF protection).' }));
    return;
  }

  const rawQ = (parsedUrl.searchParams.get('q') || '').trim();
  if (!rawQ || rawQ.length > 140) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Query parameter "q" must be 1..140 characters.' }));
    return;
  }

  // Bound the entire search request so dead DNS/providers cannot stall the UI.
  const searchDeadline = Date.now() + 3500;

  // Path A: Use server-configured YOUTUBE_API_KEY if present in environment
  const serverYtKey = (process.env.YOUTUBE_API_KEY || '').trim();
  if (serverYtKey) {
    try {
      const ytSearchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(rawQ)}&key=${encodeURIComponent(serverYtKey)}`;
      const officialBudget = Math.max(1, Math.min(1800, searchDeadline - Date.now()));
      const searchData = await fetchAllowlistedJson(ytSearchUrl, { timeout: officialBudget });
      if (searchData && Array.isArray(searchData.items)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ source: 'server_youtube_api_v3', items: searchData.items }));
        return;
      }
    } catch (err) {
      // Fall through to allowlisted Piped/Invidious mirrors if official key fails
    }
  }

  // Path B: Query allowlisted HTTPS Piped & Invidious mirrors within the remaining budget.
  for (const buildUrl of ALLOWED_UPSTREAM_SEARCH_BUILDERS) {
    const remainingBudget = searchDeadline - Date.now();
    if (remainingBudget <= 0) break;
    try {
      const data = await fetchAllowlistedJson(buildUrl(rawQ), { timeout: Math.min(1500, remainingBudget) });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      return;
    } catch (err) {
      // Try next allowlisted mirror
    }
  }

  res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      error: 'Public YouTube mirrors are currently unreachable from this network.',
      category: 'UPSTREAM_UNAVAILABLE'
    })
  );
}

// 4. Gemini Proxy Handler
async function handleGeminiProxy(req, res, clientIp = getClientIp(req)) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed (use POST)' }));
    return;
  }
  const rl = checkRateLimit(clientIp);
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded.', category: 'QUOTA_EXCEEDED' }));
    return;
  }

  const serverGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!serverGeminiKey) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Server-side GEMINI_API_KEY is not configured in .env.', category: 'MISSING_CREDENTIALS' }));
    return;
  }

  let parsedBody;
  try {
    parsedBody = await parseRequestBody(req, MAX_POST_BODY_BYTES);
  } catch (e) {
    const status = e.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    const msg = e.message === 'PAYLOAD_TOO_LARGE'
      ? 'Request payload exceeds 32KB limit or is unreadable.'
      : 'Invalid JSON body.';
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: msg }));
    return;
  }

  const promptText = typeof parsedBody.prompt === 'string' ? parsedBody.prompt.trim().slice(0, 8000) : '';
  if (!promptText) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Missing "prompt" string in request body.' }));
    return;
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(serverGeminiKey)}`;
    const upstreamData = await fetchAllowlistedJson(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      timeout: 8000
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(upstreamData));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Upstream Gemini request failed.', category: 'UPSTREAM_UNAVAILABLE' }));
  }
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    setSecurityHeaders(res);

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Bad Request URL' }));
      return;
    }

    const clientIp = getClientIp(req);

    // API Endpoints
    if (parsedUrl.pathname === '/api/gemini-proxy') {
      await handleGeminiProxy(req, res, clientIp);
      return;
    }

    if (parsedUrl.pathname === '/api/health') {
      handleHealth(req, res);
      return;
    }

    if (parsedUrl.pathname === '/api/config-status') {
      handleConfigStatus(req, res);
      return;
    }

    if (parsedUrl.pathname === '/api/youtube-search') {
      await handleYoutubeSearch(req, res, parsedUrl, clientIp);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    // 4. Static File Serving with Strict Path Traversal & Dotfile Protection
    let decodedPathname;
    try {
      decodedPathname = decodeURIComponent(parsedUrl.pathname);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    if (decodedPathname.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    if (decodedPathname === '/' || decodedPathname === '') {
      decodedPathname = '/index.html';
    }

    const segments = decodedPathname.split('/').filter(Boolean);
    if (segments.some(seg => seg.startsWith('.') || seg === '..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const resolvedPath = path.resolve(ROOT_DIR, '.' + decodedPathname);
    if (!resolvedPath.startsWith(ROOT_DIR + path.sep) && resolvedPath !== path.join(ROOT_DIR, 'index.html')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = ALLOWED_STATIC_EXTENSIONS[ext];
    if (!contentType) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden file type');
      return;
    }

    fs.stat(resolvedPath, (statErr, stats) => {
      if (statErr || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(resolvedPath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end('500 Internal Server Error');
      });
      stream.pipe(res);
    });
  });
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`\n🚀 urYouTube v3.3.1 Hardened Server listening at http://${HOST}:${PORT}\n`);
  });

  const shutdown = signal => {
    console.log(`\nReceived ${signal}. Shutting down urYouTube server gracefully...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
  createAppServer,
  checkRateLimit,
  rateLimitMap,
  CSP_HEADER_VALUE,
  setSecurityHeaders,
  getClientIp,
  parseRequestBody,
  loadDotEnv,
  fetchAllowlistedJson,
  handleHealth,
  handleConfigStatus,
  handleYoutubeSearch,
  handleGeminiProxy
};
