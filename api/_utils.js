'use strict';

const https = require('https');
const { URL } = require('url');

const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024; // 2 MB cap
const MAX_POST_BODY_BYTES = 32 * 1024; // 32 KB cap
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQ = 60;

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

function getClientIp(req) {
  const forwarded = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return (req && req.socket && req.socket.remoteAddress) || '127.0.0.1';
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
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  checkRateLimit,
  rateLimitMap,
  getClientIp,
  fetchAllowlistedJson,
  parseRequestBody,
  ALLOWED_UPSTREAM_SEARCH_BUILDERS,
  MAX_POST_BODY_BYTES
};
