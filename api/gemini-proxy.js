'use strict';

const {
  checkRateLimit,
  getClientIp,
  fetchAllowlistedJson,
  parseRequestBody,
  MAX_POST_BODY_BYTES
} = require('./_utils.js');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Method Not Allowed (use POST)' }));
      return;
    }

    const clientIp = getClientIp(req);
    const rl = checkRateLimit(clientIp);
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Rate limit exceeded.', category: 'QUOTA_EXCEEDED' }));
      return;
    }

    const serverGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!serverGeminiKey) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: msg }));
      return;
    }

    const promptText = typeof parsedBody.prompt === 'string' ? parsedBody.prompt.trim().slice(0, 8000) : '';
    if (!promptText) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(upstreamData));
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Upstream Gemini request failed.', category: 'UPSTREAM_UNAVAILABLE' }));
    }
  } catch (outerErr) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: outerErr.message }));
  }
};
