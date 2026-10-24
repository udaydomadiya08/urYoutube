'use strict';

const {
  checkRateLimit,
  getClientIp,
  fetchAllowlistedJson,
  ALLOWED_UPSTREAM_SEARCH_BUILDERS
} = require('./_utils.js');
const { URL } = require('url');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    const clientIp = getClientIp(req);
    const rl = checkRateLimit(clientIp);
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in 60 seconds.', category: 'QUOTA_EXCEEDED' }));
      return;
    }

    let parsedUrl;
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] || 'https';
      parsedUrl = new URL(req.url || '/', `${proto}://${host}`);
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Invalid URL' }));
      return;
    }

    if (parsedUrl.searchParams.has('url') || parsedUrl.searchParams.has('target') || parsedUrl.searchParams.has('host')) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Custom upstream URLs are forbidden (SSRF protection).' }));
      return;
    }

    const rawQ = (parsedUrl.searchParams.get('q') || '').trim();
    if (!rawQ || rawQ.length > 140) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Query parameter "q" must be 1..140 characters.' }));
      return;
    }

    const searchDeadline = Date.now() + 3500;
    const serverYtKey = (process.env.YOUTUBE_API_KEY || '').trim();
    if (serverYtKey) {
      try {
        const ytSearchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(rawQ)}&key=${encodeURIComponent(serverYtKey)}`;
        const officialBudget = Math.max(1, Math.min(1800, searchDeadline - Date.now()));
        const searchData = await fetchAllowlistedJson(ytSearchUrl, { timeout: officialBudget });
        if (searchData && Array.isArray(searchData.items)) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ source: 'server_youtube_api_v3', items: searchData.items }));
          return;
        }
      } catch (err) {
        // Fallback to mirrors
      }
    }

    for (const buildUrl of ALLOWED_UPSTREAM_SEARCH_BUILDERS) {
      const remainingBudget = searchDeadline - Date.now();
      if (remainingBudget <= 0) break;
      try {
        const data = await fetchAllowlistedJson(buildUrl(rawQ), { timeout: Math.min(1500, remainingBudget) });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
        return;
      } catch (err) {
        // Try next mirror
      }
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'Public YouTube mirrors are currently unreachable from this network.',
        category: 'UPSTREAM_UNAVAILABLE'
      })
    );
  } catch (outerErr) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: outerErr.message }));
  }
};
