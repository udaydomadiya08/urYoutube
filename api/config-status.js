'use strict';

module.exports = (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        serverYoutubeKeyConfigured: Boolean((process.env.YOUTUBE_API_KEY || '').trim()),
        serverGeminiKeyConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
        storageRecommendation: 'Prefer server-side .env keys or session-only storage over persistent localStorage on shared machines.'
      })
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err.message }));
  }
};
