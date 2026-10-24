/**
 * urYouTube — Modular Multi-Algorithm Recommendation & IR Engine
 * ==============================================================
 * Version: 3.3.1
 * License: MIT
 *
 * Open-Source Architectural Lineage & Attribution:
 * - Content-Based BM25/TF-IDF, Item-to-Item Cosine Similarity, Maximal Marginal
 *   Relevance (MMR), and Beyond-Accuracy IR Evaluation Metrics (Precision@K, Recall@K,
 *   NDCG@K, Intra-List Diversity ILD@K, Catalog Coverage, Self-Information Novelty)
 *   informed by `recommenders-team/recommenders` (MIT License).
 * - Hybrid Feature-Interaction Embedding & Co-Occurrence Model (`scoreHybridCollaborative`)
 *   inspired by Maciej Kula's LightFM (`lyst/lightfm`, RecSys 2015, Apache-2.0 reference),
 *   implemented from scratch in zero-dependency JavaScript so cold-start items and user
 *   interaction histories share a unified feature representation.
 * - Profile-to-Query Expansion and Timeless/Niche Craft discovery signals informed by
 *   `bjsi/open-recommender`, implemented locally without external scraping dependencies.
 *
 * Core User-Control Guarantees:
 * 1. Modular Algorithm Selection: Users can independently enable/disable 7 algorithms
 *    (`contentBased`, `keywordTopic`, `videoSimilarity`, `weightedScoring`,
 *    `noveltyExploration`, `diversityReranking`, `collaborativeFiltering`).
 * 2. Full Objective Control: Users control Relevance, Depth, Anti-Clickbait, Indie Scale,
 *    Duration, Novelty, Diversity, Recency (default 0), Popularity (default 0, settable
 *    to negative/zero/positive), Creator Boost/Block rules, and Keyword Inclusions/Exclusions.
 * 3. Truthful Explainability: Every displayed explanation badge and breakdown component
 *    reflects exact mathematical contributions with zero hidden developer boosts.
 * 4. Preference Ownership & Stateless Mode: Users can disable automatic personalization
 *    (`enablePersonalization: false`) and inspect, export, reset, or wipe all local state.
 * 5. Reproducibility: Identical candidate sets, configurations, and `explorationSeed`
 *    values produce bit-for-bit identical rankings.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UrYouTubeEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENGINE_VERSION = '3.3.1';

  const DEFAULT_WEIGHTS = Object.freeze({
    relevance: 80,
    depth: 90,
    antiClickbait: 92,
    indie: 65,
    longForm: 80,
    novelty: 65,
    recency: 0,
    popularity: 0,
    minDurationMin: 2,
    maxDurationMin: 0,
    diversityWeight: 20,
    mmrStrength: 32,
    maxPerCreator: 2,
    baseScore: 18,
    topicBoost: 22,
    creatorBoost: 18,
    keywordBoost: 15,
    liveFreshnessBoost: 8,
    blockShorts: true,
    hideOutrage: true
  });

  const DEFAULT_ALGORITHMS = Object.freeze({
    contentBased: true,
    keywordTopic: true,
    videoSimilarity: true,
    weightedScoring: true,
    noveltyExploration: true,
    diversityReranking: true,
    collaborativeFiltering: true
  });

  // ---------------------------------------------------------------------------
  // 1. SECURITY, URL PARSING & DETERMINISTIC SEEDED PRNG UTILITIES
  // ---------------------------------------------------------------------------
  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`/]/g, ch => HTML_ESCAPE_MAP[ch]);
  }

  function isValidYoutubeId(id) {
    if (typeof id !== 'string') return false;
    return /^[A-Za-z0-9_-]{11}$/.test(id);
  }

  /**
   * Extracts a valid 11-character YouTube video ID from a watch URL, short URL,
   * embed URL, shorts URL, or raw 11-character ID string. Returns null if invalid.
   */
  function extractYoutubeVideoId(rawInput) {
    if (typeof rawInput !== 'string') return null;
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    if (isValidYoutubeId(trimmed)) return trimmed;

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        const host = parsed.hostname.toLowerCase();
        if (host === 'youtu.be' || host === 'www.youtu.be') {
          const seg = parsed.pathname.split('/').filter(Boolean)[0] || '';
          return isValidYoutubeId(seg) ? seg : null;
        }
        if (
          host === 'youtube.com' ||
          host === 'www.youtube.com' ||
          host === 'm.youtube.com' ||
          host === 'youtube-nocookie.com' ||
          host === 'www.youtube-nocookie.com'
        ) {
          const vParam = parsed.searchParams.get('v');
          if (vParam && isValidYoutubeId(vParam)) return vParam;
          const parts = parsed.pathname.split('/').filter(Boolean);
          if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
            return isValidYoutubeId(parts[1]) ? parts[1] : null;
          }
        }
        return null;
      } catch (err) {
        return null;
      }
    }

    const match = trimmed.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})(?:[?&/#]|$)/);
    if (match && isValidYoutubeId(match[1])) {
      return match[1];
    }
    return null;
  }

  function sanitizeExternalUrl(rawUrl, fallback = 'https://www.youtube.com') {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return fallback;
    const trimmed = rawUrl.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return fallback;
      }
      return parsed.href;
    } catch (err) {
      return fallback;
    }
  }

  function sanitizeUntrustedTextForPrompt(rawText, maxLen = 180) {
    if (typeof rawText !== 'string') return '';
    return rawText
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/```/g, '')
      .replace(/\b(ignore previous instructions|system prompt|you are now|disregard all)\b/gi, '[filtered]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  /**
   * Mulberry32 deterministic PRNG hashed with video ID and integer seed.
   * Returns a reproducible float in [-1, 1] when seed > 0, or 0 when seed === 0.
   */
  function computeSeededExplorationJitter(videoId, seed = 0) {
    const s = Math.max(0, Math.floor(Number(seed) || 0));
    if (s === 0) return 0;
    let h = (s ^ 0x9E3779B9) >>> 0;
    const str = String(videoId || '');
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x85EBCA6B) >>> 0;
      h = ((h << 13) | (h >>> 19)) >>> 0;
    }
    let t = (h + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Number(((unit * 2 - 1) * 3.5).toFixed(3));
  }

  // ---------------------------------------------------------------------------
  // 2. DURATION & METADATA NORMALIZATION
  // ---------------------------------------------------------------------------
  function formatDurationSec(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      return 'Unknown';
    }
    const s = Math.round(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function parseIsoDuration(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    if (iso === 'P0D') return 0;
    const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!m) return null;
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const sec = parseInt(m[3] || '0', 10);
    const total = h * 3600 + min * 60 + sec;
    return total > 0 ? total : null;
  }

  function inferSignalsFromMetadata(rawVideo) {
    const title = typeof rawVideo.title === 'string' ? rawVideo.title.trim() : '';
    const hasTitle = title.length > 0;
    const hasDuration = typeof rawVideo.durationSec === 'number' && Number.isFinite(rawVideo.durationSec) && rawVideo.durationSec > 0;
    const hasViews = typeof rawVideo.views === 'number' && Number.isFinite(rawVideo.views) && rawVideo.views >= 0;
    const hasChannel = typeof rawVideo.channel === 'string' && rawVideo.channel.trim().length > 0;
    const hasSummary = typeof rawVideo.summary === 'string' && rawVideo.summary.trim().length > 10;

    let confidencePoints = 0;
    if (hasTitle) confidencePoints += 0.30;
    if (hasDuration) confidencePoints += 0.25;
    if (hasViews) confidencePoints += 0.20;
    if (hasChannel) confidencePoints += 0.15;
    if (hasSummary) confidencePoints += 0.10;
    const metadataConfidence = Number(confidencePoints.toFixed(2));

    const durationSec = hasDuration ? rawVideo.durationSec : null;
    const views = hasViews ? rawVideo.views : null;

    const upperCount = (title.match(/[A-Z]/g) || []).length;
    const alphaCount = Math.max(1, (title.match(/[A-Za-z]/g) || []).length);
    const capsRatio = upperCount / alphaCount;
    const hasShockPunct = /[!?]{2,}|🤯|😱|🚨|🤣|🔥/.test(title);
    const hasClickbaitWords = /\b(prank|shocked|gone wrong|gone bad|insane|you won't believe|exposed|drama|blush|overnight|secret)\b/i.test(title);

    let clickbaitIndex = 12;
    if (capsRatio > 0.45 && alphaCount >= 6) clickbaitIndex += 35;
    if (hasShockPunct) clickbaitIndex += 28;
    if (hasClickbaitWords) clickbaitIndex += 34;
    if (durationSec !== null && durationSec > 0 && durationSec < 60) clickbaitIndex += 18;
    clickbaitIndex = Math.min(98, Math.max(2, clickbaitIndex));

    const combinedText = `${title} ${rawVideo.summary || ''}`;
    const hasDepthWords = /\b(lecture|explained|tutorial|course|architecture|system design|quantum|engineering|documentary|history|philosophy|neuroscience|algorithm|analysis|deep dive|essay|fundamentals|theory|programming|calculus|physics|compiler|distributed|kernel)\b/i.test(combinedText);
    let educationalDepth = 60;
    if (hasDepthWords) educationalDepth += 24;
    if (durationSec !== null && durationSec >= 900) educationalDepth += 10;
    if (clickbaitIndex >= 65) educationalDepth -= 38;
    educationalDepth = Math.min(99, Math.max(5, educationalDepth));

    let indieScore = 65;
    let indieUnknown = false;
    if (views === null) {
      indieUnknown = true;
    } else if (views > 10000000) {
      indieScore = 22;
    } else if (views > 2000000) {
      indieScore = 45;
    } else if (views > 500000) {
      indieScore = 72;
    } else {
      indieScore = 92;
    }

    const noveltyScore = Math.min(96, Math.max(25, Math.round(educationalDepth * 0.58 + indieScore * 0.36)));
    const hypeIndex = Math.min(99, Math.max(5, Math.round(clickbaitIndex * 0.78 + (views !== null && views > 5000000 ? 22 : 4))));

    // Popularity index in [0..100] derived logarithmically from observed view count
    const popularityIndex = views !== null && views > 0
      ? clamp(Math.round((Math.log10(Math.max(10, views)) / 9) * 100), 1, 100)
      : 50;

    // Recency score in [0..100] from publishedAgeDays if provided, or neutral 50
    const ageDays = typeof rawVideo.publishedAgeDays === 'number' && rawVideo.publishedAgeDays >= 0
      ? rawVideo.publishedAgeDays
      : null;
    const recencyScore = ageDays !== null
      ? clamp(Math.round(100 * Math.exp(-ageDays / 180)), 5, 100)
      : (rawVideo.isLiveFetched ? 85 : 50);

    return {
      educationalDepth: typeof rawVideo.educationalDepth === 'number' ? rawVideo.educationalDepth : educationalDepth,
      clickbaitIndex: typeof rawVideo.clickbaitIndex === 'number' ? rawVideo.clickbaitIndex : clickbaitIndex,
      indieScore: typeof rawVideo.indieScore === 'number' ? rawVideo.indieScore : indieScore,
      noveltyScore: typeof rawVideo.noveltyScore === 'number' ? rawVideo.noveltyScore : noveltyScore,
      hypeIndex: typeof rawVideo.hypeIndex === 'number' ? rawVideo.hypeIndex : hypeIndex,
      popularityIndex: typeof rawVideo.popularityIndex === 'number' ? rawVideo.popularityIndex : popularityIndex,
      recencyScore: typeof rawVideo.recencyScore === 'number' ? rawVideo.recencyScore : recencyScore,
      metadataConfidence,
      signalOrigin: rawVideo.aiScored ? 'gemini_ai_verified' : 'heuristic_estimate',
      missingSignals: [
        ...(!hasDuration ? ['duration'] : []),
        ...(!hasViews ? ['views'] : []),
        ...(indieUnknown ? ['creatorReach'] : [])
      ]
    };
  }

  function normalizeVideoRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
    const id = isValidYoutubeId(rawId) ? rawId : extractYoutubeVideoId(rawId);
    if (!id) return null;

    const durationSec = typeof raw.durationSec === 'number' && Number.isFinite(raw.durationSec) && raw.durationSec > 0
      ? Math.round(raw.durationSec)
      : null;
    const views = typeof raw.views === 'number' && Number.isFinite(raw.views) && raw.views >= 0
      ? Math.round(raw.views)
      : null;

    const inferred = inferSignalsFromMetadata({ ...raw, durationSec, views });
    const dataOrigin = raw.dataOrigin || (raw.isSampleData ? 'sample_demo' : raw.isUserAdded ? 'user_added' : raw.isLiveFetched ? 'live_provider' : 'local_catalog');

    return {
      id,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled Video',
      channel: typeof raw.channel === 'string' && raw.channel.trim() ? raw.channel.trim() : 'Unknown Creator',
      subscribers: typeof raw.subscribers === 'string' && raw.subscribers.trim() ? raw.subscribers.trim() : 'Unknown',
      views,
      durationSec,
      durationText: durationSec !== null ? formatDurationSec(durationSec) : 'Unknown',
      category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : 'General',
      topics: Array.isArray(raw.topics) ? raw.topics.filter(t => typeof t === 'string') : [],
      summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
      educationalDepth: clamp(inferred.educationalDepth, 1, 99),
      clickbaitIndex: clamp(inferred.clickbaitIndex, 1, 99),
      indieScore: clamp(inferred.indieScore, 1, 99),
      noveltyScore: clamp(inferred.noveltyScore, 1, 99),
      hypeIndex: clamp(inferred.hypeIndex, 1, 99),
      popularityIndex: clamp(inferred.popularityIndex, 1, 100),
      recencyScore: clamp(inferred.recencyScore, 1, 100),
      metadataConfidence: inferred.metadataConfidence,
      signalOrigin: inferred.signalOrigin,
      missingSignals: inferred.missingSignals,
      isLiveFetched: Boolean(raw.isLiveFetched),
      isSampleData: Boolean(raw.isSampleData),
      isUserAdded: Boolean(raw.isUserAdded),
      dataOrigin,
      aiScored: Boolean(raw.aiScored),
      aiReason: typeof raw.aiReason === 'string' ? raw.aiReason.trim().slice(0, 140) : '',
      batchOrder: typeof raw.batchOrder === 'number' ? raw.batchOrder : 0
    };
  }

  /**
   * Creates a normalized local video record from a user-supplied YouTube URL or 11-char ID.
   */
  function createManualVideoRecord(input = {}) {
    const extractedId = extractYoutubeVideoId(input.urlOrId || input.id || '');
    if (!extractedId) {
      return { valid: false, error: 'Please enter a valid YouTube URL (watch?v=..., youtu.be/...) or 11-character Video ID.' };
    }
    const durationMin = Number(input.durationMin);
    const durationSec = Number.isFinite(durationMin) && durationMin > 0
      ? Math.round(durationMin * 60)
      : (typeof input.durationSec === 'number' && input.durationSec > 0 ? Math.round(input.durationSec) : null);
    const topicId = typeof input.topicId === 'string' && input.topicId.trim() ? input.topicId.trim() : 'custom-local';
    const record = normalizeVideoRecord({
      id: extractedId,
      title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 140) : `User Added Video (${extractedId})`,
      channel: typeof input.channel === 'string' && input.channel.trim() ? input.channel.trim().slice(0, 80) : 'User Added Creator',
      subscribers: 'Local Entry',
      views: typeof input.views === 'number' && input.views >= 0 ? input.views : null,
      durationSec,
      category: typeof input.category === 'string' && input.category.trim() ? input.category.trim().slice(0, 50) : 'User Added',
      topics: [topicId, 'user-added'],
      summary: typeof input.summary === 'string' && input.summary.trim()
        ? input.summary.trim().slice(0, 200)
        : 'Manually added by user via local URL/ID entry.',
      isUserAdded: true,
      isSampleData: false,
      isLiveFetched: false,
      dataOrigin: 'user_added'
    });
    return { valid: Boolean(record), video: record };
  }

  function clamp(num, min, max) {
    const n = Number(num);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // ---------------------------------------------------------------------------
  // 3. MODULAR RECOMMENDATION ALGORITHMS (BM25/TF-IDF, Item Similarity, LightFM Hybrid)
  // ---------------------------------------------------------------------------
  function tokenizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  function tokenizeTitle(title) {
    return new Set(tokenizeText(title));
  }

  function fastSetJaccard(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const tok of smaller) {
      if (larger.has(tok)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Algorithm A: Content-Based BM25 / TF-IDF Lexical & Topic Similarity
   * Computes saturation-weighted term matching between a candidate video's text
   * fields and the user's query / prompt / boosted topic terms.
   */
  function scoreContentBasedBM25(video, queryText = '', relevanceWeight = 80) {
    const qTokens = tokenizeText(queryText);
    if (qTokens.length === 0 || relevanceWeight <= 0) return 0;

    const docTokens = tokenizeText(`${video.title || ''} ${video.category || ''} ${video.summary || ''} ${(video.topics || []).join(' ')}`);
    if (docTokens.length === 0) return 0;

    const freqMap = new Map();
    for (const tok of docTokens) {
      freqMap.set(tok, (freqMap.get(tok) || 0) + 1);
    }

    const k1 = 1.5;
    const b = 0.75;
    const avgDl = 24;
    const dl = docTokens.length;
    let rawBm25 = 0;
    const uniqueQ = Array.from(new Set(qTokens));

    for (const qt of uniqueQ) {
      let tf = freqMap.get(qt) || 0;
      if (tf === 0) {
        // Prefix match support for stem-like overlap (e.g., "neuro" -> "neuroscience")
        for (const [dt, count] of freqMap.entries()) {
          if (dt.startsWith(qt) || qt.startsWith(dt)) {
            tf += count * 0.6;
          }
        }
      }
      if (tf > 0) {
        const num = tf * (k1 + 1);
        const den = tf + k1 * (1 - b + b * (dl / avgDl));
        rawBm25 += num / den;
      }
    }

    const normalized = Math.min(1, rawBm25 / Math.max(1.5, uniqueQ.length * 1.1));
    return Number((normalized * 16 * (clamp(relevanceWeight, 0, 100) / 100)).toFixed(2));
  }

  /**
   * Algorithm B: Item-to-Item Video Similarity (Hybrid Token + Topic + Feature Cosine)
   * Computes similarity between a candidate video and user's anchor/reference/saved videos.
   */
  function scoreItemSimilarity(video, anchorVideos = []) {
    if (!Array.isArray(anchorVideos) || anchorVideos.length === 0) return 0;
    const candTokens = tokenizeTitle(`${video.title || ''} ${video.category || ''}`);
    const candTopics = new Set(Array.isArray(video.topics) ? video.topics : []);

    let maxSim = 0;
    for (const anchor of anchorVideos) {
      if (!anchor || anchor.id === video.id) continue;
      const ancTokens = tokenizeTitle(`${anchor.title || ''} ${anchor.category || ''}`);
      const tokenSim = fastSetJaccard(candTokens, ancTokens);

      let topicSim = 0;
      if (Array.isArray(anchor.topics) && anchor.topics.length > 0 && candTopics.size > 0) {
        let shared = 0;
        for (const t of anchor.topics) {
          if (candTopics.has(t)) shared++;
        }
        topicSim = shared / Math.max(candTopics.size, anchor.topics.length);
      }

      const sameChannel = (anchor.channel || '').toLowerCase() === (video.channel || '').toLowerCase() ? 0.25 : 0;
      const combined = Math.min(1, tokenSim * 0.45 + topicSim * 0.40 + sameChannel);
      if (combined > maxSim) maxSim = combined;
    }

    return Number((maxSim * 12).toFixed(2));
  }

  /**
   * Algorithm C: LightFM-Inspired Hybrid Collaborative / Feature-Interaction Affinity
   * Represents user interaction history (saved/watched/liked videos + positive ratings)
   * as latent feature embeddings over topics, creators, depth tiers, and duration tiers,
   * and computes inner-product affinity with candidate item features.
   * Strictly returns 0 when personalization is disabled or interaction history is empty.
   */
  function scoreHybridCollaborative(video, interactionVideos = [], enablePersonalization = true) {
    if (!enablePersonalization || !Array.isArray(interactionVideos) || interactionVideos.length === 0) {
      return 0;
    }

    const topicAffinity = new Map();
    const channelAffinity = new Map();
    let avgPreferredDepth = 0;
    let avgPreferredDuration = 0;
    let validCount = 0;

    for (const item of interactionVideos) {
      if (!item || item.id === video.id) continue;
      validCount++;
      const weight = typeof item.rating === 'number' ? item.rating : 1.0;
      for (const t of (item.topics || [])) {
        if (t === 'live-fetched' || t === 'user-added') continue;
        topicAffinity.set(t, (topicAffinity.get(t) || 0) + weight);
      }
      if (item.channel) {
        const ch = item.channel.toLowerCase();
        channelAffinity.set(ch, (channelAffinity.get(ch) || 0) + weight);
      }
      avgPreferredDepth += (item.educationalDepth || 70);
      avgPreferredDuration += (item.durationSec || 900);
    }

    if (validCount === 0) return 0;
    avgPreferredDepth /= validCount;
    avgPreferredDuration /= validCount;

    let featureDotProduct = 0;
    for (const t of (video.topics || [])) {
      if (topicAffinity.has(t)) {
        featureDotProduct += Math.min(1.5, topicAffinity.get(t) / validCount) * 4.5;
      }
    }
    const chKey = (video.channel || '').toLowerCase();
    if (channelAffinity.has(chKey)) {
      featureDotProduct += Math.min(1.2, channelAffinity.get(chKey) / validCount) * 3.5;
    }

    // Latent depth & duration alignment term
    const depthDiff = Math.abs((video.educationalDepth || 60) - avgPreferredDepth) / 100;
    const durDiff = Math.min(1, Math.abs((video.durationSec || 600) - avgPreferredDuration) / 3600);
    const profileAlignment = Math.max(0, 1 - (depthDiff * 0.6 + durDiff * 0.4)) * 2.5;

    return Number(Math.min(12, featureDotProduct + profileAlignment).toFixed(2));
  }

  // ---------------------------------------------------------------------------
  // 4. AUTHORITATIVE DETERMINISTIC SCORING & EXPLANATION PIPELINE
  // ---------------------------------------------------------------------------
  function evaluateVideo(rawVideo, config = {}) {
    const video = rawVideo && rawVideo.metadataConfidence !== undefined
      ? rawVideo
      : normalizeVideoRecord(rawVideo) || rawVideo;

    const w = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
    const algos = { ...DEFAULT_ALGORITHMS, ...(config.algorithms || {}) };
    const topicPrefs = config.topicPrefs || {};
    const creatorPrefs = config.creatorPrefs || {};
    const includeKeywords = Array.isArray(config.includeKeywords)
      ? config.includeKeywords.map(k => String(k || '').toLowerCase().trim()).filter(Boolean)
      : [];
    const excludeKeywords = Array.isArray(config.excludeKeywords)
      ? config.excludeKeywords.map(k => String(k || '').toLowerCase().trim()).filter(Boolean)
      : [];
    const enablePersonalization = config.enablePersonalization !== false;
    const explorationSeed = Number(config.explorationSeed) || 0;

    const manualOverrides = config.manualOverrides instanceof Set
      ? config.manualOverrides
      : new Set(Array.isArray(config.manualOverrides) ? config.manualOverrides : []);
    const activePreset = config.activePreset || 'custom';

    const topics = Array.isArray(video.topics) ? video.topics : [];
    const hasBlockedTopic = algos.keywordTopic && topics.some(t => topicPrefs[t] === -1);
    const hasBoostedTopic = algos.keywordTopic && topics.some(t => topicPrefs[t] === 1);

    const channelLower = String(video.channel || '').toLowerCase().trim();
    const creatorPrefVal = algos.keywordTopic && channelLower ? (creatorPrefs[channelLower] || 0) : 0;
    const hasBlockedCreator = creatorPrefVal === -1;
    const hasBoostedCreator = creatorPrefVal === 1;

    const fullTextLower = `${video.title || ''} ${video.channel || ''} ${video.summary || ''} ${video.category || ''}`.toLowerCase();
    const matchedExcludeKeyword = algos.keywordTopic
      ? excludeKeywords.find(kw => fullTextLower.includes(kw))
      : null;
    const matchedIncludeKeyword = algos.keywordTopic
      ? includeKeywords.find(kw => fullTextLower.includes(kw))
      : null;

    let blockedReason = null;
    const durationKnown = typeof video.durationSec === 'number' && Number.isFinite(video.durationSec) && video.durationSec > 0;
    const viewsKnown = typeof video.views === 'number' && Number.isFinite(video.views) && video.views >= 0;

    if (!manualOverrides.has(video.id)) {
      if (hasBlockedCreator) {
        blockedReason = `Blocked creator rule (${video.channel || 'Creator'})`;
      } else if (matchedExcludeKeyword) {
        blockedReason = `Excluded keyword rule ("${matchedExcludeKeyword}")`;
      } else if (hasBlockedTopic) {
        blockedReason = `Blocked topic rule (${video.category || 'Topic'})`;
      } else if (w.blockShorts && durationKnown && video.durationSec < 90) {
        blockedReason = 'Short clip (<90s) blocked by Shorts Guard';
      } else if (w.minDurationMin > 0 && durationKnown && video.durationSec < w.minDurationMin * 60) {
        blockedReason = `Shorter than your ${w.minDurationMin}m minimum duration rule`;
      } else if (w.maxDurationMin > 0 && durationKnown && video.durationSec > w.maxDurationMin * 60) {
        blockedReason = `Longer than your ${w.maxDurationMin}m maximum duration rule`;
      } else if (w.hideOutrage && video.clickbaitIndex >= 65) {
        blockedReason = `High Clickbait/Rage-bait risk (${video.clickbaitIndex}%) blocked`;
      }
    }

    // 1. Weighted Multi-Objective Scoring Contributions (0 when weightedScoring is disabled)
    const weightedActive = Boolean(algos.weightedScoring);
    const depthContrib = weightedActive
      ? (video.educationalDepth * (clamp(w.depth, 0, 100) / 100)) * 0.36
      : 0;
    const indieContrib = weightedActive
      ? (video.indieScore * (clamp(w.indie, 0, 100) / 100)) * 0.22
      : 0;
    const longFormNorm = durationKnown
      ? Math.min(100, Math.round((video.durationSec / 1800) * 100))
      : 40;
    const longFormContrib = weightedActive
      ? (longFormNorm * (clamp(w.longForm, 0, 100) / 100)) * 0.18
      : 0;

    // 2. Novelty & Seeded Exploration Contribution (0 when noveltyExploration is disabled)
    const noveltyContrib = algos.noveltyExploration
      ? (video.noveltyScore * (clamp(w.novelty, 0, 100) / 100)) * 0.16
      : 0;
    const explorationJitter = algos.noveltyExploration
      ? computeSeededExplorationJitter(video.id, explorationSeed)
      : 0;

    // 3. Popularity & Recency Optional Objectives (default 0 -> zero influence!)
    const popWeight = clamp(w.popularity ?? 0, -100, 100);
    const popNorm = video.popularityIndex ?? 50;
    const popularityContrib = weightedActive && popWeight !== 0
      ? (popNorm * (popWeight / 100)) * 0.14
      : 0;

    const recWeight = clamp(w.recency ?? 0, 0, 100);
    const recNorm = video.recencyScore ?? 50;
    const recencyContrib = weightedActive && recWeight > 0
      ? (recNorm * (recWeight / 100)) * 0.12
      : 0;

    // 4. Clickbait Penalty / Corporate Retention Simulation
    let clickbaitEffect = 0;
    if (activePreset === 'corporate_trap') {
      clickbaitEffect = (video.hypeIndex || 50) * 0.55;
    } else if (weightedActive) {
      clickbaitEffect = -1 * (video.clickbaitIndex * (clamp(w.antiClickbait, 0, 100) / 100)) * 0.45;
    }

    // 5. Keyword & Topic Matching + Creator Rules
    const topicBoost = clamp(w.topicBoost ?? DEFAULT_WEIGHTS.topicBoost, 0, 50);
    const creatorBoost = clamp(w.creatorBoost ?? DEFAULT_WEIGHTS.creatorBoost, 0, 50);
    const keywordBoost = clamp(w.keywordBoost ?? DEFAULT_WEIGHTS.keywordBoost, 0, 50);
    const liveFreshnessBoost = clamp(w.liveFreshnessBoost ?? DEFAULT_WEIGHTS.liveFreshnessBoost, 0, 30);
    const baseScore = clamp(w.baseScore ?? DEFAULT_WEIGHTS.baseScore, 0, 50);
    const topicMatchDelta = algos.keywordTopic
      ? (hasBoostedTopic ? topicBoost : 0) + (hasBlockedTopic ? -40 : 0)
      : 0;
    const creatorMatchDelta = algos.keywordTopic
      ? (hasBoostedCreator ? creatorBoost : 0) + (hasBlockedCreator ? -50 : 0)
      : 0;
    const keywordMatchDelta = algos.keywordTopic && matchedIncludeKeyword ? keywordBoost : 0;
    const liveFreshnessDelta = (config.prioritizeLiveVideos === true && video.isLiveFetched) ? liveFreshnessBoost : 0;
    const topicBonus = topicMatchDelta + creatorMatchDelta + keywordMatchDelta + liveFreshnessDelta;

    // 6. Content-Based BM25 / TF-IDF Contribution
    const queryContext = config.queryText || config.activePromptText || '';
    const contentBm25Contrib = algos.contentBased && queryContext
      ? scoreContentBasedBM25(video, queryContext, w.relevance ?? 80)
      : 0;

    // 7. Item-to-Item Video Similarity & LightFM-Inspired Collaborative Affinity
    const interactionVideos = Array.isArray(config.interactionVideos) ? config.interactionVideos : [];
    const similarityContrib = algos.videoSimilarity && enablePersonalization
      ? scoreItemSimilarity(video, interactionVideos)
      : 0;
    const collaborativeContrib = algos.collaborativeFiltering && enablePersonalization
      ? scoreHybridCollaborative(video, interactionVideos, enablePersonalization)
      : 0;

    const roundedDepth = Math.round(depthContrib);
    const roundedIndie = Math.round(indieContrib);
    const roundedLongForm = Math.round(longFormContrib);
    const roundedNovelty = Math.round(noveltyContrib);
    const roundedClickbait = Math.round(clickbaitEffect);
    const roundedPopularity = Math.round(popularityContrib);
    const roundedRecency = Math.round(recencyContrib);
    const roundedBm25 = Math.round(contentBm25Contrib);
    const roundedSimilarity = Math.round(similarityContrib);
    const roundedCollab = Math.round(collaborativeContrib);
    const roundedJitter = Math.round(explorationJitter);

    const rawScore =
      baseScore +
      depthContrib +
      indieContrib +
      longFormContrib +
      noveltyContrib +
      popularityContrib +
      recencyContrib +
      clickbaitEffect +
      topicBonus +
      contentBm25Contrib +
      similarityContrib +
      collaborativeContrib +
      explorationJitter;
    const finalScore = clamp(Math.round(rawScore), 1, 99);

    // Every numeric badge in `reasons` is derived directly from the rounded breakdown components
    const reasons = [];
    if (video.aiScored) reasons.push('✨ AI Verified');
    else if (video.isLiveFetched) reasons.push('⚡ Live Fetched');
    else if (video.isUserAdded) reasons.push('📌 User Added');
    else if (video.isSampleData) reasons.push('📦 Sample Demo');

    if (roundedDepth >= 18) {
      reasons.push(`+${roundedDepth} Depth (${video.aiScored ? 'AI' : 'Est.'})`);
    }
    if (roundedIndie >= 11) {
      reasons.push(`+${roundedIndie} Indie (${viewsKnown ? 'Est.' : 'Prior'})`);
    }
    if (roundedLongForm >= 9 && durationKnown) {
      reasons.push(`+${roundedLongForm} Long-Form`);
    }
    if (hasBoostedTopic) {
      reasons.push(`+${topicBoost} Topic Boost`);
    }
    if (hasBoostedCreator) {
      reasons.push(`+${creatorBoost} Creator Boost`);
    }
    if (keywordMatchDelta > 0) {
      reasons.push(`+${keywordMatchDelta} Keyword Match`);
    }
    if (roundedBm25 >= 4) {
      reasons.push(`+${roundedBm25} BM25 Relevance`);
    }
    if (roundedSimilarity >= 3) {
      reasons.push(`+${roundedSimilarity} Video Similarity`);
    }
    if (roundedCollab >= 3) {
      reasons.push(`+${roundedCollab} Collab Affinity`);
    }
    if (roundedPopularity !== 0) {
      reasons.push(`${roundedPopularity > 0 ? '+' : ''}${roundedPopularity} Popularity`);
    }
    if (roundedRecency >= 3) {
      reasons.push(`+${roundedRecency} Recency`);
    }
    if (roundedClickbait <= -10) {
      reasons.push(`${roundedClickbait} Clickbait Penalty`);
    }
    if (activePreset === 'corporate_trap' && (video.hypeIndex || 0) > 70) {
      reasons.push(`+${roundedClickbait} Viral Retention Trap`);
    }
    if (!durationKnown) {
      reasons.push('Duration Unknown');
    }

    return {
      video,
      score: finalScore,
      isBlocked: Boolean(blockedReason),
      blockedReason,
      breakdown: {
        baseConstant: Math.round(baseScore),
        depthContrib: roundedDepth,
        indieContrib: roundedIndie,
        longFormContrib: roundedLongForm,
        noveltyContrib: roundedNovelty,
        popularityContrib: roundedPopularity,
        recencyContrib: roundedRecency,
        clickbaitEffect: roundedClickbait,
        topicMatchDelta,
        creatorMatchDelta,
        keywordMatchDelta,
        liveFreshnessDelta,
        topicBonus,
        contentBm25Contrib: roundedBm25,
        similarityContrib: roundedSimilarity,
        collaborativeContrib: roundedCollab,
        explorationJitter: roundedJitter,
        activeAlgorithms: algos,
        enablePersonalization,
        explorationSeed,
        metadataConfidence: video.metadataConfidence ?? 1.0,
        missingSignals: video.missingSignals || [],
        observedMetadata: {
          durationSec: durationKnown ? video.durationSec : null,
          durationText: durationKnown ? video.durationText : 'Unknown',
          views: viewsKnown ? video.views : null,
          channel: video.channel || 'Unknown Creator',
          dataOrigin: video.dataOrigin || 'local_catalog'
        },
        heuristicEstimates: {
          source: video.aiScored ? 'gemini_ai_verified' : 'heuristic_title_metadata_inference',
          educationalDepth: video.educationalDepth,
          clickbaitIndex: video.clickbaitIndex,
          indieScore: video.indieScore,
          noveltyScore: video.noveltyScore
        }
      },
      reasons,
      actionableHint: hasBoostedTopic
        ? `Boosted (+${topicBoost} pts) because "${video.category}" is set to Boost (+).`
        : `Lower Anti-Clickbait or boost "${video.category}" to rank similar videos higher.`
    };
  }

  // ---------------------------------------------------------------------------
  // 5. DUPLICATE SUPPRESSION & DIVERSITY-AWARE MMR RE-RANKING
  // ---------------------------------------------------------------------------
  function rankAndDiversifyFeed(evaluatedItems, options = {}) {
    const enableMmr = options.diversityReranking !== false;
    const diversityLambda = enableMmr ? clamp((options.mmrStrength ?? options.diversityWeight ?? 32) / 100, 0, 0.85) : 0;
    const maxPerCreator = enableMmr ? clamp(options.maxPerCreator ?? 2, 1, 10) : 10;
    const explorationOffset = clamp(options.explorationOffset ?? 0, 0, 100);

    // Ranking is determined by the evaluated score. Live status is never an
    // independent sort key; users who want live results prioritized must opt in
    // to the explicit live score contribution during evaluateVideo().
    const baseSorted = [...evaluatedItems].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.video.id).localeCompare(String(b.video.id));
    });

    // Step 2: Exact-ID deduplication is candidate hygiene. Near-duplicate title
    // suppression belongs to the optional diversity/MMR module and is disabled
    // when the user turns that module off.
    const uniqueCandidates = [];
    const uniqueTokenSets = [];
    const seenIds = new Set();

    for (const item of baseSorted) {
      const vid = item.video;
      if (!vid || !isValidYoutubeId(vid.id)) continue;
      if (seenIds.has(vid.id)) continue;
      const tokens = tokenizeTitle(vid.title);
      let isNearDup = false;
      if (enableMmr) {
        for (let j = 0; j < uniqueTokenSets.length; j++) {
          const existingTokens = uniqueTokenSets[j];
          const minSz = Math.min(tokens.size, existingTokens.size);
          const maxSz = Math.max(tokens.size, existingTokens.size);
          if (maxSz > 0 && minSz / maxSz < 0.80) continue;
          if (fastSetJaccard(tokens, existingTokens) >= 0.82) {
            isNearDup = true;
            break;
          }
        }
      }
      if (isNearDup) continue;
      seenIds.add(vid.id);
      uniqueCandidates.push(item);
      if (enableMmr) uniqueTokenSets.push(tokens);
    }

    if (!enableMmr || (diversityLambda === 0 && maxPerCreator >= 20)) {
      return uniqueCandidates;
    }

    // Step 3: Greedy Maximal Marginal Relevance (MMR) with Creator Cap
    const selected = [];
    const deferredByCreatorCap = [];
    const creatorCounts = new Map();
    const remaining = [...uniqueCandidates];

    while (remaining.length > 0) {
      let bestIdx = -1;
      let bestMmrScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const ch = (cand.video.channel || 'unknown').toLowerCase();
        const chCount = creatorCounts.get(ch) || 0;

        if (chCount >= maxPerCreator) {
          continue;
        }

        let maxSim = 0;
        const recentWindow = selected.slice(-4);
        for (const sel of recentWindow) {
          let sim = 0;
          if ((sel.video.channel || '').toLowerCase() === ch) sim += 0.75;
          if (sel.video.category && sel.video.category === cand.video.category) sim += 0.15;
          if (sim > maxSim) maxSim = sim;
        }

        const deterministicRotationBonus = explorationOffset > 0
          ? (((cand.video.id.charCodeAt(0) + explorationOffset) % 5) - 2) * 0.6
          : 0;

        const mmrValue =
          (1 - diversityLambda) * cand.score -
          diversityLambda * (maxSim * 28) +
          deterministicRotationBonus;

        if (mmrValue > bestMmrScore) {
          bestMmrScore = mmrValue;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) {
        deferredByCreatorCap.push(...remaining.splice(0, remaining.length));
        break;
      }

      const chosen = remaining.splice(bestIdx, 1)[0];
      const ch = (chosen.video.channel || 'unknown').toLowerCase();
      creatorCounts.set(ch, (creatorCounts.get(ch) || 0) + 1);
      selected.push(chosen);
    }

    return [...selected, ...deferredByCreatorCap];
  }

  // ---------------------------------------------------------------------------
  // 6. STRICT PRESET & POLICY VALIDATOR
  // ---------------------------------------------------------------------------
  function validatePresetProfile(rawInput) {
    let parsed = rawInput;
    if (typeof rawInput === 'string') {
      try {
        parsed = JSON.parse(rawInput);
      } catch (err) {
        return { valid: false, error: 'Invalid JSON syntax in preset profile.' };
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, error: 'Preset profile must be a JSON object.' };
    }

    const rawStr = typeof rawInput === 'string' ? rawInput : JSON.stringify(parsed);
    if (rawStr.includes('__proto__') || rawStr.includes('constructor') || rawStr.includes('prototype')) {
      return { valid: false, error: 'Rejected unsafe prototype properties in preset JSON.' };
    }

    const rawWeights = parsed.weights && typeof parsed.weights === 'object' ? parsed.weights : parsed;
    const sanitizedWeights = {
      relevance: clamp(rawWeights.relevance ?? DEFAULT_WEIGHTS.relevance, 0, 100),
      depth: clamp(rawWeights.depth ?? DEFAULT_WEIGHTS.depth, 0, 100),
      antiClickbait: clamp(rawWeights.antiClickbait ?? DEFAULT_WEIGHTS.antiClickbait, 0, 100),
      indie: clamp(rawWeights.indie ?? DEFAULT_WEIGHTS.indie, 0, 100),
      longForm: clamp(rawWeights.longForm ?? DEFAULT_WEIGHTS.longForm, 0, 100),
      novelty: clamp(rawWeights.novelty ?? DEFAULT_WEIGHTS.novelty, 0, 100),
      recency: clamp(rawWeights.recency ?? DEFAULT_WEIGHTS.recency, 0, 100),
      popularity: clamp(rawWeights.popularity ?? DEFAULT_WEIGHTS.popularity, -100, 100),
      minDurationMin: clamp(rawWeights.minDurationMin ?? DEFAULT_WEIGHTS.minDurationMin, 0, 30),
      maxDurationMin: clamp(rawWeights.maxDurationMin ?? DEFAULT_WEIGHTS.maxDurationMin, 0, 240),
      diversityWeight: clamp(rawWeights.diversityWeight ?? DEFAULT_WEIGHTS.diversityWeight, 0, 85),
      mmrStrength: clamp(rawWeights.mmrStrength ?? DEFAULT_WEIGHTS.mmrStrength, 0, 85),
      maxPerCreator: clamp(rawWeights.maxPerCreator ?? DEFAULT_WEIGHTS.maxPerCreator, 1, 10),
      baseScore: clamp(rawWeights.baseScore ?? DEFAULT_WEIGHTS.baseScore, 0, 50),
      topicBoost: clamp(rawWeights.topicBoost ?? DEFAULT_WEIGHTS.topicBoost, 0, 50),
      creatorBoost: clamp(rawWeights.creatorBoost ?? DEFAULT_WEIGHTS.creatorBoost, 0, 50),
      keywordBoost: clamp(rawWeights.keywordBoost ?? DEFAULT_WEIGHTS.keywordBoost, 0, 50),
      liveFreshnessBoost: clamp(rawWeights.liveFreshnessBoost ?? DEFAULT_WEIGHTS.liveFreshnessBoost, 0, 30),
      blockShorts: typeof rawWeights.blockShorts === 'boolean' ? rawWeights.blockShorts : DEFAULT_WEIGHTS.blockShorts,
      hideOutrage: typeof rawWeights.hideOutrage === 'boolean' ? rawWeights.hideOutrage : DEFAULT_WEIGHTS.hideOutrage
    };

    const rawAlgos = parsed.algorithms && typeof parsed.algorithms === 'object' ? parsed.algorithms : {};
    const sanitizedAlgorithms = {
      contentBased: typeof rawAlgos.contentBased === 'boolean' ? rawAlgos.contentBased : DEFAULT_ALGORITHMS.contentBased,
      keywordTopic: typeof rawAlgos.keywordTopic === 'boolean' ? rawAlgos.keywordTopic : DEFAULT_ALGORITHMS.keywordTopic,
      videoSimilarity: typeof rawAlgos.videoSimilarity === 'boolean' ? rawAlgos.videoSimilarity : DEFAULT_ALGORITHMS.videoSimilarity,
      weightedScoring: typeof rawAlgos.weightedScoring === 'boolean' ? rawAlgos.weightedScoring : DEFAULT_ALGORITHMS.weightedScoring,
      noveltyExploration: typeof rawAlgos.noveltyExploration === 'boolean' ? rawAlgos.noveltyExploration : DEFAULT_ALGORITHMS.noveltyExploration,
      diversityReranking: typeof rawAlgos.diversityReranking === 'boolean' ? rawAlgos.diversityReranking : DEFAULT_ALGORITHMS.diversityReranking,
      collaborativeFiltering: typeof rawAlgos.collaborativeFiltering === 'boolean' ? rawAlgos.collaborativeFiltering : DEFAULT_ALGORITHMS.collaborativeFiltering
    };

    const sanitizedTopicPrefs = Object.create(null);
    if (parsed.topicPrefs && typeof parsed.topicPrefs === 'object' && !Array.isArray(parsed.topicPrefs)) {
      for (const [k, v] of Object.entries(parsed.topicPrefs)) {
        if (/^[a-zA-Z0-9_-]{1,36}$/.test(k) && (v === -1 || v === 0 || v === 1)) {
          sanitizedTopicPrefs[k] = v;
        }
      }
    }

    const sanitizedCreatorPrefs = Object.create(null);
    if (parsed.creatorPrefs && typeof parsed.creatorPrefs === 'object' && !Array.isArray(parsed.creatorPrefs)) {
      for (const [k, v] of Object.entries(parsed.creatorPrefs)) {
        const cleanK = String(k || '').replace(/[<>]/g, '').trim().toLowerCase().slice(0, 60);
        if (cleanK && (v === -1 || v === 0 || v === 1)) {
          sanitizedCreatorPrefs[cleanK] = v;
        }
      }
    }

    const sanitizeKwArray = arr =>
      Array.isArray(arr)
        ? arr
            .slice(0, 30)
            .map(s => String(s || '').replace(/[<>]/g, '').trim().toLowerCase().slice(0, 40))
            .filter(Boolean)
        : [];

    const sanitizedCustomTopics = [];
    if (Array.isArray(parsed.customTopics)) {
      for (const ct of parsed.customTopics.slice(0, 25)) {
        if (ct && typeof ct === 'object' && typeof ct.id === 'string' && typeof ct.label === 'string') {
          const safeId = ct.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
          const safeLabel = ct.label.replace(/[<>]/g, '').trim().slice(0, 40);
          const safeQuery = typeof ct.query === 'string' ? ct.query.replace(/[<>]/g, '').trim().slice(0, 80) : safeLabel;
          if (safeId && safeLabel) {
            sanitizedCustomTopics.push({ id: safeId, label: safeLabel, query: safeQuery, custom: true });
          }
        }
      }
    }

    const activePromptText = typeof parsed.activePromptText === 'string'
      ? parsed.activePromptText.trim().slice(0, 240)
      : '';

    return {
      valid: true,
      profile: {
        version: ENGINE_VERSION,
        name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 60) : 'Custom Imported Profile',
        activePromptText,
        enablePersonalization: typeof parsed.enablePersonalization === 'boolean' ? parsed.enablePersonalization : true,
        explorationSeed: clamp(parsed.explorationSeed ?? 0, 0, 999999),
        weights: sanitizedWeights,
        algorithms: sanitizedAlgorithms,
        topicPrefs: Object.assign({}, sanitizedTopicPrefs),
        creatorPrefs: Object.assign({}, sanitizedCreatorPrefs),
        includeKeywords: sanitizeKwArray(parsed.includeKeywords),
        excludeKeywords: sanitizeKwArray(parsed.excludeKeywords),
        customTopics: sanitizedCustomTopics
      }
    };
  }

  // ---------------------------------------------------------------------------
  // 7. OFFLINE IR EVALUATION METRICS & COMPARATIVE ALGORITHM BENCHMARKING
  // ---------------------------------------------------------------------------
  function computePrecisionAtK(rankedItems, relevantIdsSet, k = 5) {
    const topK = rankedItems.slice(0, k);
    if (topK.length === 0) return 0;
    const hits = topK.filter(item => relevantIdsSet.has(item.video.id)).length;
    return Number((hits / k).toFixed(4));
  }

  function computeRecallAtK(rankedItems, relevantIdsSet, k = 5) {
    if (!relevantIdsSet || relevantIdsSet.size === 0) return 0;
    const topK = rankedItems.slice(0, k);
    const hits = topK.filter(item => relevantIdsSet.has(item.video.id)).length;
    return Number((hits / relevantIdsSet.size).toFixed(4));
  }

  function computeNDCGAtK(rankedItems, relevanceGradesMap, k = 5) {
    const topK = rankedItems.slice(0, k);
    if (topK.length === 0) return 0;

    let dcg = 0;
    for (let i = 0; i < topK.length; i++) {
      const rel = relevanceGradesMap.get(topK[i].video.id) || 0;
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }

    const idealGrades = Array.from(relevanceGradesMap.values()).sort((a, b) => b - a).slice(0, k);
    let idcg = 0;
    for (let i = 0; i < idealGrades.length; i++) {
      idcg += (Math.pow(2, idealGrades[i]) - 1) / Math.log2(i + 2);
    }

    return idcg > 0 ? Number((dcg / idcg).toFixed(4)) : 0;
  }

  function computeIntraListDiversityAtK(rankedItems, k = 10) {
    const topK = rankedItems.slice(0, k);
    if (topK.length <= 1) return 1;
    let totalDissimilarity = 0;
    let pairs = 0;
    for (let i = 0; i < topK.length; i++) {
      for (let j = i + 1; j < topK.length; j++) {
        const a = topK[i].video;
        const b = topK[j].video;
        let sim = 0;
        if ((a.channel || '').toLowerCase() === (b.channel || '').toLowerCase()) sim += 0.6;
        if ((a.category || '') === (b.category || '')) sim += 0.4;
        totalDissimilarity += (1 - sim);
        pairs++;
      }
    }
    return pairs > 0 ? Number((totalDissimilarity / pairs).toFixed(4)) : 0;
  }

  /**
   * Computes Catalog Coverage@K across multiple user profiles/queries:
   * the proportion of unique catalog items surfaced in the top-K lists across all profiles.
   */
  function computeCatalogCoverageAtK(rankedLists, totalCatalogSize, k = 5) {
    if (!Array.isArray(rankedLists) || rankedLists.length === 0 || totalCatalogSize <= 0) return 0;
    const surfacedIds = new Set();
    for (const list of rankedLists) {
      for (const item of (list || []).slice(0, k)) {
        if (item && item.video && item.video.id) {
          surfacedIds.add(item.video.id);
        }
      }
    }
    return Number((surfacedIds.size / totalCatalogSize).toFixed(4));
  }

  /**
   * Computes Mean Self-Information Novelty@K in [0, 1]:
   * rewards surfacing less-mainstream videos with lower global view counts.
   */
  function computeNoveltyAtK(rankedItems, k = 5) {
    const topK = rankedItems.slice(0, k);
    if (topK.length === 0) return 0;
    let sumNovelty = 0;
    for (const item of topK) {
      const views = typeof item.video.views === 'number' && item.video.views > 0 ? item.video.views : 100000;
      const logPop = Math.min(1, Math.log10(Math.max(100, views)) / 9);
      sumNovelty += (1 - logPop);
    }
    return Number((sumNovelty / topK.length).toFixed(4));
  }

  /**
   * Compares 4 candidate recommendation strategies across a labeled corpus and multiple user profiles:
   * 1. `popularity_hype_baseline`: Conventional attention-maximizing sort (views + hypeIndex)
   * 2. `content_bm25_only`: Pure lexical/topic content filtering without quality/MMR weights
   * 3. `lightfm_hybrid_only`: Pure feature-interaction collaborative affinity + topic match
   * 4. `uryoutube_multi_algo_mmr`: Full user-controlled multi-algorithm ensemble with MMR diversification
   */
  function compareRecommendationAlgorithms(corpus, profileConfigs) {
    const strategies = [
      {
        id: 'popularity_hype_baseline',
        name: 'Conventional Popularity/Hype Baseline',
        run: (items, prof) => {
          const ev = items.map(v => evaluateVideo(v, {
            activePreset: 'corporate_trap',
            weights: { depth: 0, antiClickbait: 0, indie: 0, longForm: 0, novelty: 0, popularity: 100, minDurationMin: 0, blockShorts: false, hideOutrage: false },
            algorithms: { contentBased: false, keywordTopic: false, videoSimilarity: false, weightedScoring: true, noveltyExploration: false, diversityReranking: false, collaborativeFiltering: false }
          }));
          return rankAndDiversifyFeed(ev, { diversityReranking: false });
        }
      },
      {
        id: 'content_bm25_only',
        name: 'Pure Content-Based (BM25 + Topic Rules)',
        run: (items, prof) => {
          const ev = items.map(v => evaluateVideo(v, {
            queryText: prof.queryText,
            topicPrefs: prof.topicPrefs,
            weights: { relevance: 100, depth: 0, antiClickbait: 0, indie: 0, longForm: 0, novelty: 0, minDurationMin: prof.weights.minDurationMin || 0, blockShorts: true, hideOutrage: true },
            algorithms: { contentBased: true, keywordTopic: true, videoSimilarity: false, weightedScoring: false, noveltyExploration: false, diversityReranking: false, collaborativeFiltering: false }
          })).filter(e => !e.isBlocked);
          return rankAndDiversifyFeed(ev, { diversityReranking: false });
        }
      },
      {
        id: 'lightfm_hybrid_only',
        name: 'LightFM-Inspired Hybrid Feature-Interaction',
        run: (items, prof) => {
          const ev = items.map(v => evaluateVideo(v, {
            topicPrefs: prof.topicPrefs,
            interactionVideos: prof.seedInteractions || [],
            enablePersonalization: true,
            weights: { relevance: 50, depth: 50, antiClickbait: 60, indie: 50, longForm: 50, novelty: 40, minDurationMin: prof.weights.minDurationMin || 0, blockShorts: true, hideOutrage: true },
            algorithms: { contentBased: false, keywordTopic: true, videoSimilarity: true, weightedScoring: false, noveltyExploration: false, diversityReranking: false, collaborativeFiltering: true }
          })).filter(e => !e.isBlocked);
          return rankAndDiversifyFeed(ev, { diversityReranking: false });
        }
      },
      {
        id: 'uryoutube_multi_algo_mmr',
        name: 'urYouTube User-Controlled Ensemble + MMR',
        run: (items, prof) => {
          const ev = items.map(v => evaluateVideo(v, {
            queryText: prof.queryText,
            topicPrefs: prof.topicPrefs,
            interactionVideos: prof.seedInteractions || [],
            enablePersonalization: true,
            weights: prof.weights,
            algorithms: DEFAULT_ALGORITHMS
          })).filter(e => !e.isBlocked);
          return rankAndDiversifyFeed(ev, { diversityReranking: true, diversityWeight: prof.weights.diversityWeight ?? 25, maxPerCreator: 2 });
        }
      }
    ];

    const comparison = {};
    for (const strat of strategies) {
      const rankedLists = [];
      let sumP5 = 0;
      let sumR5 = 0;
      let sumNDCG5 = 0;
      let sumILD10 = 0;
      let sumNov5 = 0;

      for (const prof of profileConfigs) {
        const ranked = strat.run(corpus, prof);
        rankedLists.push(ranked);
        sumP5 += computePrecisionAtK(ranked, prof.relevantSet, 5);
        sumR5 += computeRecallAtK(ranked, prof.relevantSet, 5);
        sumNDCG5 += computeNDCGAtK(ranked, prof.gradesMap, 5);
        sumILD10 += computeIntraListDiversityAtK(ranked, 10);
        sumNov5 += computeNoveltyAtK(ranked, 5);
      }

      const n = Math.max(1, profileConfigs.length);
      comparison[strat.id] = {
        name: strat.name,
        meanPrecisionAt5: Number((sumP5 / n).toFixed(4)),
        meanRecallAt5: Number((sumR5 / n).toFixed(4)),
        meanNDCGAt5: Number((sumNDCG5 / n).toFixed(4)),
        meanILDAt10: Number((sumILD10 / n).toFixed(4)),
        meanNoveltyAt5: Number((sumNov5 / n).toFixed(4)),
        catalogCoverageAt5: computeCatalogCoverageAtK(rankedLists, corpus.length, 5)
      };
    }

    return comparison;
  }

  return {
    ENGINE_VERSION,
    DEFAULT_WEIGHTS,
    DEFAULT_ALGORITHMS,
    escapeHtml,
    isValidYoutubeId,
    extractYoutubeVideoId,
    sanitizeExternalUrl,
    sanitizeUntrustedTextForPrompt,
    computeSeededExplorationJitter,
    formatDurationSec,
    parseIsoDuration,
    inferSignalsFromMetadata,
    normalizeVideoRecord,
    createManualVideoRecord,
    scoreContentBasedBM25,
    scoreItemSimilarity,
    scoreHybridCollaborative,
    evaluateVideo,
    rankAndDiversifyFeed,
    validatePresetProfile,
    computePrecisionAtK,
    computeRecallAtK,
    computeNDCGAtK,
    computeIntraListDiversityAtK,
    computeCatalogCoverageAtK,
    computeNoveltyAtK,
    compareRecommendationAlgorithms
  };
});
