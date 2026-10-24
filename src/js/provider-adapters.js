/**
 * urYouTube — Provider Adapters & Optional Gemini AI Enrichment Layer
 * ===================================================================
 * Version: 3.3.1
 * License: MIT
 *
 * Separates external content acquisition and optional LLM enrichment from
 * the deterministic core recommendation engine.
 *
 * Unified Provider Inventory:
 * - Official YouTube Data API v3 (2 endpoints: search.list + videos.list)
 * - 7 Public Piped REST API Mirrors
 * - 6 Public Invidious REST API Mirrors
 * - 3 AllOrigins CORS Raw Failover Targets
 * - Optional Local Node.js Server Proxy (/api/youtube-search)
 *
 * Explicit Status & Error Categories:
 * - OK (Valid non-empty video results returned)
 * - EMPTY_RESULTS (Provider responded HTTP 200 with a valid schema but 0 matching videos)
 * - UPSTREAM_UNAVAILABLE (All queried mirrors timed out, failed DNS/CORS, or returned HTTP 5xx)
 * - AUTH_ERROR (HTTP 401/403 invalid API key)
 * - QUOTA_EXCEEDED (HTTP 429 or YouTube quotaExceeded)
 * - TIMEOUT (AbortController deadline exceeded)
 * - NETWORK_ERROR (DNS/socket/CORS failure)
 * - MALFORMED_RESPONSE (Invalid JSON or missing schema fields)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const engine = require('./recommendation-engine.js');
    module.exports = factory(engine);
  } else {
    root.UrYouTubeProviders = factory(root.UrYouTubeEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  const PIPED_INSTANCES = Object.freeze([
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.moomoo.me',
    'https://pipedapi.syncpundit.io',
    'https://api.piped.private.coffee',
    'https://pipedapi.drgns.space',
    'https://pipedapi.ducks.party'
  ]);

  const INVIDIOUS_INSTANCES = Object.freeze([
    'https://inv.tux.pizza',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacyredirect.com',
    'https://vid.puffyan.us',
    'https://yewtu.be',
    'https://inv.nadeko.net'
  ]);

  const CORS_FAILOVER_TARGETS = Object.freeze([
    q => `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=videos`,
    q => `https://inv.nadeko.net/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
    q => `https://invidious.nerdvpn.de/api/v1/search?q=${encodeURIComponent(q)}&type=video`
  ]);

  function categorizeHttpError(status, bodyText = '') {
    if (status === 401) return 'AUTH_ERROR';
    if (status === 403) {
      if (bodyText && bodyText.toLowerCase().includes('quota')) return 'QUOTA_EXCEEDED';
      return 'AUTH_ERROR';
    }
    if (status === 429) return 'QUOTA_EXCEEDED';
    if (status >= 500) return 'UPSTREAM_ERROR';
    return 'HTTP_ERROR';
  }

  async function fetchWithDeadline(url, options = {}, timeoutMs = 4200, fetchImpl = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutErr.category = 'TIMEOUT';
        throw timeoutErr;
      }
      const netErr = new Error(err ? err.message : 'Network error');
      netErr.category = 'NETWORK_ERROR';
      throw netErr;
    }
  }

  /**
   * Adapter 1: Official YouTube Data API v3
   */
  async function fetchOfficialYouTubeSearch({
    query,
    apiKey,
    minDurationMin = 0,
    blockShorts = true,
    categoryLabel = 'Live Discovery',
    topicId = 'custom-live',
    batchOrder = 1,
    fetchImpl = fetch
  }) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { ok: false, statusCategory: 'MISSING_CREDENTIALS', errorCategory: 'MISSING_CREDENTIALS', items: [] };
    }
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { ok: false, statusCategory: 'INVALID_QUERY', errorCategory: 'INVALID_QUERY', items: [] };
    }

    const encodedKey = encodeURIComponent(apiKey.trim());
    const encodedQuery = encodeURIComponent(query.trim().slice(0, 120));
    let durationParam = '';
    if (minDurationMin >= 20) durationParam = '&videoDuration=long';
    else if (minDurationMin >= 4 || blockShorts) durationParam = '&videoDuration=medium';

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodedQuery}${durationParam}&key=${encodedKey}`;

    try {
      const searchResp = await fetchWithDeadline(searchUrl, {}, 5000, fetchImpl);
      if (!searchResp.ok) {
        const errText = await searchResp.text().catch(() => '');
        const cat = categorizeHttpError(searchResp.status, errText);
        return {
          ok: false,
          statusCategory: cat,
          errorCategory: cat,
          status: searchResp.status,
          items: []
        };
      }

      const searchData = await searchResp.json();
      if (!searchData || !Array.isArray(searchData.items)) {
        return { ok: false, statusCategory: 'MALFORMED_RESPONSE', errorCategory: 'MALFORMED_RESPONSE', items: [] };
      }

      const rawItems = searchData.items;
      const videoIds = rawItems
        .map(item => item && item.id && item.id.videoId)
        .filter(id => Engine.isValidYoutubeId(id));

      if (videoIds.length === 0) {
        return { ok: true, statusCategory: 'EMPTY_RESULTS', provider: 'youtube_api_v3', items: [] };
      }

      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${videoIds.join(',')}&key=${encodedKey}`;
      let detailsMap = new Map();
      try {
        const detailsResp = await fetchWithDeadline(detailsUrl, {}, 5000, fetchImpl);
        if (detailsResp.ok) {
          const detailsData = await detailsResp.json();
          if (detailsData && Array.isArray(detailsData.items)) {
            detailsMap = new Map(detailsData.items.map(d => [d.id, d]));
          }
        }
      } catch (e) {
        // Proceed with snippet-level metadata if details call fails
      }

      const normalizedItems = [];
      for (const item of rawItems) {
        const vidId = item && item.id && item.id.videoId;
        if (!Engine.isValidYoutubeId(vidId)) continue;
        const d = detailsMap.get(vidId);
        const title = (d && d.snippet && d.snippet.title) || (item.snippet && item.snippet.title) || 'Untitled Video';
        const channel = (d && d.snippet && d.snippet.channelTitle) || (item.snippet && item.snippet.channelTitle) || 'YouTube Creator';
        const durationSec = d && d.contentDetails ? Engine.parseIsoDuration(d.contentDetails.duration) : null;
        const rawViews = d && d.statistics && d.statistics.viewCount ? parseInt(d.statistics.viewCount, 10) : null;
        const views = Number.isFinite(rawViews) ? rawViews : null;

        const norm = Engine.normalizeVideoRecord({
          id: vidId,
          title,
          channel,
          subscribers: views !== null && views > 1000000 ? '1M+ Reach' : 'Creator',
          views,
          durationSec,
          category: categoryLabel,
          topics: [topicId, 'live-fetched'],
          isLiveFetched: true,
          batchOrder,
          summary: ((d && d.snippet && d.snippet.description) || (item.snippet && item.snippet.description) || '').slice(0, 160)
        });
        if (norm) normalizedItems.push(norm);
      }

      return {
        ok: true,
        statusCategory: normalizedItems.length > 0 ? 'OK' : 'EMPTY_RESULTS',
        provider: 'youtube_api_v3',
        items: normalizedItems
      };
    } catch (err) {
      const cat = err.category || 'NETWORK_ERROR';
      return {
        ok: false,
        statusCategory: cat,
        errorCategory: cat,
        message: err.message,
        items: []
      };
    }
  }

  /**
   * Adapter 2: Piped / Invidious Public JSON Indexers
   */
  function normalizePipedSearchPayload(data, query, categoryLabel, topicId, batchOrder) {
    if (!data || !Array.isArray(data.items)) return null;
    const results = [];
    for (const item of data.items) {
      if (!item || typeof item !== 'object') continue;
      const urlStr = typeof item.url === 'string' ? item.url : '';
      const vidId = urlStr.includes('v=') ? urlStr.split('v=')[1].split('&')[0] : '';
      if (!Engine.isValidYoutubeId(vidId)) continue;

      const durationSec = typeof item.duration === 'number' && item.duration > 0 ? item.duration : null;
      const views = typeof item.views === 'number' && item.views >= 0 ? item.views : null;
      const norm = Engine.normalizeVideoRecord({
        id: vidId,
        title: item.title || 'YouTube Video',
        channel: item.uploaderName || 'YouTube Creator',
        subscribers: item.uploaderVerified ? 'Verified' : 'Creator',
        views,
        durationSec,
        category: categoryLabel,
        topics: [topicId, 'live-fetched'],
        isLiveFetched: true,
        batchOrder,
        summary: item.shortDescription || `Fetched live from YouTube for "${query}".`
      });
      if (norm) results.push(norm);
      if (results.length >= 12) break;
    }
    return results;
  }

  function normalizeInvidiousSearchPayload(data, query, categoryLabel, topicId, batchOrder) {
    if (!Array.isArray(data)) return null;
    const results = [];
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const vidId = typeof item.videoId === 'string' ? item.videoId : '';
      if (!Engine.isValidYoutubeId(vidId)) continue;

      const durationSec = typeof item.lengthSeconds === 'number' && item.lengthSeconds > 0 ? item.lengthSeconds : null;
      const views = typeof item.viewCount === 'number' && item.viewCount >= 0 ? item.viewCount : null;
      const norm = Engine.normalizeVideoRecord({
        id: vidId,
        title: item.title || 'YouTube Video',
        channel: item.author || 'YouTube Creator',
        subscribers: 'Creator',
        views,
        durationSec,
        category: categoryLabel,
        topics: [topicId, 'live-fetched'],
        isLiveFetched: true,
        batchOrder,
        summary: item.description || `Fetched live from YouTube for "${query}".`
      });
      if (norm) results.push(norm);
      if (results.length >= 12) break;
    }
    return results;
  }

  /**
   * Multi-mirror public indexer orchestrator that explicitly distinguishes
   * EMPTY_RESULTS (at least one provider responded HTTP 200 with valid schema but 0 videos)
   * from UPSTREAM_UNAVAILABLE (all mirrors unreachable or returned invalid/error payloads).
   */
  async function fetchPublicMirrorsSearch({
    query,
    categoryLabel = 'Live Discovery',
    topicId = 'custom-live',
    batchOrder = 1,
    fetchImpl = fetch,
    pipedMirrors = PIPED_INSTANCES,
    invidiousMirrors = INVIDIOUS_INSTANCES
  }) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { ok: false, statusCategory: 'INVALID_QUERY', items: [] };
    }
    const cleanQ = query.trim();
    const encodedQ = encodeURIComponent(cleanQ);
    let sawValidEmptyResponse = false;

    for (const base of pipedMirrors) {
      try {
        const res = await fetchWithDeadline(`${base}/search?q=${encodedQ}&filter=videos`, {}, 3800, fetchImpl);
        if (!res.ok) continue;
        const data = await res.json();
        const parsed = normalizePipedSearchPayload(data, cleanQ, categoryLabel, topicId, batchOrder);
        if (parsed === null) continue;
        if (parsed.length > 0) {
          return { ok: true, statusCategory: 'OK', provider: base, items: parsed };
        }
        sawValidEmptyResponse = true;
      } catch (err) {
        // Continue to next mirror
      }
    }

    for (const base of invidiousMirrors) {
      try {
        const res = await fetchWithDeadline(`${base}/api/v1/search?q=${encodedQ}&type=video`, {}, 3800, fetchImpl);
        if (!res.ok) continue;
        const data = await res.json();
        const parsed = normalizeInvidiousSearchPayload(data, cleanQ, categoryLabel, topicId, batchOrder);
        if (parsed === null) continue;
        if (parsed.length > 0) {
          return { ok: true, statusCategory: 'OK', provider: base, items: parsed };
        }
        sawValidEmptyResponse = true;
      } catch (err) {
        // Continue to next mirror
      }
    }

    if (sawValidEmptyResponse) {
      return { ok: true, statusCategory: 'EMPTY_RESULTS', provider: 'public_mirrors', items: [] };
    }
    return {
      ok: false,
      statusCategory: 'UPSTREAM_UNAVAILABLE',
      errorCategory: 'UPSTREAM_UNAVAILABLE',
      items: []
    };
  }

  /**
   * Adapter 3: Optional Gemini AI Enrichment (Strict Schema Validation + Prompt Injection Defense)
   */
  function validateGeminiEnrichmentResponse(rawJsonText) {
    try {
      const parsed = typeof rawJsonText === 'string' ? JSON.parse(rawJsonText) : rawJsonText;
      if (!Array.isArray(parsed)) return { valid: false, items: [] };
      const validated = [];
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || !Engine.isValidYoutubeId(entry.id)) continue;
        validated.push({
          id: entry.id,
          educationalDepth: typeof entry.educationalDepth === 'number'
            ? Math.min(99, Math.max(1, Math.round(entry.educationalDepth)))
            : undefined,
          clickbaitIndex: typeof entry.clickbaitIndex === 'number'
            ? Math.min(99, Math.max(1, Math.round(entry.clickbaitIndex)))
            : undefined,
          indieScore: typeof entry.indieScore === 'number'
            ? Math.min(99, Math.max(1, Math.round(entry.indieScore)))
            : undefined,
          aiReason: typeof entry.aiReason === 'string'
            ? entry.aiReason.replace(/[\x00-\x1F]/g, '').trim().slice(0, 120)
            : undefined
        });
      }
      return { valid: true, items: validated };
    } catch (err) {
      return { valid: false, items: [] };
    }
  }

  return {
    PIPED_INSTANCES,
    INVIDIOUS_INSTANCES,
    CORS_FAILOVER_TARGETS,
    categorizeHttpError,
    fetchWithDeadline,
    fetchOfficialYouTubeSearch,
    normalizePipedSearchPayload,
    normalizeInvidiousSearchPayload,
    fetchPublicMirrorsSearch,
    validateGeminiEnrichmentResponse
  };
});
