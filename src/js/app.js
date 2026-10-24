// ============================================================================
    // 0. SECURITY SANITIZATION, METADATA CONFIDENCE & MMR DIVERSITY HELPERS
    // ============================================================================
    const HTML_ESCAPE_MAP = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
      "/": "&#x2F;",
      "`": "&#x60;"
    };

    function escapeHtml(value) {
      if (value === null || value === undefined) return "";
      return String(value).replace(/[&<>"'`/]/g, ch => HTML_ESCAPE_MAP[ch]);
    }

    function isValidYoutubeId(id) {
      return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
    }

    function sanitizeExternalUrl(rawUrl, fallback = "https://www.youtube.com") {
      if (typeof rawUrl !== "string" || !rawUrl.trim()) return fallback;
      try {
        const parsed = new URL(rawUrl.trim());
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
        return parsed.href;
      } catch (e) {
        return fallback;
      }
    }

    function sanitizeUntrustedForPrompt(raw, maxLen = 160) {
      if (typeof raw !== "string") return "";
      return raw
        .replace(/[\x00-\x1F\x7F]/g, " ")
        .replace(/```/g, "")
        .replace(/\b(ignore previous instructions|system prompt|you are now|disregard all)\b/gi, "[filtered]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);
    }

    function computeMetadataConfidence(v) {
      let c = 0.3; // Title present
      if (typeof v.durationSec === "number" && v.durationSec > 0) c += 0.25;
      if (typeof v.views === "number" && v.views >= 0) c += 0.20;
      if (typeof v.channel === "string" && v.channel.trim().length > 0) c += 0.15;
      if (typeof v.summary === "string" && v.summary.trim().length > 10) c += 0.10;
      return Number(c.toFixed(2));
    }

    function tokenJaccardSimilarity(a, b) {
      const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
      const setA = new Set(norm(a));
      const setB = new Set(norm(b));
      if (setA.size === 0 || setB.size === 0) return 0;
      let inter = 0;
      setA.forEach(t => { if (setB.has(t)) inter++; });
      return inter / (setA.size + setB.size - inter);
    }

    function applyMmrAndCreatorCap(sortedItems, enableMmr = true, prioritizeLive = true, explorationCycle = 0, mmrStrength = 32, maxPerCreatorSetting = 2) {
      // Near-duplicate suppression
      const unique = [];
      const seenIds = new Set();
      for (const item of sortedItems) {
        if (!item || !item.video || !isValidYoutubeId(item.video.id)) continue;
        if (seenIds.has(item.video.id)) continue;
        const isDup = enableMmr && unique.some(u => tokenJaccardSimilarity(u.video.title, item.video.title) >= 0.82);
        if (isDup) continue;
        seenIds.add(item.video.id);
        unique.push(item);
      }

      if (!enableMmr) return unique;

      const maxPerCreator = Math.max(1, Math.min(10, Math.floor(Number(maxPerCreatorSetting) || 2)));
      const lambda = Math.max(0, Math.min(0.85, Number(mmrStrength) / 100 || 0));
      const selected = [];
      const deferred = [];
      const creatorCounts = new Map();
      const pool = [...unique];

      while (pool.length > 0) {
        let bestIdx = -1;
        let bestVal = -Infinity;
        for (let i = 0; i < pool.length; i++) {
          const cand = pool[i];
          const ch = (cand.video.channel || "unknown").toLowerCase();
          if ((creatorCounts.get(ch) || 0) >= maxPerCreator) continue;

          let maxSim = 0;
          for (const sel of selected.slice(-4)) {
            let sim = 0;
            if ((sel.video.channel || "").toLowerCase() === ch) sim += 0.65;
            if (sel.video.category === cand.video.category) sim += 0.35;
            if (sim > maxSim) maxSim = sim;
          }

          // No hidden live-result or refresh-cycle bonus: the score and explicit MMR
          // strength are the only ranking inputs in this selection step.
          const val = (1 - lambda) * cand.score - lambda * (maxSim * 28);
          if (val > bestVal) {
            bestVal = val;
            bestIdx = i;
          }
        }
        if (bestIdx === -1) {
          deferred.push(...pool.splice(0, pool.length));
          break;
        }
        const chosen = pool.splice(bestIdx, 1)[0];
        const ch = (chosen.video.channel || "unknown").toLowerCase();
        creatorCounts.set(ch, (creatorCounts.get(ch) || 0) + 1);
        selected.push(chosen);
      }
      return [...selected, ...deferred];
    }

    // ============================================================================
    // 1. SEED POOL + REAL-TIME LIVE DISCOVERY ENGINE
    // ============================================================================
    const INITIAL_VIDEOS = [
      {
        id: "9P6rdqiybaw",
        title: "Wormholes Explained – Breaking Spacetime",
        channel: "Kurzgesagt – In a Nutshell",
        subscribers: "23M",
        views: 25712189,
        durationSec: 489,
        durationText: "8:09",
        category: "Science & Cosmos",
        topics: ["science"],
        educationalDepth: 86,
        clickbaitIndex: 22,
        indieScore: 28,
        noveltyScore: 79,
        hypeIndex: 36,
        summary: "General relativity, Einstein-Rosen bridges, and why traversable wormholes require negative energy density."
      },
      {
        id: "XX8mjBXBqz8",
        title: "Testing your intuition for quantum computing",
        channel: "3Blue1Brown",
        subscribers: "6.8M",
        views: 1432732,
        durationSec: 101,
        durationText: "1:41",
        category: "CS & Math",
        topics: ["cs-math", "science"],
        educationalDepth: 88,
        clickbaitIndex: 8,
        indieScore: 45,
        noveltyScore: 80,
        hypeIndex: 25,
        summary: "Quick 100-second puzzle testing your intuition on classical vs quantum query complexity."
      },
      {
        id: "RQWpF2Gb-gU",
        title: "But what is quantum computing? (Grover's Algorithm)",
        channel: "3Blue1Brown",
        subscribers: "6.8M",
        views: 4156515,
        durationSec: 2214,
        durationText: "36:54",
        category: "CS & Math",
        topics: ["cs-math", "science"],
        educationalDepth: 99,
        clickbaitIndex: 4,
        indieScore: 45,
        noveltyScore: 92,
        hypeIndex: 18,
        summary: "Visual, first-principles mathematical breakdown of quantum state vectors and Grover's search speed-up."
      },
      {
        id: "LPZh9BOjkQs",
        title: "Large Language Models explained briefly",
        channel: "3Blue1Brown",
        subscribers: "6.8M",
        views: 8219835,
        durationSec: 478,
        durationText: "7:58",
        category: "AI & Systems",
        topics: ["ai-systems", "cs-math"],
        educationalDepth: 95,
        clickbaitIndex: 6,
        indieScore: 45,
        noveltyScore: 84,
        hypeIndex: 25,
        summary: "Intuitive explanation of transformers, attention matrices, and next-token prediction without hype."
      },
      {
        id: "Ilg3gGewQ5U",
        title: "Backpropagation, intuitively | Deep Learning Chapter 3",
        channel: "3Blue1Brown",
        subscribers: "6.8M",
        views: 6350654,
        durationSec: 767,
        durationText: "12:47",
        category: "CS & Math",
        topics: ["cs-math", "ai-systems"],
        educationalDepth: 98,
        clickbaitIndex: 5,
        indieScore: 48,
        noveltyScore: 80,
        hypeIndex: 12,
        summary: "Calculus of neural network gradient descent visualized step by step."
      },
      {
        id: "Cp5WWtMoeKg",
        title: "Coding Adventure: Ray Marching",
        channel: "Sebastian Lague",
        subscribers: "1.3M",
        views: 1208041,
        durationSec: 306,
        durationText: "5:06",
        category: "CS & Math",
        topics: ["cs-math", "indie-tech"],
        educationalDepth: 93,
        clickbaitIndex: 5,
        indieScore: 82,
        noveltyScore: 94,
        hypeIndex: 14,
        summary: "Creative graphics programming experiment rendering 3D fractals with signed distance fields."
      },
      {
        id: "mwN75EiGfCE",
        title: "Agent AI System Design Explained in 27 Minutes",
        channel: "Aishwarya Srinivasan",
        subscribers: "145K",
        views: 273986,
        durationSec: 1616,
        durationText: "26:56",
        category: "AI & Systems",
        topics: ["ai-systems", "cs-math", "indie-tech"],
        educationalDepth: 91,
        clickbaitIndex: 12,
        indieScore: 88,
        noveltyScore: 86,
        hypeIndex: 22,
        summary: "Architectural patterns for multi-agent orchestration, memory retrieval, and tool evaluation."
      },
      {
        id: "SE2KF-vxvS0",
        title: "System Design for Beginners (2026)",
        channel: "KodeKloud",
        subscribers: "620K",
        views: 675705,
        durationSec: 5137,
        durationText: "1:25:37",
        category: "AI & Systems",
        topics: ["ai-systems", "cs-math"],
        educationalDepth: 93,
        clickbaitIndex: 10,
        indieScore: 70,
        noveltyScore: 75,
        hypeIndex: 20,
        summary: "Full-length engineering course covering load balancers, distributed caching, sharding, and CAP theorem."
      },
      {
        id: "BTjxUS_PylA",
        title: "8 Most Important System Design Concepts You Should Know",
        channel: "ByteByteGo",
        subscribers: "1.1M",
        views: 589726,
        durationSec: 365,
        durationText: "6:05",
        category: "AI & Systems",
        topics: ["ai-systems", "cs-math"],
        educationalDepth: 86,
        clickbaitIndex: 18,
        indieScore: 62,
        noveltyScore: 72,
        hypeIndex: 28,
        summary: "Concise visual walkthrough of API gateways, message queues, CDNs, and database replication."
      },
      {
        id: "S6jy0T85DFs",
        title: "AI System Design Tutorial",
        channel: "codebasics",
        subscribers: "1.0M",
        views: 164273,
        durationSec: 2592,
        durationText: "43:12",
        category: "AI & Systems",
        topics: ["ai-systems", "cs-math"],
        educationalDepth: 90,
        clickbaitIndex: 11,
        indieScore: 76,
        noveltyScore: 79,
        hypeIndex: 19,
        summary: "End-to-end production ML & RAG pipeline design with latency and cost trade-offs."
      },
      {
        id: "IT1uBUsOmUY",
        title: "How I Built ChatGPT AI Robot Which Talks & Moves On Its Own | Hardware Build",
        channel: "Tech With Anant",
        subscribers: "92K",
        views: 487135,
        durationSec: 833,
        durationText: "13:53",
        category: "Indie & Homelab",
        topics: ["indie-tech", "ai-systems"],
        educationalDepth: 84,
        clickbaitIndex: 19,
        indieScore: 92,
        noveltyScore: 88,
        hypeIndex: 30,
        summary: "Hands-on robotics build integrating microcontrollers, servo kinematics, and local voice inference."
      },
      {
        id: "9atHsWxTKTE",
        title: "I'm building a Robot Arm because I can't afford to buy one.",
        channel: "Cinema Mechanics",
        subscribers: "68K",
        views: 394473,
        durationSec: 947,
        durationText: "15:47",
        category: "Indie & Homelab",
        topics: ["indie-tech", "science"],
        educationalDepth: 87,
        clickbaitIndex: 14,
        indieScore: 93,
        noveltyScore: 90,
        hypeIndex: 18,
        summary: "Custom mechanical engineering and CNC/3D-printed planetary gearboxes for a cinema camera robot arm."
      },
      {
        id: "ZZ8OeKgDndM",
        title: "5 Things I Wish I Knew Before Self Hosting",
        channel: "Hardware Haven",
        subscribers: "280K",
        views: 387139,
        durationSec: 899,
        durationText: "14:59",
        category: "Indie & Homelab",
        topics: ["indie-tech", "ai-systems"],
        educationalDepth: 85,
        clickbaitIndex: 16,
        indieScore: 89,
        noveltyScore: 83,
        hypeIndex: 22,
        summary: "Practical lessons on Docker networking, reverse proxies, ZFS backups, and power efficiency for home servers."
      },
      {
        id: "g-pxcJpze74",
        title: "Beginner Homelab Essential Gear for UNDER $100",
        channel: "Geek Of All Trades",
        subscribers: "85K",
        views: 321644,
        durationSec: 553,
        durationText: "9:13",
        category: "Indie & Homelab",
        topics: ["indie-tech"],
        educationalDepth: 81,
        clickbaitIndex: 20,
        indieScore: 94,
        noveltyScore: 78,
        hypeIndex: 24,
        summary: "Building a quiet, low-wattage Linux server cluster using refurbished mini PCs."
      },
      {
        id: "isdLel273rQ",
        title: "The Paradox of an Infinite Universe",
        channel: "Kurzgesagt – In a Nutshell",
        subscribers: "23M",
        views: 12533778,
        durationSec: 681,
        durationText: "11:21",
        category: "Science & Cosmos",
        topics: ["science"],
        educationalDepth: 89,
        clickbaitIndex: 18,
        indieScore: 30,
        noveltyScore: 85,
        hypeIndex: 35,
        summary: "Cosmological exploration of spatial infinity, quantum fluctuations, and the observable horizon."
      },
      {
        id: "Da-2h2B4faU",
        title: "String Theory Explained – What is The True Nature of Reality?",
        channel: "Kurzgesagt – In a Nutshell",
        subscribers: "23M",
        views: 26739400,
        durationSec: 480,
        durationText: "8:00",
        category: "Science & Cosmos",
        topics: ["science", "cs-math"],
        educationalDepth: 88,
        clickbaitIndex: 20,
        indieScore: 28,
        noveltyScore: 81,
        hypeIndex: 38,
        summary: "Visualizing extra dimensions, vibrating quantum strings, and unifying gravity with quantum mechanics."
      },
      {
        id: "uSMGENDH_QI",
        title: "Cosmic Dawn (NASA+ Original Documentary)",
        channel: "NASA",
        subscribers: "12M",
        views: 2700243,
        durationSec: 5806,
        durationText: "1:36:46",
        category: "Science & Cosmos",
        topics: ["science", "history-docs"],
        educationalDepth: 96,
        clickbaitIndex: 4,
        indieScore: 50,
        noveltyScore: 91,
        hypeIndex: 15,
        summary: "Inside the engineering, cryogenic optics, and deep-field revelations of the James Webb Space Telescope."
      },
      {
        id: "w9UfJTAjIdk",
        title: "James Webb: Seeing the First Galaxies | Free Documentary Space",
        channel: "Free Documentary - Space",
        subscribers: "410K",
        views: 563274,
        durationSec: 2585,
        durationText: "43:05",
        category: "Science & Cosmos",
        topics: ["science"],
        educationalDepth: 92,
        clickbaitIndex: 8,
        indieScore: 78,
        noveltyScore: 88,
        hypeIndex: 14,
        summary: "Astrophysics documentary examining infrared spectroscopy and early galaxy formation."
      },
      {
        id: "H-XfCl-HpRM",
        title: "How Your Brain Works & Changes (Neuroplasticity)",
        channel: "Andrew Huberman",
        subscribers: "6.1M",
        views: 2068500,
        durationSec: 3751,
        durationText: "1:02:31",
        category: "Neuroscience & Mind",
        topics: ["neuro-phil", "science"],
        educationalDepth: 94,
        clickbaitIndex: 9,
        indieScore: 52,
        noveltyScore: 87,
        hypeIndex: 20,
        summary: "Stanford lecture on synapses, neuromodulators, acetylcholine focus gates, and adult neuroplasticity."
      },
      {
        id: "uqU9lmFztOU",
        title: "11. Introduction to Neuroscience II (Stanford University)",
        channel: "Stanford",
        subscribers: "2.1M",
        views: 685601,
        durationSec: 4383,
        durationText: "1:13:03",
        category: "Neuroscience & Mind",
        topics: ["neuro-phil", "science"],
        educationalDepth: 99,
        clickbaitIndex: 2,
        indieScore: 65,
        noveltyScore: 89,
        hypeIndex: 8,
        summary: "Full Stanford university lecture on neural signaling, cortical circuits, and behavioral biology."
      },
      {
        id: "ggkd_uyDqz8",
        title: "Stoicism: An In-Depth Explanation",
        channel: "Jared Henderson",
        subscribers: "310K",
        views: 1745526,
        durationSec: 1884,
        durationText: "31:24",
        category: "Neuroscience & Mind",
        topics: ["neuro-phil", "essays-arch"],
        educationalDepth: 93,
        clickbaitIndex: 7,
        indieScore: 86,
        noveltyScore: 90,
        hypeIndex: 14,
        summary: "Academic philosophical overview of Epictetus, Marcus Aurelius, virtue ethics, and logos."
      },
      {
        id: "EJHPltmAULA",
        title: "Fundamentals of Finance & Economics for Businesses – Crash Course",
        channel: "freeCodeCamp.org",
        subscribers: "10.1M",
        views: 2678618,
        durationSec: 5888,
        durationText: "1:38:08",
        category: "Economics & Society",
        topics: ["econ-society", "cs-math"],
        educationalDepth: 94,
        clickbaitIndex: 6,
        indieScore: 60,
        noveltyScore: 84,
        hypeIndex: 15,
        summary: "Complete university-grade course on macroeconomics, discounted cash flow, capital allocation, and market structure."
      },
      {
        id: "t6m49vNjEGs",
        title: "Money in the World Economy | DW Documentary",
        channel: "DW Documentary",
        subscribers: "5.8M",
        views: 11429930,
        durationSec: 2545,
        durationText: "42:25",
        category: "Economics & Society",
        topics: ["econ-society", "history-docs"],
        educationalDepth: 90,
        clickbaitIndex: 14,
        indieScore: 58,
        noveltyScore: 86,
        hypeIndex: 22,
        summary: "Investigative economic documentary on central banking, sovereign debt cycles, and global liquidity."
      },
      {
        id: "AvO8-925Edc",
        title: "The Visual Architecture of Parasite",
        channel: "Thomas Flight",
        subscribers: "540K",
        views: 1942566,
        durationSec: 621,
        durationText: "10:21",
        category: "Architecture & Essays",
        topics: ["essays-arch", "indie-tech"],
        educationalDepth: 90,
        clickbaitIndex: 8,
        indieScore: 84,
        noveltyScore: 93,
        hypeIndex: 16,
        summary: "Cinematographic and spatial analysis of verticality, sightlines, and class architecture."
      },
      {
        id: "7vJ6vCDjrDg",
        title: "Why does Gotham look like that?",
        channel: "indietrix",
        subscribers: "14K",
        views: 3992,
        durationSec: 992,
        durationText: "16:32",
        category: "Architecture & Essays",
        topics: ["essays-arch", "indie-tech"],
        educationalDepth: 89,
        clickbaitIndex: 7,
        indieScore: 99,
        noveltyScore: 96,
        hypeIndex: 8,
        summary: "Hidden-gem architectural video essay examining Gothic revival, Art Deco, and brutalism in urban design."
      },
      {
        id: "v6Q6y4-qKac",
        title: "The Immersive Realism of Studio Ghibli",
        channel: "Asher Kaye",
        subscribers: "48K",
        views: 2488633,
        durationSec: 601,
        durationText: "10:01",
        category: "Architecture & Essays",
        topics: ["essays-arch", "indie-tech"],
        educationalDepth: 88,
        clickbaitIndex: 9,
        indieScore: 87,
        noveltyScore: 91,
        hypeIndex: 15,
        summary: "How Miyazaki uses quiet negative space and physical detail to build emotional presence."
      },
      {
        id: "9Ku9csXhvJY",
        title: "Nowhere to Go: The Loss of Third Places",
        channel: "Elliot Sang",
        subscribers: "210K",
        views: 802000,
        durationSec: 2174,
        durationText: "36:14",
        category: "Architecture & Essays",
        topics: ["essays-arch", "indie-tech", "econ-society"],
        educationalDepth: 94,
        clickbaitIndex: 9,
        indieScore: 90,
        noveltyScore: 94,
        hypeIndex: 14,
        summary: "Deep sociological and urban planning essay on why community spaces are vanishing."
      },
      {
        id: "d2lJUOv0hLA",
        title: "8. The Sumerians - Fall of the First Cities",
        channel: "Fall of Civilizations",
        subscribers: "1.2M",
        views: 40967757,
        durationSec: 8869,
        durationText: "2:27:49",
        category: "History & Docs",
        topics: ["history-docs"],
        educationalDepth: 98,
        clickbaitIndex: 3,
        indieScore: 72,
        noveltyScore: 95,
        hypeIndex: 10,
        summary: "Feature-length historical documentary chronicling the rise, literature, and collapse of Sumer."
      },
      {
        id: "fhrUvIi1aGQ",
        title: "Ancient Engineering: The Foundations of Modern Civilization | FD Engineering",
        channel: "Free Documentary - Engineering",
        subscribers: "490K",
        views: 171921,
        durationSec: 8251,
        durationText: "2:17:31",
        category: "History & Docs",
        topics: ["history-docs", "science"],
        educationalDepth: 93,
        clickbaitIndex: 6,
        indieScore: 82,
        noveltyScore: 89,
        hypeIndex: 12,
        summary: "Structural analysis of Roman aqueducts, ancient hydraulic concrete, and stone mechanics."
      },
      {
        id: "_ITiwPMUzho",
        title: "3 AM Coding Session - Lofi Hip Hop Mix [Study & Coding Beats]",
        channel: "Lofi Ghostie",
        subscribers: "110K",
        views: 5509112,
        durationSec: 5691,
        durationText: "1:34:51",
        category: "Focus & Music",
        topics: ["lofi-music", "indie-tech"],
        educationalDepth: 65,
        clickbaitIndex: 4,
        indieScore: 86,
        noveltyScore: 78,
        hypeIndex: 10,
        summary: "Uninterrupted 95-minute instrumental lo-fi hip hop stream crafted for deep programming sessions."
      },
      {
        id: "am1VJP0RnmQ",
        title: "Flow State - Chillstep & Synthwave for Deep Focus | Coding Session",
        channel: "Cosmic Hippo",
        subscribers: "64K",
        views: 1208849,
        durationSec: 3813,
        durationText: "1:03:33",
        category: "Focus & Music",
        topics: ["lofi-music", "indie-tech"],
        educationalDepth: 64,
        clickbaitIndex: 5,
        indieScore: 91,
        noveltyScore: 82,
        hypeIndex: 11,
        summary: "Ambient analog synthwave and downtempo textures designed for zero-distraction flow state."
      },
      {
        id: "f02mOEt11OQ",
        title: "code-fi / lofi beats to code/relax to",
        channel: "The AMP Channel",
        subscribers: "195K",
        views: 9054237,
        durationSec: 3620,
        durationText: "1:00:20",
        category: "Focus & Music",
        topics: ["lofi-music"],
        educationalDepth: 62,
        clickbaitIndex: 5,
        indieScore: 80,
        noveltyScore: 75,
        hypeIndex: 14,
        summary: "One-hour instrumental beat tape for steady concentration without algorithmic interruptions."
      },
      {
        id: "xX4lS-STIlk",
        title: "Piercing PRANK Gone BAD 🤣🤣🤣🤣",
        channel: "AsmrLinastar",
        subscribers: "4.5M",
        views: 1076389241,
        durationSec: 15,
        durationText: "0:15",
        category: "Viral & Drama",
        topics: ["viral-hype"],
        educationalDepth: 5,
        clickbaitIndex: 96,
        indieScore: 10,
        noveltyScore: 12,
        hypeIndex: 99,
        summary: "15-second viral shock prank optimized for passive autoplay loops."
      },
      {
        id: "rB9NynBZ4go",
        title: "Reaction Time Challenge",
        channel: "MrBeast",
        subscribers: "340M",
        views: 213100116,
        durationSec: 29,
        durationText: "0:29",
        category: "Viral & Drama",
        topics: ["viral-hype"],
        educationalDepth: 12,
        clickbaitIndex: 88,
        indieScore: 2,
        noveltyScore: 15,
        hypeIndex: 98,
        summary: "Fast-cut 29-second viral stunt designed for maximum retention velocity."
      },
      {
        id: "miVkJmaVv-g",
        title: "Confessing M*rder To ChatGPT🤯",
        channel: "AceHype",
        subscribers: "1.8M",
        views: 28171283,
        durationSec: 40,
        durationText: "0:40",
        category: "Viral & Drama",
        topics: ["viral-hype"],
        educationalDepth: 14,
        clickbaitIndex: 94,
        indieScore: 20,
        noveltyScore: 20,
        hypeIndex: 95,
        summary: "Sensationalized shock-value short clip engineered for outrage and curiosity clicks."
      },
      {
        id: "pHglbPUxyNQ",
        title: "Natalie Reynolds shocked after cat in the hat costume overnight footage",
        channel: "Natalie Reynolds",
        subscribers: "2.1M",
        views: 525606,
        durationSec: 37,
        durationText: "0:37",
        category: "Viral & Drama",
        topics: ["viral-hype"],
        educationalDepth: 6,
        clickbaitIndex: 92,
        indieScore: 18,
        noveltyScore: 10,
        hypeIndex: 91,
        summary: "Overnight drama clip relying on shock-value title hooks."
      },
      {
        id: "Nu_OAQcoXNM",
        title: "Make me blush take $20",
        channel: "Saif Shawaf Shorts",
        subscribers: "3.2M",
        views: 15339883,
        durationSec: 29,
        durationText: "0:29",
        category: "Viral & Drama",
        topics: ["viral-hype"],
        educationalDepth: 8,
        clickbaitIndex: 89,
        indieScore: 15,
        noveltyScore: 14,
        hypeIndex: 93,
        summary: "Street interview reaction short built for endless scroll feeds."
      }
    ];

    INITIAL_VIDEOS.forEach(v => {
      v.isSampleData = true;
      v.dataOrigin = "sample_demo";
    });
    let VIDEOS = [...INITIAL_VIDEOS];

    let TOPICS = [
      { id: "cs-math", label: "CS & Mathematics", query: "computer science mathematics lecture tutorial" },
      { id: "ai-systems", label: "AI & System Design", query: "AI engineering system design architecture" },
      { id: "indie-tech", label: "Indie Creators & Homelab", query: "homelab linux self hosting robotics build" },
      { id: "science", label: "Physics & Cosmos", query: "astrophysics quantum physics James Webb documentary" },
      { id: "neuro-phil", label: "Neuroscience & Philosophy", query: "neuroscience stoicism philosophy lecture" },
      { id: "econ-society", label: "Economics & Society", query: "macroeconomics finance documentary lecture" },
      { id: "essays-arch", label: "Architecture & Video Essays", query: "architecture video essay cinematography design" },
      { id: "history-docs", label: "History Documentaries", query: "ancient civilization history documentary" },
      { id: "lofi-music", label: "Lofi & Deep Focus Beats", query: "lofi coding beats synthwave focus mix" },
      { id: "viral-hype", label: "Viral Pranks & Drama", query: "viral prank challenge drama shorts" }
    ];

    const PRESETS = {
      deep_learner: {
        id: "deep_learner",
        name: "🧠 Deep Learner",
        tagline: "High rigor, long-form lectures, zero clickbait",
        depth: 90,
        antiClickbait: 92,
        indie: 65,
        longForm: 80,
        novelty: 65,
        minDurationMin: 2,
        blockShorts: true,
        hideOutrage: true,
        topicPrefs: {
          "cs-math": 1,
          "ai-systems": 1,
          "science": 1,
          "neuro-phil": 1,
          "viral-hype": -1
        }
      },
      indie_explorer: {
        id: "indie_explorer",
        name: "🌱 Indie Explorer",
        tagline: "Underrated <500K channels, essays & homelabs",
        depth: 78,
        antiClickbait: 88,
        indie: 98,
        longForm: 65,
        novelty: 92,
        minDurationMin: 5,
        blockShorts: true,
        hideOutrage: true,
        topicPrefs: {
          "indie-tech": 1,
          "essays-arch": 1,
          "viral-hype": -1
        }
      },
      chill_focus: {
        id: "chill_focus",
        name: "🎧 Flow & History",
        tagline: "1hr+ coding beats & civilization documentaries",
        depth: 75,
        antiClickbait: 95,
        indie: 75,
        longForm: 98,
        novelty: 70,
        minDurationMin: 15,
        blockShorts: true,
        hideOutrage: true,
        topicPrefs: {
          "lofi-music": 1,
          "history-docs": 1,
          "viral-hype": -1
        }
      },
      balanced_human: {
        id: "balanced_human",
        name: "⚖️ Balanced Human",
        tagline: "Clean variety across science, essays & economics",
        depth: 70,
        antiClickbait: 75,
        indie: 60,
        longForm: 55,
        novelty: 75,
        minDurationMin: 1,
        blockShorts: true,
        hideOutrage: true,
        topicPrefs: {
          "econ-society": 1,
          "neuro-phil": 1,
          "viral-hype": -1
        }
      },
      corporate_trap: {
        id: "corporate_trap",
        name: "🚨 Corporate Trap (Compare)",
        tagline: "Simulates default YouTube: viral shorts & shock hype",
        depth: 5,
        antiClickbait: 0,
        indie: 0,
        longForm: 5,
        novelty: 10,
        minDurationMin: 0,
        blockShorts: false,
        hideOutrage: false,
        topicPrefs: {
          "viral-hype": 1
        }
      }
    };

    // ============================================================================
    // 2. APPLICATION STATE & SAFE STORAGE
    // ============================================================================
    function safeGetStorage(key) {
      try {
        const sessVal = sessionStorage.getItem(key);
        if (sessVal) return sessVal;
      } catch (err) {}
      try {
        return localStorage.getItem(key) || "";
      } catch (err) {
        return "";
      }
    }
    function safeSetStorage(key, val, persistInLocal = false) {
      try {
        if (val) {
          sessionStorage.setItem(key, val);
        } else {
          sessionStorage.removeItem(key);
        }
      } catch (err) {}
      try {
        if (val && persistInLocal) {
          localStorage.setItem(key, val);
        } else {
          localStorage.removeItem(key);
        }
      } catch (err) {}
    }
    function isKeyPersistedInLocal() {
      try {
        return Boolean(localStorage.getItem("uryt_yt_key") || localStorage.getItem("uryt_gemini_key"));
      } catch (err) {
        return false;
      }
    }

    const state = {
      activeNav: "feed",
      activePreset: "deep_learner",
      selectedCategory: "All",
      searchQuery: "",
      activePromptText: "Prioritize high-depth CS, system design & science lectures; boost indie creators; block shorts & clickbait.",
      parsedDirectives: [
        "🧠 Depth Weight: 90%",
        "🛡️ Anti-Clickbait: 92%",
        "🚫 Shorts (<90s) Blocked",
        "✕ Viral Drama Blocked"
      ],
      showXrayOnCards: true,
      prioritizeLiveVideos: false,
      showSampleData: true,
      enablePersonalization: true,
      explorationSeed: 0,
      algorithms: {
        contentBased: true,
        keywordTopic: true,
        videoSimilarity: true,
        weightedScoring: true,
        noveltyExploration: true,
        diversityReranking: true,
        collaborativeFiltering: true
      },
      weights: {
        relevance: 80,
        depth: 90,
        antiClickbait: 92,
        indie: 65,
        longForm: 80,
        novelty: 65,
        recency: 0,
        popularity: 0,
        minDurationMin: 2,
        baseScore: 18,
        topicBoost: 22,
        creatorBoost: 18,
        keywordBoost: 15,
        liveFreshnessBoost: 8,
        mmrStrength: 32,
        maxPerCreator: 2,
        blockShorts: true,
        hideOutrage: true,
        mmrDiversity: true
      },
      creatorPrefs: {},
      includeKeywords: [],
      excludeKeywords: [],
      topicPrefs: {
        "cs-math": 1,
        "ai-systems": 1,
        "indie-tech": 0,
        "science": 1,
        "neuro-phil": 1,
        "econ-society": 0,
        "essays-arch": 0,
        "history-docs": 0,
        "lofi-music": 0,
        "viral-hype": -1
      },
      savedIds: new Set(),
      manualOverrides: new Set(),
      activeModalVideoId: null,
      isFetchingLive: false,
      refreshCycleIndex: 0,
      lastBatchOrder: 1,
      ytApiKey: safeGetStorage("uryt_yt_key"),
      geminiApiKey: safeGetStorage("uryt_gemini_key"),
      persistKeysInLocal: isKeyPersistedInLocal(),
      serverYoutubeKeyConfigured: false,
      serverGeminiKeyConfigured: false,
      lastFetchStatusCategory: "READY"
    };

    // ============================================================================
    // 3. AUTONOMOUS AI BRAIN (GEMINI 2.5 FLASH) + MULTI-LAYER REAL-TIME YOUTUBE ENGINE
    // ============================================================================
    const PIPED_INSTANCES = [
      "https://pipedapi.kavin.rocks",
      "https://pipedapi.tokhmi.xyz",
      "https://pipedapi.moomoo.me",
      "https://pipedapi.syncpundit.io",
      "https://api.piped.private.coffee",
      "https://pipedapi.drgns.space",
      "https://pipedapi.ducks.party"
    ];

    const INVIDIOUS_INSTANCES = [
      "https://inv.tux.pizza",
      "https://invidious.nerdvpn.de",
      "https://invidious.privacyredirect.com",
      "https://vid.puffyan.us",
      "https://yewtu.be",
      "https://inv.nadeko.net"
    ];

    function formatDurationSec(seconds) {
      const s = Math.max(0, Math.round(seconds || 0));
      const hrs = Math.floor(s / 3600);
      const mins = Math.floor((s % 3600) / 60);
      const secs = s % 60;
      if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      }
      return `${mins}:${String(secs).padStart(2, "0")}`;
    }

    function parseIsoDuration(iso) {
      if (typeof iso !== "string" || !iso) return null;
      if (iso === "P0D") return 0;
      const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
      if (!m) return null;
      const h = parseInt(m[1] || "0", 10);
      const min = parseInt(m[2] || "0", 10);
      const sec = parseInt(m[3] || "0", 10);
      const total = h * 3600 + min * 60 + sec;
      return total > 0 ? total : null;
    }

    function computeHeuristicSignalsForVideo(rawTitle, channelName, durationSec, views, queryLabel, topicId) {
      const title = rawTitle || "Untitled Video";
      const upperCount = (title.match(/[A-Z]/g) || []).length;
      const alphaCount = Math.max(1, (title.match(/[A-Za-z]/g) || []).length);
      const capsRatio = upperCount / alphaCount;
      const hasShockPunct = /[!?]{2,}|🤯|😱|🚨|🤣|🔥/.test(title);
      const hasClickbaitWords = /\b(prank|shocked|gone wrong|gone bad|insane|you won't believe|exposed|drama|blush|overnight|secret)\b/i.test(title);

      let clickbaitIndex = 10;
      if (capsRatio > 0.45) clickbaitIndex += 35;
      if (hasShockPunct) clickbaitIndex += 30;
      if (hasClickbaitWords) clickbaitIndex += 35;
      if (durationSec > 0 && durationSec < 60) clickbaitIndex += 20;
      clickbaitIndex = Math.min(98, Math.max(3, clickbaitIndex));

      const hasDepthWords = /\b(lecture|explained|tutorial|course|architecture|system design|quantum|engineering|documentary|history|philosophy|neuroscience|algorithm|analysis|deep dive|essay|fundamentals|theory|programming)\b/i.test(title);
      let educationalDepth = 68;
      if (hasDepthWords) educationalDepth += 22;
      if (durationSec >= 900) educationalDepth += 8;
      if (clickbaitIndex > 60) educationalDepth -= 40;
      educationalDepth = Math.min(99, Math.max(5, educationalDepth));

      let indieScore = 75;
      if (views > 10000000) indieScore = 25;
      else if (views > 2000000) indieScore = 48;
      else if (views > 500000) indieScore = 72;
      else if (views > 0 && views <= 500000) indieScore = 92;

      const noveltyScore = Math.min(96, Math.max(30, Math.round(educationalDepth * 0.6 + indieScore * 0.35)));
      const hypeIndex = Math.min(99, Math.max(8, Math.round(clickbaitIndex * 0.8 + (views > 5000000 ? 25 : 5))));

      return {
        educationalDepth,
        clickbaitIndex,
        indieScore,
        noveltyScore,
        hypeIndex
      };
    }

    // STEP A: GEMINI AI QUERY PLANNER (Automatically crafts smart YouTube search queries)
    async function callGeminiJsonEndpoint(promptText) {
      if (state.geminiApiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiApiKey)}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });
        if (!resp.ok) return null;
        return await resp.json();
      }
      if (state.serverGeminiKeyConfigured) {
        const proxyEndpoint = `${window.location.origin}/api/gemini-proxy`;
        const resp = await fetch(proxyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: promptText })
        });
        if (!resp.ok) return null;
        return await resp.json();
      }
      return null;
    }

    async function planLiveQueriesWithGemini(userContextPrompt) {
      if (!state.geminiApiKey && !state.serverGeminiKeyConfigured) return null;
      try {
        const boosted = TOPICS.filter(t => state.topicPrefs[t.id] === 1).map(t => t.label).join(", ");
        const blocked = TOPICS.filter(t => state.topicPrefs[t.id] === -1).map(t => t.label).join(", ");
        const w = state.weights;
        const sysPrompt = `You are the autonomous recommendation brain for urYouTube, a user-controlled YouTube platform.
User's current algorithm configuration:
- Natural-Language Prompt / Intent: "${userContextPrompt || state.activePromptText}"
- Boosted Topics: ${boosted || "Any high-value topics"}
- Blocked Topics: ${blocked || "Viral clickbait, pranks"}
- Weights: Educational Depth=${w.depth}%, Anti-Clickbait=${w.antiClickbait}%, Indie Creator Boost=${w.indie}%, Long-Form=${w.longForm}%, Min Duration=${w.minDurationMin} mins.

Generate 3 distinct, highly specific YouTube search queries to fetch fresh, real-time videos that satisfy this user's exact algorithm.
Return ONLY valid JSON with this structure:
{
  "queries": ["specific search query 1", "specific search query 2", "specific search query 3"],
  "categoryLabel": "Short 2-3 Word Category Name",
  "suggestedWeights": {
    "depth": 90,
    "antiClickbait": 92,
    "indie": 75,
    "minDurationMin": 5
  },
  "aiSummaryDirective": "1 short phrase summarizing how AI tuned the feed"
}`;
        const data = await callGeminiJsonEndpoint(sysPrompt);
        if (!data) return null;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text ? JSON.parse(text) : null;
      } catch (e) {
        return null;
      }
    }

    // STEP B: GEMINI AI SEMANTIC VIDEO SCORER & RERANKER
    async function scoreFetchedVideosWithGemini(videosList, userIntent) {
      if ((!state.geminiApiKey && !state.serverGeminiKeyConfigured) || !Array.isArray(videosList) || videosList.length === 0) {
        return videosList;
      }
      try {
        setLiveLoadingState(true, `Gemini AI scoring ${videosList.length} live YouTube videos...`);
        const compactList = videosList.slice(0, 14).map(v => ({
          id: v.id,
          title: sanitizeUntrustedForPrompt(v.title, 120),
          channel: sanitizeUntrustedForPrompt(v.channel, 60),
          durationSec: v.durationSec,
          views: v.views
        }));
        const prompt = `You are the semantic video evaluator for urYouTube.
User's algorithm prompt & preferences: "${userIntent || state.activePromptText}"
Weights: Educational Depth=${state.weights.depth}%, Anti-Clickbait=${state.weights.antiClickbait}%, Indie Boost=${state.weights.indie}%, Long-Form=${state.weights.longForm}%.

Evaluate each of these live-fetched YouTube videos and return a JSON array of objects with:
- "id": video id string
- "educationalDepth": integer 1-99 (how rigorous/educational/insightful)
- "clickbaitIndex": integer 1-99 (how clickbaity/sensational/rage-bait)
- "indieScore": integer 1-99 (how much it represents independent/niche craftsmanship vs mainstream hype)
- "aiReason": concise 5-9 word explanation of why it matches or violates the user's algorithm

Videos to evaluate:
${JSON.stringify(compactList)}`;

        const data = await callGeminiJsonEndpoint(prompt);
        if (!data) return videosList;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return videosList;
        const scoredArray = JSON.parse(text);
        const scoreMap = new Map((Array.isArray(scoredArray) ? scoredArray : []).map(item => [item.id, item]));

        videosList.forEach(v => {
          const aiEval = scoreMap.get(v.id);
          if (aiEval) {
            if (typeof aiEval.educationalDepth === "number") v.educationalDepth = Math.min(99, Math.max(1, aiEval.educationalDepth));
            if (typeof aiEval.clickbaitIndex === "number") v.clickbaitIndex = Math.min(99, Math.max(1, aiEval.clickbaitIndex));
            if (typeof aiEval.indieScore === "number") v.indieScore = Math.min(99, Math.max(1, aiEval.indieScore));
            if (aiEval.aiReason) v.aiReason = aiEval.aiReason;
            v.aiScored = true;
          }
        });
        return videosList;
      } catch (err) {
        return videosList;
      }
    }

    // STEP C: MULTI-TIER REAL-TIME YOUTUBE VIDEO FETCHER
    async function fetchFromOfficialYouTubeApi(searchQuery, categoryLabel, topicId) {
      if (!state.ytApiKey) return [];
      const key = encodeURIComponent(state.ytApiKey);
      const q = encodeURIComponent(searchQuery);
      let durationParam = "";
      if (state.weights.minDurationMin >= 20) durationParam = "&videoDuration=long";
      else if (state.weights.minDurationMin >= 4 || state.weights.blockShorts) durationParam = "&videoDuration=medium";

      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${q}${durationParam}&key=${key}`;
      const searchResp = await fetch(searchUrl);
      if (!searchResp.ok) throw new Error("YT API HTTP " + searchResp.status);
      const searchData = await searchResp.json();
      const items = searchData.items || [];
      const ids = items.map(i => i.id?.videoId).filter(Boolean).join(",");
      if (!ids) return [];

      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet&id=${ids}&key=${key}`;
      const detailsResp = await fetch(detailsUrl);
      const detailsData = detailsResp.ok ? await detailsResp.json() : { items: [] };
      const detailsMap = new Map((detailsData.items || []).map(d => [d.id, d]));

      const batchStamp = ++state.lastBatchOrder;
      return items.map(item => {
        const vidId = item.id?.videoId;
        const d = detailsMap.get(vidId);
        const title = d?.snippet?.title || item.snippet?.title || "YouTube Video";
        const channel = d?.snippet?.channelTitle || item.snippet?.channelTitle || "YouTube Creator";
        const durationSec = d ? parseIsoDuration(d.contentDetails?.duration) : null;
        const rawViews = d?.statistics?.viewCount ? parseInt(d.statistics.viewCount, 10) : null;
        const views = Number.isFinite(rawViews) ? rawViews : null;
        const sigs = computeHeuristicSignalsForVideo(title, channel, durationSec, views, categoryLabel, topicId);
        return {
          id: vidId,
          title,
          channel,
          subscribers: views > 1000000 ? "1M+ Reach" : "Indie / Niche",
          views,
          durationSec,
          durationText: durationSec !== null ? formatDurationSec(durationSec) : "Unknown",
          category: categoryLabel,
          topics: [topicId, "live-fetched"],
          ...sigs,
          isLiveFetched: true,
          batchOrder: batchStamp,
          summary: (d?.snippet?.description || item.snippet?.description || `Fetched live via YouTube Data API v3 for "${searchQuery}".`).slice(0, 160)
        };
      }).filter(v => v.id);
    }

    function parsePipedItems(items, searchQuery, categoryLabel, topicId) {
      const batchStamp = ++state.lastBatchOrder;
      return (items || [])
        .filter(i => i.type === "stream" || (i.url && i.url.includes("watch?v=")))
        .slice(0, 12)
        .map(item => {
          const vidId = (item.url || "").split("v=")[1]?.split("&")[0] || "";
          const durationSec = typeof item.duration === "number" && item.duration > 0 ? item.duration : null;
          const views = typeof item.views === "number" && item.views >= 0 ? item.views : null;
          const sigs = computeHeuristicSignalsForVideo(item.title, item.uploaderName, durationSec, views, categoryLabel, topicId);
          return {
            id: vidId,
            title: item.title || "YouTube Video",
            channel: item.uploaderName || "YouTube Creator",
            subscribers: item.uploaderVerified ? "Verified" : "Creator",
            views,
            durationSec,
            durationText: durationSec !== null ? formatDurationSec(durationSec) : "Unknown",
            category: categoryLabel,
            topics: [topicId, "live-fetched"],
            ...sigs,
            isLiveFetched: true,
            batchOrder: batchStamp,
            summary: item.shortDescription || `Fetched live from YouTube for "${searchQuery}".`
          };
        })
        .filter(v => v.id && v.id.length === 11);
    }

    function parseInvidiousItems(items, searchQuery, categoryLabel, topicId) {
      const batchStamp = ++state.lastBatchOrder;
      return (Array.isArray(items) ? items : [])
        .filter(i => i.videoId && i.title)
        .slice(0, 12)
        .map(item => {
          const vidId = item.videoId || "";
          const durationSec = typeof item.lengthSeconds === "number" && item.lengthSeconds > 0 ? item.lengthSeconds : null;
          const views = typeof item.viewCount === "number" && item.viewCount >= 0 ? item.viewCount : null;
          const sigs = computeHeuristicSignalsForVideo(item.title, item.author, durationSec, views, categoryLabel, topicId);
          return {
            id: vidId,
            title: item.title || "YouTube Video",
            channel: item.author || "YouTube Creator",
            subscribers: "Creator",
            views,
            durationSec,
            durationText: durationSec !== null ? formatDurationSec(durationSec) : "Unknown",
            category: categoryLabel,
            topics: [topicId, "live-fetched"],
            ...sigs,
            isLiveFetched: true,
            batchOrder: batchStamp,
            summary: item.description || `Fetched live from YouTube for "${searchQuery}".`
          };
        })
        .filter(v => v.id && v.id.length === 11);
    }

    async function fetchWithTimeout(url, ms = 4200) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res;
      } catch (e) {
        clearTimeout(timer);
        throw e;
      }
    }

    function parseOfficialSnippetItems(items, searchQuery, categoryLabel, topicId) {
      const batchStamp = ++state.lastBatchOrder;
      return (Array.isArray(items) ? items : [])
        .map(item => {
          const vidId = item?.id?.videoId || "";
          if (!isValidYoutubeId(vidId)) return null;
          const title = item?.snippet?.title || "YouTube Video";
          const channel = item?.snippet?.channelTitle || "YouTube Creator";
          const durationSec = null;
          const views = null;
          const sigs = computeHeuristicSignalsForVideo(title, channel, durationSec, views, categoryLabel, topicId);
          return {
            id: vidId,
            title,
            channel,
            subscribers: "Creator",
            views,
            durationSec,
            durationText: durationSec !== null ? formatDurationSec(durationSec) : "Unknown",
            category: categoryLabel,
            topics: [topicId, "live-fetched"],
            ...sigs,
            isLiveFetched: true,
            batchOrder: batchStamp,
            summary: (item?.snippet?.description || `Fetched live via Server YouTube API for "${searchQuery}".`).slice(0, 160)
          };
        })
        .filter(Boolean);
    }

    async function fetchFromPublicYouTubeMirrors(searchQuery, categoryLabel, topicId) {
      const encodedQ = encodeURIComponent(searchQuery);
      let sawValidEmptyResponse = false;

      // Tier 0: Local Node.js Server Proxy (/api/youtube-search) when running over HTTP/HTTPS
      if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        try {
          const srvRes = await fetchWithTimeout(`${window.location.origin}/api/youtube-search?q=${encodedQ}`, 4200);
          if (srvRes.ok) {
            const srvData = await srvRes.json();
            let parsed = [];
            if (srvData && srvData.source === "server_youtube_api_v3") {
              parsed = parseOfficialSnippetItems(srvData.items, searchQuery, categoryLabel, topicId);
            } else if (srvData && Array.isArray(srvData.items)) {
              parsed = parsePipedItems(srvData.items, searchQuery, categoryLabel, topicId);
            } else if (Array.isArray(srvData)) {
              parsed = parseInvidiousItems(srvData, searchQuery, categoryLabel, topicId);
            }
            if (parsed.length > 0) {
              state.lastFetchStatusCategory = "OK";
              return parsed;
            }
            sawValidEmptyResponse = true;
          }
        } catch (err) {}
      }

      // Tier 1: 7 Public Piped REST API Mirrors
      for (const base of PIPED_INSTANCES) {
        try {
          const res = await fetchWithTimeout(`${base}/search?q=${encodedQ}&filter=videos`, 3800);
          if (!res.ok) continue;
          const data = await res.json();
          if (data && Array.isArray(data.items)) {
            const parsed = parsePipedItems(data.items, searchQuery, categoryLabel, topicId);
            if (parsed.length > 0) {
              state.lastFetchStatusCategory = "OK";
              return parsed;
            }
            sawValidEmptyResponse = true;
          }
        } catch (err) {}
      }

      // Tier 2: 6 Public Invidious REST API Mirrors
      for (const base of INVIDIOUS_INSTANCES) {
        try {
          const res = await fetchWithTimeout(`${base}/api/v1/search?q=${encodedQ}&type=video`, 3800);
          if (!res.ok) continue;
          const data = await res.json();
          if (Array.isArray(data)) {
            const parsed = parseInvidiousItems(data, searchQuery, categoryLabel, topicId);
            if (parsed.length > 0) {
              state.lastFetchStatusCategory = "OK";
              return parsed;
            }
            sawValidEmptyResponse = true;
          }
        } catch (err) {}
      }

      // Tier 3: 3 AllOrigins CORS Raw Failover Targets
      const proxyTargets = [
        `https://pipedapi.kavin.rocks/search?q=${encodedQ}&filter=videos`,
        `https://inv.nadeko.net/api/v1/search?q=${encodedQ}&type=video`,
        `https://invidious.nerdvpn.de/api/v1/search?q=${encodedQ}&type=video`
      ];
      for (const targetUrl of proxyTargets) {
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
          const res = await fetchWithTimeout(proxyUrl, 5000);
          if (!res.ok) continue;
          const data = await res.json();
          const parsed = data && data.items
            ? parsePipedItems(data.items, searchQuery, categoryLabel, topicId)
            : parseInvidiousItems(data, searchQuery, categoryLabel, topicId);
          if (parsed.length > 0) {
            state.lastFetchStatusCategory = "OK";
            return parsed;
          }
          if (data && (Array.isArray(data.items) || Array.isArray(data))) {
            sawValidEmptyResponse = true;
          }
        } catch (err) {}
      }

      state.lastFetchStatusCategory = sawValidEmptyResponse ? "EMPTY_RESULTS" : "UPSTREAM_UNAVAILABLE";
      return [];
    }

    // Master Real-Time Discovery Orchestrator
    async function fetchLiveVideosForQuery(searchQuery, categoryLabel = "Live Discovery", topicId = "custom-live", userIntentForAi = "") {
      if (!searchQuery || !searchQuery.trim()) return 0;
      const cleanQuery = searchQuery.trim();
      setLiveLoadingState(true, `Fetching YouTube live: "${cleanQuery}"...`);
      document.getElementById("telemetryLastQuery").textContent = cleanQuery;

      let fetchedVideos = [];
      let sourceUsed = "Public YouTube Indexer";

      try {
        if (state.ytApiKey) {
          fetchedVideos = await fetchFromOfficialYouTubeApi(cleanQuery, categoryLabel, topicId);
          sourceUsed = "YouTube Data API v3";
          state.lastFetchStatusCategory = fetchedVideos.length > 0 ? "OK" : "EMPTY_RESULTS";
        }
        if (fetchedVideos.length === 0) {
          fetchedVideos = await fetchFromPublicYouTubeMirrors(cleanQuery, categoryLabel, topicId);
          if (fetchedVideos.length > 0) {
            sourceUsed = state.serverYoutubeKeyConfigured
              ? "Server YouTube API / Proxy"
              : state.ytApiKey
              ? "Fallback Live Indexer"
              : "Live Piped/Invidious API";
          } else if (state.lastFetchStatusCategory === "EMPTY_RESULTS") {
            sourceUsed = "Valid Empty Result (0 matches)";
          } else {
            sourceUsed = "Offline Seed Pool (Mirrors Unreachable)";
          }
        }
      } catch (err) {
        fetchedVideos = [];
        state.lastFetchStatusCategory = "UPSTREAM_UNAVAILABLE";
        sourceUsed = "Offline Seed Pool (Mirrors Unreachable)";
      }

      if (fetchedVideos.length > 0 && (state.geminiApiKey || state.serverGeminiKeyConfigured)) {
        fetchedVideos = await scoreFetchedVideosWithGemini(fetchedVideos, userIntentForAi || cleanQuery);
        sourceUsed += " + Gemini AI Scored";
      }

      document.getElementById("telemetryLastSource").textContent = sourceUsed;

      let addedCount = 0;
      const existingMap = new Map(VIDEOS.map(v => [v.id, v]));
      fetchedVideos.forEach(nv => {
        if (!nv.id) return;
        if (existingMap.has(nv.id)) {
          const existing = existingMap.get(nv.id);
          existing.isLiveFetched = true;
          existing.batchOrder = nv.batchOrder;
          existing.category = categoryLabel;
          if (nv.aiReason) existing.aiReason = nv.aiReason;
          if (nv.aiScored) {
            existing.educationalDepth = nv.educationalDepth;
            existing.clickbaitIndex = nv.clickbaitIndex;
            existing.indieScore = nv.indieScore;
            existing.aiScored = true;
          }
          addedCount++;
        } else {
          VIDEOS.unshift(nv);
          existingMap.set(nv.id, nv);
          addedCount++;
        }
      });

      setLiveLoadingState(
        false,
        addedCount > 0
          ? `Fetched ${addedCount} live videos via ${sourceUsed}`
          : `Live pool ready (${VIDEOS.length} videos)`
      );
      renderAll();
      return addedCount;
    }

    function setLiveLoadingState(isLoading, statusMessage) {
      state.isFetchingLive = isLoading;
      const indicator = document.getElementById("liveLoadingIndicator");
      const stepText = document.getElementById("liveLoadingStepText");
      const icon = document.getElementById("refreshBtnIcon");
      const badge = document.getElementById("sidebarFetchBadge");
      const detail = document.getElementById("sidebarFetchDetail");
      const poolLabel = document.getElementById("lastRefreshTimestamp");

      if (isLoading) {
        indicator.classList.remove("hidden");
        indicator.classList.add("inline-flex");
        if (stepText && statusMessage) stepText.textContent = statusMessage;
        icon.classList.add("animate-spin-fast");
        badge.textContent = "FETCHING...";
        badge.className = "text-[10px] font-mono text-cyan-300 bg-cyan-500/20 px-1.5 py-0.5 rounded animate-pulse";
      } else {
        indicator.classList.add("hidden");
        indicator.classList.remove("inline-flex");
        icon.classList.remove("animate-spin-fast");
        badge.textContent = "LIVE SYNCED";
        badge.className = "text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded";
      }
      if (statusMessage && detail) {
        detail.textContent = statusMessage;
      }
      if (poolLabel) {
        const liveCount = VIDEOS.filter(v => v.isLiveFetched).length;
        const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        poolLabel.textContent = `Pool: ${VIDEOS.length} (${liveCount} live) • Synced ${nowStr}`;
      }
    }

    // AUTONOMOUS REFRESH ENGINE
    async function refreshLiveFeedNow() {
      state.refreshCycleIndex++;

      if (state.geminiApiKey) {
        setLiveLoadingState(true, "Gemini AI planning fresh YouTube discovery queries...");
        const plan = await planLiveQueriesWithGemini(state.searchQuery || state.activePromptText);
        if (plan && Array.isArray(plan.queries) && plan.queries.length > 0) {
          const catLabel = plan.categoryLabel || "AI Live Discovery";
          let totalFetched = 0;
          for (const q of plan.queries.slice(0, 2)) {
            const c = await fetchLiveVideosForQuery(q, catLabel, "ai-live", state.activePromptText);
            totalFetched += c;
          }
          if (plan.aiSummaryDirective) {
            state.parsedDirectives.unshift(`✨ ${plan.aiSummaryDirective}`);
          }
          renderAll();
          showToast(
            totalFetched > 0
              ? `Gemini AI fetched & scored ${totalFetched} fresh YouTube videos!`
              : `Gemini AI refreshed & re-ranked your feed!`
          );
          return;
        }
      }

      const boostedTopics = TOPICS.filter(t => state.topicPrefs[t.id] === 1);
      const queryAngles = [
        "deep dive lecture",
        "explained tutorial",
        "documentary analysis",
        "engineering architecture",
        "indie creator project",
        "university lecture"
      ];
      const angle = queryAngles[state.refreshCycleIndex % queryAngles.length];

      let targetQuery = "";
      let targetCategory = "Live Discovery";
      let targetTopicId = "custom-live";

      if (state.searchQuery.trim()) {
        targetQuery = `${state.searchQuery.trim()} ${angle}`;
        targetCategory = state.selectedCategory === "All" ? "Live Search" : state.selectedCategory;
      } else if (boostedTopics.length > 0) {
        const chosenTopic = boostedTopics[state.refreshCycleIndex % boostedTopics.length];
        targetQuery = `${chosenTopic.query || chosenTopic.label} ${angle}`;
        targetCategory = chosenTopic.label;
        targetTopicId = chosenTopic.id;
      } else {
        targetQuery = `computer science physics architecture ${angle}`;
      }

      const added = await fetchLiveVideosForQuery(targetQuery, targetCategory, targetTopicId);
      renderAll();

      if (added > 0) {
        showToast(`Fetched ${added} fresh YouTube videos for "${targetCategory}"!`);
      } else {
        showToast(`Refreshed feed & rotated discovery weights (${VIDEOS.length} videos)!`);
      }
    }

    // ============================================================================
    // 4. MODULAR MULTI-ALGORITHM SCORING & FILTERING ENGINE
    // ============================================================================
    function extractYoutubeVideoId(rawInput) {
      if (typeof rawInput !== "string") return null;
      const trimmed = rawInput.trim();
      if (!trimmed) return null;
      if (isValidYoutubeId(trimmed)) return trimmed;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
          const host = parsed.hostname.toLowerCase();
          if (host === "youtu.be" || host === "www.youtu.be") {
            const seg = parsed.pathname.split("/").filter(Boolean)[0] || "";
            return isValidYoutubeId(seg) ? seg : null;
          }
          if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") {
            const vParam = parsed.searchParams.get("v");
            if (vParam && isValidYoutubeId(vParam)) return vParam;
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
              return isValidYoutubeId(parts[1]) ? parts[1] : null;
            }
          }
          return null;
        } catch (e) {
          return null;
        }
      }
      const m = trimmed.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})(?:[?&/#]|$)/);
      return m && isValidYoutubeId(m[1]) ? m[1] : null;
    }

    function computeSeededExplorationJitter(videoId, seed = 0) {
      const s = Math.max(0, Math.floor(Number(seed) || 0));
      if (s === 0) return 0;
      let h = (s ^ 0x9E3779B9) >>> 0;
      const str = String(videoId || "");
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

    function scoreContentBasedBM25Local(video, queryText, relevanceWeight = 80) {
      const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
      const qTokens = norm(queryText);
      if (qTokens.length === 0 || relevanceWeight <= 0) return 0;
      const docTokens = norm(`${video.title || ""} ${video.category || ""} ${video.summary || ""} ${(video.topics || []).join(" ")}`);
      if (docTokens.length === 0) return 0;
      const freqMap = new Map();
      docTokens.forEach(tok => freqMap.set(tok, (freqMap.get(tok) || 0) + 1));
      const k1 = 1.5, b = 0.75, avgDl = 24, dl = docTokens.length;
      let rawBm25 = 0;
      const uniqueQ = Array.from(new Set(qTokens));
      for (const qt of uniqueQ) {
        let tf = freqMap.get(qt) || 0;
        if (tf === 0) {
          for (const [dt, count] of freqMap.entries()) {
            if (dt.startsWith(qt) || qt.startsWith(dt)) tf += count * 0.6;
          }
        }
        if (tf > 0) {
          rawBm25 += (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
        }
      }
      const normalized = Math.min(1, rawBm25 / Math.max(1.5, uniqueQ.length * 1.1));
      return Number((normalized * 16 * (Math.max(0, Math.min(100, relevanceWeight)) / 100)).toFixed(2));
    }

    function scoreItemSimilarityLocal(video, anchorVideos) {
      if (!Array.isArray(anchorVideos) || anchorVideos.length === 0) return 0;
      let maxSim = 0;
      const candTopics = new Set(Array.isArray(video.topics) ? video.topics : []);
      for (const anc of anchorVideos) {
        if (!anc || anc.id === video.id) continue;
        const tokSim = tokenJaccardSimilarity(`${video.title} ${video.category}`, `${anc.title} ${anc.category}`);
        let topSim = 0;
        if (Array.isArray(anc.topics) && anc.topics.length > 0 && candTopics.size > 0) {
          let shared = 0;
          anc.topics.forEach(t => { if (candTopics.has(t)) shared++; });
          topSim = shared / Math.max(candTopics.size, anc.topics.length);
        }
        const sameCh = (anc.channel || "").toLowerCase() === (video.channel || "").toLowerCase() ? 0.25 : 0;
        const sim = Math.min(1, tokSim * 0.45 + topSim * 0.40 + sameCh);
        if (sim > maxSim) maxSim = sim;
      }
      return Number((maxSim * 12).toFixed(2));
    }

    function scoreHybridCollaborativeLocal(video, interactionVideos, enablePersonalization) {
      if (!enablePersonalization || !Array.isArray(interactionVideos) || interactionVideos.length === 0) return 0;
      const topicAff = new Map();
      const chAff = new Map();
      let avgDepth = 0, avgDur = 0, cnt = 0;
      for (const item of interactionVideos) {
        if (!item || item.id === video.id) continue;
        cnt++;
        (item.topics || []).forEach(t => {
          if (t !== "live-fetched" && t !== "user-added") topicAff.set(t, (topicAff.get(t) || 0) + 1);
        });
        if (item.channel) chAff.set(item.channel.toLowerCase(), (chAff.get(item.channel.toLowerCase()) || 0) + 1);
        avgDepth += (item.educationalDepth || 70);
        avgDur += (item.durationSec || 900);
      }
      if (cnt === 0) return 0;
      avgDepth /= cnt;
      avgDur /= cnt;
      let dot = 0;
      (video.topics || []).forEach(t => {
        if (topicAff.has(t)) dot += Math.min(1.5, topicAff.get(t) / cnt) * 4.5;
      });
      const chKey = (video.channel || "").toLowerCase();
      if (chAff.has(chKey)) dot += Math.min(1.2, chAff.get(chKey) / cnt) * 3.5;
      const depthDiff = Math.abs((video.educationalDepth || 60) - avgDepth) / 100;
      const durDiff = Math.min(1, Math.abs((video.durationSec || 600) - avgDur) / 3600);
      const align = Math.max(0, 1 - (depthDiff * 0.6 + durDiff * 0.4)) * 2.5;
      return Number(Math.min(12, dot + align).toFixed(2));
    }

    function evaluateVideo(video) {
      const w = state.weights;
      const algos = state.algorithms || {
        contentBased: true, keywordTopic: true, videoSimilarity: true,
        weightedScoring: true, noveltyExploration: true, diversityReranking: true, collaborativeFiltering: true
      };
      const reasons = [];
      let blockedReason = null;

      const topics = Array.isArray(video.topics) ? video.topics : [];
      const hasBlockedTopic = algos.keywordTopic && topics.some(t => state.topicPrefs[t] === -1);
      const hasBoostedTopic = algos.keywordTopic && topics.some(t => state.topicPrefs[t] === 1);

      const chLower = String(video.channel || "").toLowerCase().trim();
      const creatorPrefVal = algos.keywordTopic && chLower && state.creatorPrefs ? (state.creatorPrefs[chLower] || 0) : 0;
      const hasBlockedCreator = creatorPrefVal === -1;
      const hasBoostedCreator = creatorPrefVal === 1;

      const fullTextLower = `${video.title || ""} ${video.channel || ""} ${video.summary || ""} ${video.category || ""}`.toLowerCase();
      const matchedExcludeKw = algos.keywordTopic && Array.isArray(state.excludeKeywords)
        ? state.excludeKeywords.find(kw => kw && fullTextLower.includes(kw))
        : null;
      const matchedIncludeKw = algos.keywordTopic && Array.isArray(state.includeKeywords)
        ? state.includeKeywords.find(kw => kw && fullTextLower.includes(kw))
        : null;

      const durationKnown = typeof video.durationSec === "number" && Number.isFinite(video.durationSec) && video.durationSec > 0;

      if (!state.manualOverrides.has(video.id)) {
        if (hasBlockedCreator) {
          blockedReason = "Blocked creator rule (" + (video.channel || "Creator") + ")";
        } else if (matchedExcludeKw) {
          blockedReason = `Excluded keyword rule ("${matchedExcludeKw}")`;
        } else if (hasBlockedTopic) {
          blockedReason = "Blocked topic rule (" + (video.category || "Topic") + ")";
        } else if (w.blockShorts && durationKnown && video.durationSec < 90) {
          blockedReason = "Short clip (<90s) blocked by Shorts Guard";
        } else if (w.minDurationMin > 0 && durationKnown && video.durationSec < w.minDurationMin * 60) {
          blockedReason = `Shorter than your ${w.minDurationMin}m minimum duration rule`;
        } else if (w.hideOutrage && video.clickbaitIndex >= 65) {
          blockedReason = `High Clickbait/Rage-bait index (${video.clickbaitIndex}%) blocked`;
        }
      }

      const weightedActive = algos.weightedScoring !== false;
      const depthContrib = weightedActive ? (video.educationalDepth * (w.depth / 100)) * 0.36 : 0;
      const indieContrib = weightedActive ? (video.indieScore * (w.indie / 100)) * 0.22 : 0;
      const longFormNorm = durationKnown
        ? Math.min(100, Math.round((video.durationSec / 1800) * 100))
        : 40;
      const longFormContrib = weightedActive ? (longFormNorm * (w.longForm / 100)) * 0.18 : 0;
      const noveltyContrib = algos.noveltyExploration !== false ? (video.noveltyScore * (w.novelty / 100)) * 0.16 : 0;
      const explorationJitter = algos.noveltyExploration !== false ? computeSeededExplorationJitter(video.id, state.explorationSeed) : 0;

      const popWeight = Number(w.popularity) || 0;
      const popNorm = typeof video.views === "number" && video.views > 0
        ? Math.min(100, Math.max(1, Math.round((Math.log10(Math.max(10, video.views)) / 9) * 100)))
        : 50;
      const popularityContrib = weightedActive && popWeight !== 0 ? (popNorm * (popWeight / 100)) * 0.14 : 0;

      const recWeight = Number(w.recency) || 0;
      const recNorm = video.isLiveFetched ? 85 : 50;
      const recencyContrib = weightedActive && recWeight > 0 ? (recNorm * (recWeight / 100)) * 0.12 : 0;

      let clickbaitEffect = 0;
      if (state.activePreset === "corporate_trap") {
        clickbaitEffect = (video.hypeIndex || 50) * 0.55;
      } else if (weightedActive) {
        clickbaitEffect = -1 * (video.clickbaitIndex * (w.antiClickbait / 100)) * 0.45;
      }

      let topicBonus = 0;
      if (hasBoostedTopic) topicBonus += Number(w.topicBoost ?? 22);
      if (hasBlockedTopic) topicBonus -= 40;
      if (hasBoostedCreator) topicBonus += Number(w.creatorBoost ?? 18);
      if (hasBlockedCreator) topicBonus -= 50;
      if (matchedIncludeKw) topicBonus += Number(w.keywordBoost ?? 15);
      if (state.prioritizeLiveVideos && video.isLiveFetched) topicBonus += Number(w.liveFreshnessBoost ?? 8);

      const queryContext = state.searchQuery || state.activePromptText || "";
      const contentBm25Contrib = algos.contentBased !== false && queryContext
        ? scoreContentBasedBM25Local(video, queryContext, w.relevance ?? 80)
        : 0;

      const savedVideoObjs = VIDEOS.filter(v => state.savedIds.has(v.id));
      const similarityContrib = algos.videoSimilarity !== false && state.enablePersonalization !== false
        ? scoreItemSimilarityLocal(video, savedVideoObjs)
        : 0;
      const collaborativeContrib = algos.collaborativeFiltering !== false && state.enablePersonalization !== false
        ? scoreHybridCollaborativeLocal(video, savedVideoObjs, state.enablePersonalization !== false)
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
        Number(w.baseScore ?? 18) +
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
      const finalScore = Math.max(1, Math.min(99, Math.round(rawScore)));

      if (video.aiScored) reasons.push("✨ Gemini Scored");
      else if (video.isLiveFetched) reasons.push("⚡ Live Fetched");
      else if (video.isUserAdded) reasons.push("📌 User Added");
      else if (video.isSampleData) reasons.push("📦 Sample Demo");

      if (roundedDepth >= 18) reasons.push(`+${roundedDepth} Depth (${video.aiScored ? "AI" : "Est."})`);
      if (roundedIndie >= 11) reasons.push(`+${roundedIndie} Indie Boost`);
      if (roundedLongForm >= 9 && durationKnown) reasons.push(`+${roundedLongForm} Long-Form`);
      if (hasBoostedTopic) reasons.push(`+${Number(w.topicBoost ?? 22)} Topic Boost`);
      if (hasBoostedCreator) reasons.push(`+${Number(w.creatorBoost ?? 18)} Creator Boost`);
      if (matchedIncludeKw) reasons.push(`+${Number(w.keywordBoost ?? 15)} Keyword Match`);
      if (roundedBm25 >= 4) reasons.push(`+${roundedBm25} BM25 Relevance`);
      if (roundedSimilarity >= 3) reasons.push(`+${roundedSimilarity} Video Similarity`);
      if (roundedCollab >= 3) reasons.push(`+${roundedCollab} Collab Affinity`);
      if (roundedPopularity !== 0) reasons.push(`${roundedPopularity > 0 ? "+" : ""}${roundedPopularity} Popularity`);
      if (roundedRecency >= 3) reasons.push(`+${roundedRecency} Recency`);
      if (roundedClickbait <= -10) reasons.push(`${roundedClickbait} Clickbait Penalty`);
      if (state.activePreset === "corporate_trap" && video.hypeIndex > 70) {
        reasons.push(`+${roundedClickbait} Viral Retention Trap`);
      }
      if (!durationKnown) {
        reasons.push("Duration Unknown");
      }

      return {
        video,
        score: finalScore,
        isBlocked: Boolean(blockedReason),
        blockedReason,
        breakdown: {
          baseConstant: Math.round(Number(w.baseScore ?? 18)),
          depthContrib: roundedDepth,
          indieContrib: roundedIndie,
          longFormContrib: roundedLongForm,
          noveltyContrib: roundedNovelty,
          popularityContrib: roundedPopularity,
          recencyContrib: roundedRecency,
          contentBm25Contrib: roundedBm25,
          similarityContrib: roundedSimilarity,
          collaborativeContrib: roundedCollab,
          explorationJitter: roundedJitter,
          clickbaitEffect: roundedClickbait,
          topicBonus
        },
        reasons
      };
    }

    // ============================================================================
    // 5. NATURAL LANGUAGE PROMPT PARSER + LIVE AI & YOUTUBE ORCHESTRATOR
    // ============================================================================
    async function applyNaturalLanguagePrompt(rawPrompt) {
      const text = (rawPrompt || "").trim();
      if (!text) return;
      const lower = text.toLowerCase();
      const directives = [];

      state.activePreset = "custom";
      state.activePromptText = text;
      state.selectedCategory = "All";
      state.searchQuery = "";
      document.getElementById("videoSearchInput").value = "";

      if (lower.includes("only") || lower.includes("focus on") || lower.includes("compare")) {
        Object.keys(state.topicPrefs).forEach(k => {
          state.topicPrefs[k] = 0;
        });
      }

      if (lower.includes("corporate") || lower.includes("standard") || lower.includes("maximize viral")) {
        applyPreset("corporate_trap", false);
        showToast("Switched to Standard Corporate Feed for comparison!");
        return;
      }

      if (state.geminiApiKey) {
        setLiveLoadingState(true, "Gemini AI translating your prompt into live YouTube queries...");
        const aiPlan = await planLiveQueriesWithGemini(text);
        if (aiPlan) {
          if (aiPlan.suggestedWeights) {
            const sw = aiPlan.suggestedWeights;
            if (typeof sw.depth === "number") state.weights.depth = sw.depth;
            if (typeof sw.antiClickbait === "number") state.weights.antiClickbait = sw.antiClickbait;
            if (typeof sw.indie === "number") state.weights.indie = sw.indie;
            if (typeof sw.minDurationMin === "number") state.weights.minDurationMin = sw.minDurationMin;
          }
          directives.push(aiPlan.aiSummaryDirective ? `✨ ${aiPlan.aiSummaryDirective}` : "✨ Gemini AI Tuned");
          if (Array.isArray(aiPlan.queries) && aiPlan.queries.length > 0) {
            const customSlug = "ai-" + Date.now().toString().slice(-4);
            const catTitle = aiPlan.categoryLabel || "AI Curated";
            TOPICS.unshift({ id: customSlug, label: catTitle, query: aiPlan.queries[0], custom: true });
            state.topicPrefs[customSlug] = 1;
            syncControlsFromState();
            renderAll();
            for (const q of aiPlan.queries.slice(0, 2)) {
              await fetchLiveVideosForQuery(q, catTitle, customSlug, text);
            }
            state.parsedDirectives = directives;
            renderAll();
            showToast(`Gemini AI fetched & scored live YouTube videos for "${catTitle}"!`);
            return;
          }
        }
      }

      if (lower.includes("deep") || lower.includes("lecture") || lower.includes("rigor") || lower.includes("tutorial") || lower.includes("educational")) {
        state.weights.depth = 95;
        directives.push("🧠 Depth Weight → 95%");
      }

      let matchedBuiltInTopic = false;
      if (lower.includes("cs") || lower.includes("computer science") || lower.includes("math") || lower.includes("quantum") || lower.includes("coding") || lower.includes("shader")) {
        state.topicPrefs["cs-math"] = 1;
        directives.push("Boost: CS & Math");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("ai") || lower.includes("system design") || lower.includes("engineering")) {
        state.topicPrefs["ai-systems"] = 1;
        directives.push("Boost: AI & Systems");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("science") || lower.includes("physics") || lower.includes("space") || lower.includes("cosmos") || lower.includes("astrophysics") || lower.includes("james webb")) {
        state.topicPrefs["science"] = 1;
        directives.push("Boost: Physics & Cosmos");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("neuroscience") || lower.includes("brain") || lower.includes("stoic") || lower.includes("philosophy") || lower.includes("psychology")) {
        state.topicPrefs["neuro-phil"] = 1;
        directives.push("Boost: Neuroscience & Philosophy");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("econom") || lower.includes("finance") || lower.includes("macro") || lower.includes("business")) {
        state.topicPrefs["econ-society"] = 1;
        directives.push("Boost: Economics & Society");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("indie") || lower.includes("small creator") || lower.includes("homelab") || lower.includes("self host") || lower.includes("robot")) {
        state.weights.indie = 95;
        state.topicPrefs["indie-tech"] = 1;
        directives.push("🌱 Indie Creator Boost → 95%");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("essay") || lower.includes("architecture") || lower.includes("film")) {
        state.topicPrefs["essays-arch"] = 1;
        directives.push("Boost: Video Essays & Architecture");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("lofi") || lower.includes("music") || lower.includes("beats") || lower.includes("chill") || lower.includes("focus")) {
        state.topicPrefs["lofi-music"] = 1;
        directives.push("Boost: Lofi & Focus Beats");
        matchedBuiltInTopic = true;
      }
      if (lower.includes("history") || lower.includes("documentary") || lower.includes("documentaries") || lower.includes("civilization")) {
        state.topicPrefs["history-docs"] = 1;
        directives.push("Boost: History Documentaries");
        matchedBuiltInTopic = true;
      }

      if (lower.includes("no clickbait") || lower.includes("zero clickbait") || lower.includes("hide viral") || lower.includes("no drama") || lower.includes("no prank")) {
        state.weights.antiClickbait = 98;
        state.weights.hideOutrage = true;
        state.topicPrefs["viral-hype"] = -1;
        directives.push("🛡️ Anti-Clickbait → 98%");
      }
      if (lower.includes("no short") || lower.includes("zero short") || lower.includes("block short")) {
        state.weights.blockShorts = true;
        directives.push("🚫 Shorts Blocked");
      }

      const minMatch = lower.match(/(?:over|above|at least|>)\s*(\d+)\s*(?:m|min|mins|minute|minutes)/);
      if (minMatch) {
        const mins = Math.min(30, parseInt(minMatch[1], 10));
        state.weights.minDurationMin = mins;
        state.weights.longForm = Math.max(state.weights.longForm, 85);
        directives.push(`⏱️ Min Length → ${mins}m`);
      } else if (lower.includes("long")) {
        state.weights.longForm = 90;
        state.weights.minDurationMin = 10;
        directives.push("⏳ Long-Form Priority → 90%");
      }

      if (state.topicPrefs["viral-hype"] !== 1) {
        state.topicPrefs["viral-hype"] = -1;
      }

      const cleanedTopicQuery = text
        .replace(/\b(only|deep|over \d+ mins?|no clickbait|zero clickbait|no shorts|boost|indie|creators|lectures|videos|fetch|show me|i want|small|hide|viral|drama|and|or)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      state.parsedDirectives = directives.length > 0 ? directives : [`🔍 Active Prompt: "${text}"`];
      syncControlsFromState();
      renderAll();

      if (!matchedBuiltInTopic && cleanedTopicQuery.length >= 3) {
        const customId = "custom-" + cleanedTopicQuery.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 18);
        const label = cleanedTopicQuery.charAt(0).toUpperCase() + cleanedTopicQuery.slice(1, 24);
        if (!TOPICS.some(t => t.id === customId)) {
          TOPICS.unshift({ id: customId, label, query: cleanedTopicQuery, custom: true });
        }
        state.topicPrefs[customId] = 1;
        state.parsedDirectives.unshift(`⚡ Live Topic: "${label}"`);
        await fetchLiveVideosForQuery(cleanedTopicQuery, label, customId, text);
      } else if (cleanedTopicQuery.length >= 3) {
        await fetchLiveVideosForQuery(cleanedTopicQuery, "Live Prompt Match", "cs-math", text);
      }
      showToast("Algorithm tuned & live YouTube videos updated!");
    }

    async function addCustomTopicAndFetch(rawTopicName) {
      const clean = (rawTopicName || "").trim();
      if (!clean) return;
      const customId = "topic-" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20);
      const existing = TOPICS.find(t => t.id === customId || t.label.toLowerCase() === clean.toLowerCase());

      let targetTopic = existing;
      if (!targetTopic) {
        targetTopic = {
          id: customId,
          label: clean.charAt(0).toUpperCase() + clean.slice(1),
          query: `${clean} deep dive tutorial explained`,
          custom: true
        };
        TOPICS.unshift(targetTopic);
      }

      state.topicPrefs[targetTopic.id] = 1;
      state.selectedCategory = targetTopic.label;
      state.parsedDirectives.unshift(`+ Custom Niche: ${targetTopic.label}`);
      renderAll();

      const added = await fetchLiveVideosForQuery(targetTopic.query, targetTopic.label, targetTopic.id, clean);
      if (added > 0) {
        showToast(`Added "${targetTopic.label}" & fetched ${added} live YouTube videos!`);
      } else {
        state.selectedCategory = "All";
        state.searchQuery = clean;
        document.getElementById("videoSearchInput").value = clean;
        renderAll();
        showToast(`Added "${targetTopic.label}" topic to your algorithm!`);
      }
    }

    // ============================================================================
    // 6. UI RENDERING FUNCTIONS
    // ============================================================================
    function formatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
      if (num >= 1000) return (num / 1000).toFixed(0) + "K";
      return String(num);
    }

    function applyPreset(presetKey, notify = true) {
      const p = PRESETS[presetKey];
      if (!p) return;
      state.activePreset = presetKey;
      state.weights.depth = p.depth;
      state.weights.antiClickbait = p.antiClickbait;
      state.weights.indie = p.indie;
      state.weights.longForm = p.longForm;
      state.weights.novelty = p.novelty;
      state.weights.minDurationMin = p.minDurationMin;
      state.weights.blockShorts = p.blockShorts;
      state.weights.hideOutrage = p.hideOutrage;

      TOPICS.forEach(t => {
        state.topicPrefs[t.id] = p.topicPrefs[t.id] || 0;
      });

      state.parsedDirectives = [
        `Mode: ${p.name}`,
        `Depth ${p.depth}%`,
        `Anti-Clickbait ${p.antiClickbait}%`,
        `Indie Boost ${p.indie}%`,
        p.blockShorts ? "No Shorts (<90s)" : "Shorts Allowed"
      ];

      syncControlsFromState();
      renderAll();
      if (notify) showToast(`Activated ${p.name} algorithm preset`);
    }

    function syncControlsFromState() {
      const w = state.weights;
      document.getElementById("sliderDepth").value = w.depth;
      document.getElementById("valDepth").textContent = `${w.depth}%`;

      document.getElementById("sliderAntiClickbait").value = w.antiClickbait;
      document.getElementById("valAntiClickbait").textContent = `${w.antiClickbait}%`;

      document.getElementById("sliderIndie").value = w.indie;
      document.getElementById("valIndie").textContent = `${w.indie}%`;

      document.getElementById("sliderLongForm").value = w.longForm;
      document.getElementById("valLongForm").textContent = `${w.longForm}%`;

      document.getElementById("sliderNovelty").value = w.novelty;
      document.getElementById("valNovelty").textContent = `${w.novelty}%`;

      document.getElementById("sliderMinDuration").value = w.minDurationMin;
      document.getElementById("valMinDuration").textContent = `${w.minDurationMin} min${w.minDurationMin === 1 ? "" : "s"}`;

      document.getElementById("blockShortsCheckbox").checked = w.blockShorts;
      document.getElementById("hideOutrageCheckbox").checked = w.hideOutrage;
      document.getElementById("xrayToggleCheckbox").checked = state.showXrayOnCards;
      document.getElementById("prioritizeLiveCheckbox").checked = state.prioritizeLiveVideos;
      const mmrBox = document.getElementById("mmrDiversityCheckbox");
      if (mmrBox) mmrBox.checked = state.weights.mmrDiversity !== false;

      const relSlider = document.getElementById("sliderRelevance");
      if (relSlider) {
        relSlider.value = w.relevance ?? 80;
        document.getElementById("valRelevance").textContent = `${w.relevance ?? 80}%`;
      }
      const popSlider = document.getElementById("sliderPopularity");
      if (popSlider) {
        popSlider.value = w.popularity ?? 0;
        const pv = Number(w.popularity) || 0;
        document.getElementById("valPopularity").textContent = `${pv > 0 ? "+" : ""}${pv}%`;
      }
      const recSlider = document.getElementById("sliderRecency");
      if (recSlider) {
        recSlider.value = w.recency ?? 0;
        document.getElementById("valRecency").textContent = `${w.recency ?? 0}%`;
      }
      const ruleControls = [
        ["sliderBaseScore", "baseScore", "valBaseScore", " pts"],
        ["sliderTopicBoost", "topicBoost", "valTopicBoost", " pts"],
        ["sliderCreatorBoost", "creatorBoost", "valCreatorBoost", " pts"],
        ["sliderKeywordBoost", "keywordBoost", "valKeywordBoost", " pts"],
        ["sliderLiveFreshnessBoost", "liveFreshnessBoost", "valLiveFreshnessBoost", " pts"],
        ["sliderMmrStrength", "mmrStrength", "valMmrStrength", "%"],
        ["sliderMaxPerCreator", "maxPerCreator", "valMaxPerCreator", " / creator"]
      ];
      ruleControls.forEach(([inputId, key, valueId, suffix]) => {
        const input = document.getElementById(inputId);
        const output = document.getElementById(valueId);
        if (input) input.value = Number(w[key] ?? 0);
        if (output) output.textContent = `${Number(w[key] ?? 0)}${suffix}`;
      });

      const seedEl = document.getElementById("explorationSeedInput");
      if (seedEl) seedEl.value = state.explorationSeed || 0;

      const persEl = document.getElementById("enablePersonalizationCheckbox");
      if (persEl) persEl.checked = state.enablePersonalization !== false;
      const sampleEl = document.getElementById("showSampleDataCheckbox");
      if (sampleEl) sampleEl.checked = state.showSampleData !== false;

      const algoMap = {
        algoWeightedScoringCheckbox: "weightedScoring",
        algoContentBasedCheckbox: "contentBased",
        algoKeywordTopicCheckbox: "keywordTopic",
        algoVideoSimilarityCheckbox: "videoSimilarity",
        algoNoveltyExplorationCheckbox: "noveltyExploration",
        algoCollaborativeCheckbox: "collaborativeFiltering"
      };
      for (const [elId, aKey] of Object.entries(algoMap)) {
        const el = document.getElementById(elId);
        if (el && state.algorithms) el.checked = state.algorithms[aKey] !== false;
      }

      const d = (w.depth / 100).toFixed(2);
      const ind = (w.indie / 100).toFixed(2);
      const lf = (w.longForm / 100).toFixed(2);
      const nov = (w.novelty / 100).toFixed(2);
      const ac = (w.antiClickbait / 100).toFixed(2);
      const rel = ((w.relevance ?? 80) / 100).toFixed(2);
      const pop = ((w.popularity ?? 0) / 100).toFixed(2);
      document.getElementById("liveFormulaDisplay").textContent =
        `Score = ${d}·Depth + ${ind}·Indie + ${lf}·LongForm + ${nov}·Novelty + ${rel}·BM25 + ${pop}·Pop − ${ac}·Clickbait + Rules`;

      const presetObj = PRESETS[state.activePreset];
      document.getElementById("currentPresetBadge").textContent =
        presetObj ? `Preset: ${presetObj.name}` : "Preset: Custom User Rules";

      const apiLabel = document.getElementById("apiSourceLabel");
      const modeLabel = document.getElementById("formulaEngineMode");
      const dot = document.getElementById("apiConnectionDot");
      if (state.ytApiKey && state.geminiApiKey) {
        apiLabel.textContent = "YT API v3 + Gemini AI Active";
        modeLabel.textContent = "Autonomous Gemini AI + YT API v3";
        dot.className = "w-2 h-2 rounded-full bg-cyan-400 animate-pulse";
      } else if (state.ytApiKey) {
        apiLabel.textContent = "Official YT API v3 Active";
        modeLabel.textContent = "YouTube Data API v3 Live";
        dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
      } else if (state.geminiApiKey) {
        apiLabel.textContent = "Gemini AI + Live Mirror";
        modeLabel.textContent = "Gemini AI + Live Indexer";
        dot.className = "w-2 h-2 rounded-full bg-cyan-400 animate-pulse";
      } else {
        apiLabel.textContent = "Live Piped + Smart Algo";
        modeLabel.textContent = "Deterministic + Live Fetch";
        dot.className = "w-2 h-2 rounded-full bg-emerald-400";
      }
    }

    function renderPresetsAndTopics() {
      const container = document.getElementById("presetCardsContainer");
      container.innerHTML = Object.values(PRESETS).map(p => {
        const active = state.activePreset === p.id;
        const isTrap = p.id === "corporate_trap";
        return `
          <button
            data-preset-id="${escapeHtml(p.id)}"
            class="preset-btn text-left p-2.5 rounded-xl border transition flex flex-col justify-between ${
              active
                ? isTrap
                  ? "bg-rose-950/60 border-rose-500 text-white shadow-md"
                  : "bg-emerald-500/15 border-emerald-500 text-white shadow-md"
                : "bg-yt-bg/80 border-yt-border hover:border-zinc-600 text-zinc-300"
            }"
          >
            <div class="text-xs font-bold">${escapeHtml(p.name)}</div>
            <div class="text-[11px] text-zinc-400 mt-1 leading-snug">${escapeHtml(p.tagline)}</div>
          </button>
        `;
      }).join("");

      const sideList = document.getElementById("sidebarPresetsList");
      sideList.innerHTML = Object.values(PRESETS).map(p => {
        const active = state.activePreset === p.id;
        return `
          <button
            data-preset-id="${escapeHtml(p.id)}"
            class="preset-btn w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center justify-between ${
              active ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "text-zinc-400 hover:bg-yt-hover hover:text-zinc-200"
            }"
          >
            <span class="truncate">${escapeHtml(p.name)}</span>
            ${active ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>' : ""}
          </button>
        `;
      }).join("");

      const topicContainer = document.getElementById("topicMatrixContainer");
      topicContainer.innerHTML = TOPICS.map(t => {
        const val = state.topicPrefs[t.id] || 0;
        let badgeStyle = "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500";
        let prefix = "•";
        if (val === 1) {
          badgeStyle = "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-semibold";
          prefix = "+ Boosted:";
        } else if (val === -1) {
          badgeStyle = "bg-rose-500/20 border-rose-500/50 text-rose-300 line-through";
          prefix = "✕ Blocked:";
        }
        return `
          <div class="inline-flex items-center rounded-lg border text-xs transition ${badgeStyle}">
            <button
              data-topic-id="${escapeHtml(t.id)}"
              class="topic-toggle-btn px-2.5 py-1 flex items-center gap-1 focus:outline-none"
              title="Click to cycle: Neutral → Boost (+) → Block (✕)"
            >
              <span class="font-mono text-[10px]">${prefix}</span>
              <span>${escapeHtml(t.label)}</span>
            </button>
            <button
              data-remove-topic="${escapeHtml(t.id)}"
              class="remove-topic-btn pr-2 pl-1 py-1 text-zinc-500 hover:text-rose-400 focus:outline-none"
              title="Delete topic from list"
            >
              ×
            </button>
          </div>
        `;
      }).join("");

      const creatorContainer = document.getElementById("creatorMatrixContainer");
      if (creatorContainer && state.creatorPrefs) {
        const entries = Object.entries(state.creatorPrefs).filter(([, v]) => v === 1 || v === -1);
        creatorContainer.innerHTML = entries.map(([ch, val]) => `
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border ${
            val === 1 ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-rose-500/20 border-rose-500/40 text-rose-300 line-through"
          }">
            <span>${val === 1 ? "+ Creator:" : "✕ Creator:"} ${escapeHtml(ch)}</span>
            <button data-remove-creator="${escapeHtml(ch)}" class="remove-creator-btn text-zinc-400 hover:text-white ml-1">×</button>
          </span>
        `).join("");
      }

      const rulesBar = document.getElementById("activeRulesBar");
      rulesBar.innerHTML = state.parsedDirectives.slice(0, 6).map(d => `
        <span class="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
          ${escapeHtml(d)}
        </span>
      `).join("");
    }

    function renderCategoryChips() {
      const dynamicCats = new Set(["All"]);
      if (VIDEOS.some(v => v.isLiveFetched)) {
        dynamicCats.add("⚡ Live Fetched Only");
      }
      VIDEOS.forEach(v => {
        if (v.category) dynamicCats.add(v.category);
      });
      TOPICS.forEach(t => {
        if (t.custom) dynamicCats.add(t.label);
      });

      const bar = document.getElementById("categoryChipsBar");
      bar.innerHTML = Array.from(dynamicCats).map(cat => {
        const active = state.selectedCategory === cat;
        return `
          <button
            data-category="${escapeHtml(cat)}"
            class="cat-chip shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              active
                ? "bg-white text-black font-semibold"
                : "bg-yt-card hover:bg-yt-hover text-zinc-300 border border-yt-border"
            }"
          >
            ${escapeHtml(cat)}
          </button>
        `;
      }).join("");
    }

    function createVideoCardHTML(evaluated, isBlockedCard = false) {
      const { video, score, blockedReason, breakdown, reasons } = evaluated;
      const safeId = isValidYoutubeId(video.id) ? video.id : "RQWpF2Gb-gU";
      const safeTitle = escapeHtml(video.title);
      const safeChannel = escapeHtml(video.channel);
      const safeSubs = escapeHtml(video.subscribers);
      const safeDuration = escapeHtml(video.durationText);
      const safeSummary = escapeHtml(video.summary);
      const safeAiReason = video.aiReason ? escapeHtml(video.aiReason) : "";
      const safeBlockedReason = blockedReason ? escapeHtml(blockedReason) : "";
      const confidencePct = Math.round(computeMetadataConfidence(video) * 100);
      const isSaved = state.savedIds.has(safeId);
      const thumbUrl = `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`;

      const scoreColor =
        score >= 80
          ? "bg-emerald-500 text-black"
          : score >= 60
          ? "bg-cyan-500 text-black"
          : "bg-amber-500 text-black";

      return `
        <article class="group bg-yt-card border ${isBlockedCard ? "border-rose-500/30" : video.isLiveFetched ? "border-emerald-500/40 hover:border-emerald-400" : "border-yt-border hover:border-zinc-600"} rounded-2xl overflow-hidden flex flex-col justify-between transition duration-200 hover:-translate-y-0.5 shadow-lg">
          <div>
            <div class="relative aspect-video bg-zinc-900 overflow-hidden cursor-pointer play-video-trigger" data-video-id="${safeId}">
              <img
                src="${thumbUrl}"
                alt="${safeTitle}"
                loading="lazy"
                class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 opacity-80 group-hover:opacity-60 transition"></div>

              <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5 flex-wrap">
                <span class="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold shadow ${scoreColor}">
                  ${score}% Match
                </span>
                ${
                  video.aiScored
                    ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-purple-950/90 text-purple-300 border border-purple-500/40">✨ AI Ranked</span>'
                    : video.isLiveFetched
                    ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-950/90 text-emerald-300 border border-emerald-500/40">⚡ Live YT</span>'
                    : video.isUserAdded
                    ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-cyan-950/90 text-cyan-300 border border-cyan-500/40">📌 User Added</span>'
                    : video.isSampleData
                    ? '<span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-zinc-900/90 text-amber-300 border border-amber-500/40" title="Included local demonstration sample video">📦 Sample Demo</span>'
                    : ""
                }
              </div>

              <span class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/85 text-white font-mono text-[11px] font-medium">
                ${safeDuration}
              </span>

              <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <div class="w-12 h-12 rounded-full bg-emerald-500/90 text-black flex items-center justify-center shadow-xl">
                  <svg class="w-6 h-6 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
            </div>

            <div class="p-3.5 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-sm font-semibold text-zinc-100 group-hover:text-emerald-400 transition line-clamp-2 leading-snug cursor-pointer play-video-trigger" data-video-id="${safeId}">
                  ${safeTitle}
                </h3>
                <button
                  data-save-id="${safeId}"
                  class="save-queue-btn p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-amber-400 shrink-0 transition"
                  title="${isSaved ? "Remove from Intentional Queue" : "Save to Intentional Queue"}"
                >
                  <svg class="w-4 h-4 ${isSaved ? "fill-amber-400 text-amber-400" : ""}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
                  </svg>
                </button>
              </div>

              <div class="flex items-center justify-between text-xs text-zinc-400">
                <span class="font-medium text-zinc-300 truncate">${safeChannel} <span class="text-zinc-500">(${safeSubs})</span></span>
                <span class="font-mono text-[11px] shrink-0">${formatNumber(video.views)} views</span>
              </div>

              <p class="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                ${safeAiReason ? `<strong class="text-cyan-300">AI:</strong> ${safeAiReason} — ` : ""}${safeSummary}
              </p>
            </div>
          </div>

          <div class="px-3.5 pb-3.5 pt-1">
            ${
              isBlockedCard
                ? `
                <div class="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 space-y-2">
                  <div class="text-[11px] font-mono text-rose-300">
                    <strong>Blocked Why:</strong> ${safeBlockedReason}
                  </div>
                  <button
                    data-override-id="${safeId}"
                    class="override-allow-btn w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
                  >
                    Allow Video Anyway
                  </button>
                </div>
              `
                : state.showXrayOnCards
                ? `
                <div class="p-2.5 rounded-xl bg-yt-bg/90 border border-yt-border space-y-1.5">
                  <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                    <span>Why Recommended (Est. • ${confidencePct}% Conf.)</span>
                    <span class="text-emerald-400">Clickbait: ${Number(video.clickbaitIndex) || 0}%</span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    ${reasons
                      .slice(0, 3)
                      .map(
                        r =>
                          `<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">${escapeHtml(r)}</span>`
                      )
                      .join("")}
                  </div>
                  <div class="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden flex">
                    <div class="bg-emerald-500 h-full" style="width: ${Math.min(100, breakdown.depthContrib * 2)}%" title="Educational Depth"></div>
                    <div class="bg-cyan-400 h-full" style="width: ${Math.min(100, breakdown.indieContrib * 2)}%" title="Indie Boost"></div>
                    <div class="bg-indigo-400 h-full" style="width: ${Math.min(100, breakdown.longFormContrib * 2)}%" title="Long-Form"></div>
                  </div>
                </div>
              `
                : ""
            }
          </div>
        </article>
      `;
    }

    function renderAll() {
      renderPresetsAndTopics();
      renderCategoryChips();

      const evaluatedAll = VIDEOS.map(evaluateVideo);

      const query = state.searchQuery.trim().toLowerCase();
      const matchesSearchAndCat = item => {
        const v = item.video;
        if (state.showSampleData === false && v.isSampleData && !v.isLiveFetched && !v.isUserAdded) {
          return false;
        }
        if (state.selectedCategory === "⚡ Live Fetched Only") {
          if (!v.isLiveFetched) return false;
        } else if (state.selectedCategory !== "All" && v.category !== state.selectedCategory) {
          return false;
        }
        if (query) {
          const hay = `${v.title} ${v.channel} ${v.category} ${v.summary}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      };

      const blockedItems = evaluatedAll.filter(item => item.isBlocked);
      const rawSorted = evaluatedAll
        .filter(item => !item.isBlocked)
        .filter(matchesSearchAndCat)
        .sort((a, b) => {
          // All ranking preferences are represented in the explicit score breakdown.
          // Live results receive no hidden sort precedence or batch-order override.
          if (b.score !== a.score) return b.score - a.score;
          return String(a.video.id).localeCompare(String(b.video.id));
        });
      let visibleItems = applyMmrAndCreatorCap(
        rawSorted,
        state.weights.mmrDiversity !== false,
        state.prioritizeLiveVideos,
        state.refreshCycleIndex,
        state.weights.mmrStrength ?? 32,
        state.weights.maxPerCreator ?? 2
      );

      if (state.activeNav === "saved") {
        visibleItems = evaluatedAll.filter(item => state.savedIds.has(item.video.id));
      }

      document.getElementById("filteredTrapsCountBadge").textContent = blockedItems.length;
      document.getElementById("sidebarBlockedCount").textContent = blockedItems.length;
      document.getElementById("blockedVideoCountInline").textContent = blockedItems.length;
      document.getElementById("visibleVideoCount").textContent = visibleItems.length;
      document.getElementById("sidebarSavedCount").textContent = state.savedIds.size;

      const grid = document.getElementById("videoGridContainer");
      if (visibleItems.length === 0) {
        grid.innerHTML = `
          <div class="col-span-full p-10 rounded-2xl bg-yt-surface border border-yt-border text-center space-y-3">
            <p class="text-base font-bold text-white">No local videos match "${escapeHtml(state.searchQuery || state.selectedCategory)}" yet</p>
            <p class="text-xs text-zinc-400 max-w-md mx-auto">
              Click below to query YouTube live for this exact topic, or relax your minimum duration / topic block rules.
            </p>
            <div class="flex items-center justify-center gap-2 pt-1">
              <button id="emptyStateFetchLiveBtn" class="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-semibold">
                ⚡ Fetch "${escapeHtml(state.searchQuery || state.selectedCategory)}" Live from YouTube
              </button>
              <button id="emptyStateResetBtn" class="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold">
                Reset Filters
              </button>
            </div>
          </div>
        `;
        const fetchBtn = document.getElementById("emptyStateFetchLiveBtn");
        if (fetchBtn) {
          fetchBtn.addEventListener("click", () => {
            const q = state.searchQuery || state.selectedCategory;
            fetchLiveVideosForQuery(q, q, "custom-live", q);
          });
        }
        const resetBtn = document.getElementById("emptyStateResetBtn");
        if (resetBtn) {
          resetBtn.addEventListener("click", () => {
            state.selectedCategory = "All";
            state.searchQuery = "";
            document.getElementById("videoSearchInput").value = "";
            applyPreset("deep_learner");
          });
        }
      } else {
        grid.innerHTML = visibleItems.map(item => createVideoCardHTML(item, false)).join("");
      }

      const blockedGrid = document.getElementById("blockedGridContainer");
      if (blockedItems.length === 0) {
        blockedGrid.innerHTML = `
          <div class="col-span-full p-8 rounded-2xl bg-yt-surface border border-yt-border text-center text-xs text-zinc-400">
            Zero videos are currently blocked. Increase your Anti-Clickbait shield or enable Shorts blocking to filter out attention traps.
          </div>
        `;
      } else {
        blockedGrid.innerHTML = blockedItems.map(item => createVideoCardHTML(item, true)).join("");
      }
    }

    // ============================================================================
    // 7. VIDEO PLAYER MODAL & AUDIT RECEIPT
    // ============================================================================
    function openVideoModal(videoId) {
      const video = VIDEOS.find(v => v.id === videoId);
      if (!video) return;
      const safeModalId = isValidYoutubeId(video.id) ? video.id : "RQWpF2Gb-gU";
      state.activeModalVideoId = safeModalId;
      const evaluated = evaluateVideo(video);

      document.getElementById("modalMatchBadge").textContent = `${evaluated.score}% Algo Match`;
      document.getElementById("modalVideoTitle").textContent = video.title;
      document.getElementById("modalChannelName").textContent = `${video.channel} • ${video.subscribers}`;
      document.getElementById("modalVideoMeta").textContent = `${formatNumber(video.views)} views • Duration ${video.durationText || "Unknown"} • Category: ${video.category}`;
      document.getElementById("modalExternalYoutubeLink").href = sanitizeExternalUrl(`https://www.youtube.com/watch?v=${safeModalId}`);
      document.getElementById("modalYoutubeIframe").src = `https://www.youtube-nocookie.com/embed/${safeModalId}?autoplay=1&rel=0`;

      const aiNote = document.getElementById("modalAiExplanationText");
      if (video.aiReason) {
        aiNote.innerHTML = `<strong class="text-cyan-300">Gemini AI Analysis:</strong> "${escapeHtml(video.aiReason)}"`;
      } else {
        aiNote.textContent = "Observed metadata (duration, view count, channel) is separated from heuristic/AI signal estimates below.";
      }

      const b = evaluated.breakdown;
      const sigSourceTag = video.aiScored ? "AI Verified" : "Heuristic Est.";
      const safeDurationLabel = escapeHtml(video.durationText || "Unknown");
      document.getElementById("modalScoreBreakdown").innerHTML = `
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">🧠 Educational Depth (${sigSourceTag}: ${Number(video.educationalDepth) || 0}/100)</span>
          <span class="font-mono text-emerald-400">+${Number(b.depthContrib) || 0} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">🌱 Indie Creator Signal (${sigSourceTag}: ${Number(video.indieScore) || 0}/100)</span>
          <span class="font-mono text-cyan-400">+${Number(b.indieContrib) || 0} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">⏳ Long-Form Focus (Observed: ${safeDurationLabel})</span>
          <span class="font-mono text-indigo-400">+${Number(b.longFormContrib) || 0} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">🧭 Discovery &amp; Novelty (${sigSourceTag}: ${Number(video.noveltyScore) || 0}/100)</span>
          <span class="font-mono text-purple-400">+${Number(b.noveltyContrib) || 0} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">🎯 Content BM25 &amp; Topic/Creator Rules</span>
          <span class="font-mono text-emerald-300">${(Number(b.contentBm25Contrib) + Number(b.topicBonus)) >= 0 ? "+" : ""}${Number(b.contentBm25Contrib || 0) + Number(b.topicBonus || 0)} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">🤝 Similarity &amp; Collaborative (${state.enablePersonalization !== false ? "Active" : "Stateless Off"})</span>
          <span class="font-mono text-cyan-300">+${Number(b.similarityContrib || 0) + Number(b.collaborativeContrib || 0)} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">📊 Popularity &amp; Recency Influence</span>
          <span class="font-mono text-zinc-300">${(Number(b.popularityContrib || 0) + Number(b.recencyContrib || 0)) >= 0 ? "+" : ""}${Number(b.popularityContrib || 0) + Number(b.recencyContrib || 0)} pts</span>
        </div>
        <div class="flex justify-between items-center py-1.5 border-b border-zinc-800">
          <span class="text-zinc-300">🛡️ Clickbait Index (${sigSourceTag}: ${Number(video.clickbaitIndex) || 0}%)</span>
          <span class="font-mono ${b.clickbaitEffect < 0 ? "text-rose-400" : "text-amber-400"}">${b.clickbaitEffect >= 0 ? "+" : ""}${Number(b.clickbaitEffect) || 0} pts</span>
        </div>
        <div class="flex justify-between items-center pt-1 font-bold text-sm">
          <span class="text-white">Final Transparent Score</span>
          <span class="font-mono text-emerald-400">${Number(evaluated.score) || 0} / 100</span>
        </div>
      `;

      document.getElementById("modalSignalTags").innerHTML = video.topics.map(t => {
        const topicObj = TOPICS.find(x => x.id === t);
        return `<span class="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">${escapeHtml(topicObj ? topicObj.label : t)}</span>`;
      }).join("");

      document.getElementById("videoPlayerModal").classList.remove("hidden");
    }

    function closeVideoModal() {
      document.getElementById("modalYoutubeIframe").src = "";
      document.getElementById("videoPlayerModal").classList.add("hidden");
      state.activeModalVideoId = null;
    }

    function showToast(msg) {
      const banner = document.getElementById("toastBanner");
      document.getElementById("toastMessage").textContent = msg;
      banner.classList.remove("hidden");
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => {
        banner.classList.add("hidden");
      }, 3400);
    }

    // ============================================================================
    // 8. EVENT LISTENERS & INTERACTION WIRING
    // ============================================================================
    function initEventListeners() {
      document.getElementById("sidebarToggleBtn").addEventListener("click", () => {
        const sb = document.getElementById("leftSidebar");
        sb.classList.toggle("hidden");
        sb.classList.toggle("flex");
      });

      document.getElementById("brandHomeBtn").addEventListener("click", () => {
        state.activeNav = "feed";
        state.selectedCategory = "All";
        state.searchQuery = "";
        document.getElementById("videoSearchInput").value = "";
        document.getElementById("blockedVideosSection").classList.add("hidden");
        document.getElementById("videoGridSection").classList.remove("hidden");
        renderAll();
      });

      document.getElementById("refreshLiveFeedBtn").addEventListener("click", () => {
        refreshLiveFeedNow();
      });

      const apiModal = document.getElementById("apiSettingsModal");
      const testStatusBox = document.getElementById("apiTestStatusBox");
      const persistKeysCheckbox = document.getElementById("persistKeysCheckbox");
      document.getElementById("openApiSettingsBtn").addEventListener("click", () => {
        document.getElementById("ytApiKeyInput").value = state.ytApiKey;
        document.getElementById("geminiApiKeyInput").value = state.geminiApiKey;
        if (persistKeysCheckbox) persistKeysCheckbox.checked = Boolean(state.persistKeysInLocal);
        testStatusBox.classList.add("hidden");
        apiModal.classList.remove("hidden");
      });
      document.getElementById("closeApiSettingsBtn").addEventListener("click", () => {
        apiModal.classList.add("hidden");
      });

      document.getElementById("testApiKeysBtn").addEventListener("click", async () => {
        const ytKey = document.getElementById("ytApiKeyInput").value.trim();
        const gemKey = document.getElementById("geminiApiKeyInput").value.trim();
        testStatusBox.classList.remove("hidden");
        testStatusBox.textContent = "Testing live connections...";
        const logs = [];

        if (ytKey) {
          try {
            const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=2&q=quantum+computing&key=${encodeURIComponent(ytKey)}`);
            logs.push(r.ok ? "✓ YouTube Data API v3 Key: VALID & LIVE" : `✕ YouTube Key Error (HTTP ${Number(r.status) || 0})`);
          } catch (e) {
            logs.push("✕ YouTube API unreachable from browser");
          }
        } else if (state.serverYoutubeKeyConfigured) {
          logs.push("✓ YouTube Key: Configured on Server (.env)");
        } else {
          logs.push("• YouTube Key: Not set (Using Zero-Key Public Mirrors)");
        }

        if (gemKey) {
          try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(gemKey)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text: "Reply OK" }] }] })
            });
            logs.push(r.ok ? "✓ Gemini 2.5 Flash Key: VALID & LIVE" : `✕ Gemini Key Error (HTTP ${Number(r.status) || 0})`);
          } catch (e) {
            logs.push("✕ Gemini API unreachable from browser");
          }
        } else if (state.serverGeminiKeyConfigured) {
          logs.push("✓ Gemini Key: Configured on Server (.env)");
        } else {
          logs.push("• Gemini Key: Not set (Using Built-in Heuristic Engine)");
        }

        testStatusBox.innerHTML = logs.map(line => escapeHtml(line)).join("<br/>");
      });

      document.getElementById("saveApiKeysBtn").addEventListener("click", () => {
        state.ytApiKey = document.getElementById("ytApiKeyInput").value.trim();
        state.geminiApiKey = document.getElementById("geminiApiKeyInput").value.trim();
        state.persistKeysInLocal = Boolean(persistKeysCheckbox && persistKeysCheckbox.checked);
        safeSetStorage("uryt_yt_key", state.ytApiKey, state.persistKeysInLocal);
        safeSetStorage("uryt_gemini_key", state.geminiApiKey, state.persistKeysInLocal);
        apiModal.classList.add("hidden");
        syncControlsFromState();
        showToast(state.persistKeysInLocal ? "Saved keys in persistent localStorage." : "Saved keys in safer session-only storage.");
        refreshLiveFeedNow();
      });

      document.getElementById("clearApiKeysBtn").addEventListener("click", () => {
        state.ytApiKey = "";
        state.geminiApiKey = "";
        state.persistKeysInLocal = false;
        safeSetStorage("uryt_yt_key", "", false);
        safeSetStorage("uryt_gemini_key", "", false);
        document.getElementById("ytApiKeyInput").value = "";
        document.getElementById("geminiApiKeyInput").value = "";
        if (persistKeysCheckbox) persistKeysCheckbox.checked = false;
        apiModal.classList.add("hidden");
        syncControlsFromState();
        showToast("Cleared browser keys & switched to Zero-Key Live Mode");
      });

      const tunerDrawer = document.getElementById("tunerDrawer");
      document.getElementById("toggleTunerDrawerBtn").addEventListener("click", () => {
        tunerDrawer.classList.toggle("hidden");
        if (!tunerDrawer.classList.contains("hidden")) {
          tunerDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      document.getElementById("collapseTunerBtn").addEventListener("click", () => {
        tunerDrawer.classList.add("hidden");
      });

      const searchInput = document.getElementById("videoSearchInput");
      const clearSearchBtn = document.getElementById("clearSearchBtn");
      let searchDebounceTimer = null;

      const triggerLiveSearch = async () => {
        clearTimeout(searchDebounceTimer);
        const q = searchInput.value.trim();
        state.searchQuery = q;
        state.selectedCategory = "All";
        renderAll();
        if (q.length >= 2) {
          const added = await fetchLiveVideosForQuery(q, `Search: ${q}`, "custom-live", q);
          if (added > 0) {
            showToast(`Fetched ${added} live YouTube videos for "${q}"!`);
          }
        }
      };

      searchInput.addEventListener("input", e => {
        state.searchQuery = e.target.value;
        clearSearchBtn.classList.toggle("hidden", !state.searchQuery);
        renderAll();
        clearTimeout(searchDebounceTimer);
        if (state.searchQuery.trim().length >= 3) {
          searchDebounceTimer = setTimeout(() => {
            triggerLiveSearch();
          }, 850);
        }
      });
      document.getElementById("searchSubmitBtn").addEventListener("click", triggerLiveSearch);
      searchInput.addEventListener("keydown", e => {
        if (e.key === "Enter") triggerLiveSearch();
      });
      clearSearchBtn.addEventListener("click", () => {
        clearTimeout(searchDebounceTimer);
        searchInput.value = "";
        state.searchQuery = "";
        clearSearchBtn.classList.add("hidden");
        renderAll();
      });

      const newTopicInput = document.getElementById("newTopicInput");
      document.getElementById("addTopicBtn").addEventListener("click", () => {
        addCustomTopicAndFetch(newTopicInput.value);
        newTopicInput.value = "";
      });
      newTopicInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          addCustomTopicAndFetch(newTopicInput.value);
          newTopicInput.value = "";
        }
      });

      const promptInput = document.getElementById("algoPromptInput");
      document.getElementById("applyPromptBtn").addEventListener("click", () => {
        applyNaturalLanguagePrompt(promptInput.value);
      });
      promptInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          applyNaturalLanguagePrompt(promptInput.value);
        }
      });
      document.getElementById("resetAlgoBtn").addEventListener("click", () => {
        promptInput.value = "";
        state.searchQuery = "";
        searchInput.value = "";
        state.selectedCategory = "All";
        state.manualOverrides.clear();
        applyPreset("deep_learner");
      });

      document.querySelectorAll(".sample-prompt-chip").forEach(btn => {
        btn.addEventListener("click", () => {
          const sample = btn.getAttribute("data-sample-prompt");
          promptInput.value = sample;
          applyNaturalLanguagePrompt(sample);
        });
      });

      document.getElementById("xrayToggleCheckbox").addEventListener("change", e => {
        state.showXrayOnCards = e.target.checked;
        renderAll();
      });
      document.getElementById("prioritizeLiveCheckbox").addEventListener("change", e => {
        state.prioritizeLiveVideos = e.target.checked;
        renderAll();
      });

      const bindSlider = (id, key) => {
        document.getElementById(id).addEventListener("input", e => {
          state.weights[key] = parseInt(e.target.value, 10);
          state.activePreset = "custom";
          syncControlsFromState();
          renderAll();
        });
      };
      bindSlider("sliderDepth", "depth");
      bindSlider("sliderAntiClickbait", "antiClickbait");
      bindSlider("sliderIndie", "indie");
      bindSlider("sliderLongForm", "longForm");
      bindSlider("sliderNovelty", "novelty");
      bindSlider("sliderMinDuration", "minDurationMin");
      if (document.getElementById("sliderRelevance")) bindSlider("sliderRelevance", "relevance");
      if (document.getElementById("sliderPopularity")) bindSlider("sliderPopularity", "popularity");
      if (document.getElementById("sliderRecency")) bindSlider("sliderRecency", "recency");
      ["sliderBaseScore", "sliderTopicBoost", "sliderCreatorBoost", "sliderKeywordBoost", "sliderLiveFreshnessBoost", "sliderMmrStrength", "sliderMaxPerCreator"].forEach(id => {
        const el = document.getElementById(id);
        if (el) bindSlider(id, ({
          sliderBaseScore: "baseScore",
          sliderTopicBoost: "topicBoost",
          sliderCreatorBoost: "creatorBoost",
          sliderKeywordBoost: "keywordBoost",
          sliderLiveFreshnessBoost: "liveFreshnessBoost",
          sliderMmrStrength: "mmrStrength",
          sliderMaxPerCreator: "maxPerCreator"
        })[id]);
      });

      const zeroPopBtn = document.getElementById("zeroPopularityBtn");
      if (zeroPopBtn) {
        zeroPopBtn.addEventListener("click", () => {
          state.weights.popularity = 0;
          state.activePreset = "custom";
          syncControlsFromState();
          renderAll();
          showToast("Popularity influence set to 0% (zero view-count bias)");
        });
      }

      const seedInputEl = document.getElementById("explorationSeedInput");
      if (seedInputEl) {
        seedInputEl.addEventListener("input", e => {
          state.explorationSeed = Math.max(0, Math.min(999999, parseInt(e.target.value || "0", 10) || 0));
          renderAll();
        });
      }

      const persCheckboxEl = document.getElementById("enablePersonalizationCheckbox");
      if (persCheckboxEl) {
        persCheckboxEl.addEventListener("change", e => {
          state.enablePersonalization = e.target.checked;
          renderAll();
          showToast(state.enablePersonalization ? "Personalization & interaction learning enabled" : "Stateless Mode: Personalization & automatic learning disabled");
        });
      }

      const sampleCheckboxEl = document.getElementById("showSampleDataCheckbox");
      if (sampleCheckboxEl) {
        sampleCheckboxEl.addEventListener("change", e => {
          state.showSampleData = e.target.checked;
          renderAll();
        });
      }

      const algoCheckboxes = {
        algoWeightedScoringCheckbox: "weightedScoring",
        algoContentBasedCheckbox: "contentBased",
        algoKeywordTopicCheckbox: "keywordTopic",
        algoVideoSimilarityCheckbox: "videoSimilarity",
        algoNoveltyExplorationCheckbox: "noveltyExploration",
        algoCollaborativeCheckbox: "collaborativeFiltering"
      };
      for (const [id, key] of Object.entries(algoCheckboxes)) {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener("change", e => {
            state.algorithms[key] = e.target.checked;
            state.activePreset = "custom";
            syncControlsFromState();
            renderAll();
          });
        }
      }

      // Manual YouTube URL / Video ID Entry Wiring
      const toggleManualBtn = document.getElementById("toggleManualVideoBarBtn");
      const manualSection = document.getElementById("manualVideoFormSection");
      if (toggleManualBtn && manualSection) {
        toggleManualBtn.addEventListener("click", () => {
          manualSection.classList.toggle("hidden");
        });
      }
      const addManualBtn = document.getElementById("addManualVideoSubmitBtn");
      if (addManualBtn) {
        addManualBtn.addEventListener("click", () => {
          const rawUrlOrId = (document.getElementById("manualVideoUrlInput").value || "").trim();
          const vidId = extractYoutubeVideoId(rawUrlOrId);
          if (!vidId) {
            showToast("Invalid YouTube URL or 11-character Video ID.");
            return;
          }
          const rawTitle = (document.getElementById("manualVideoTitleInput").value || "").trim() || `User Added Video (${vidId})`;
          const rawChannel = (document.getElementById("manualVideoChannelInput").value || "").trim() || "User Added Creator";
          const rawMins = Math.max(1, Math.min(600, parseInt(document.getElementById("manualVideoDurationInput").value || "20", 10) || 20));
          const durationSec = rawMins * 60;
          const sigs = computeHeuristicSignalsForVideo(rawTitle, rawChannel, durationSec, 50000, "User Added", "cs-math");
          const newVideo = {
            id: vidId,
            title: rawTitle,
            channel: rawChannel,
            subscribers: "Local Entry",
            views: 50000,
            durationSec,
            durationText: formatDurationSec(durationSec),
            category: "User Added",
            topics: ["cs-math", "user-added"],
            ...sigs,
            isUserAdded: true,
            isSampleData: false,
            isLiveFetched: false,
            dataOrigin: "user_added",
            summary: `Manually added via local URL/ID entry (${vidId}).`
          };
          VIDEOS = [newVideo, ...VIDEOS.filter(v => v.id !== vidId)];
          document.getElementById("manualVideoUrlInput").value = "";
          document.getElementById("manualVideoTitleInput").value = "";
          document.getElementById("manualVideoChannelInput").value = "";
          renderAll();
          showToast(`Added "${rawTitle}" (${vidId}) to your local feed!`);
        });
      }

      // Creator Boost/Block & Keyword Inclusions/Exclusions Wiring
      const creatorInput = document.getElementById("creatorRuleInput");
      const applyCreatorPref = val => {
        if (!creatorInput) return;
        const ch = creatorInput.value.replace(/[<>]/g, "").trim().toLowerCase().slice(0, 60);
        if (!ch) return;
        state.creatorPrefs[ch] = val;
        creatorInput.value = "";
        state.activePreset = "custom";
        renderAll();
        showToast(`${val === 1 ? "Boosted" : "Blocked"} creator "${ch}"`);
      };
      const boostCreatorBtn = document.getElementById("boostCreatorBtn");
      if (boostCreatorBtn) boostCreatorBtn.addEventListener("click", () => applyCreatorPref(1));
      const blockCreatorBtn = document.getElementById("blockCreatorBtn");
      if (blockCreatorBtn) blockCreatorBtn.addEventListener("click", () => applyCreatorPref(-1));

      const incKwInput = document.getElementById("includeKeywordsInput");
      if (incKwInput) {
        incKwInput.addEventListener("input", e => {
          state.includeKeywords = e.target.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
          renderAll();
        });
      }
      const excKwInput = document.getElementById("excludeKeywordsInput");
      if (excKwInput) {
        excKwInput.addEventListener("input", e => {
          state.excludeKeywords = e.target.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
          renderAll();
        });
      }

      document.getElementById("blockShortsCheckbox").addEventListener("change", e => {
        state.weights.blockShorts = e.target.checked;
        state.activePreset = "custom";
        syncControlsFromState();
        renderAll();
      });
      document.getElementById("hideOutrageCheckbox").addEventListener("change", e => {
        state.weights.hideOutrage = e.target.checked;
        state.activePreset = "custom";
        syncControlsFromState();
        renderAll();
      });
      const mmrCheckboxEl = document.getElementById("mmrDiversityCheckbox");
      if (mmrCheckboxEl) {
        mmrCheckboxEl.addEventListener("change", e => {
          state.weights.mmrDiversity = e.target.checked;
          syncControlsFromState();
          renderAll();
        });
      }

      document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
          const nav = btn.getAttribute("data-nav");
          state.activeNav = nav;
          document.querySelectorAll(".nav-item").forEach(b => {
            b.classList.remove("bg-yt-hover", "text-white");
            b.classList.add("text-zinc-400");
          });
          btn.classList.add("bg-yt-hover", "text-white");
          btn.classList.remove("text-zinc-400");

          if (nav === "studio") {
            tunerDrawer.classList.remove("hidden");
            document.getElementById("blockedVideosSection").classList.add("hidden");
            document.getElementById("videoGridSection").classList.remove("hidden");
            tunerDrawer.scrollIntoView({ behavior: "smooth" });
          } else if (nav === "blocked") {
            document.getElementById("blockedVideosSection").classList.remove("hidden");
            document.getElementById("videoGridSection").classList.add("hidden");
          } else {
            document.getElementById("blockedVideosSection").classList.add("hidden");
            document.getElementById("videoGridSection").classList.remove("hidden");
          }
          renderAll();
        });
      });

      document.getElementById("viewBlockedLinkBtn").addEventListener("click", () => {
        document.getElementById("blockedVideosSection").classList.remove("hidden");
        document.getElementById("blockedVideosSection").scrollIntoView({ behavior: "smooth" });
      });
      document.getElementById("backToFeedFromBlockedBtn").addEventListener("click", () => {
        state.activeNav = "feed";
        document.getElementById("blockedVideosSection").classList.add("hidden");
        document.getElementById("videoGridSection").classList.remove("hidden");
        renderAll();
      });

      document.body.addEventListener("click", e => {
        const presetBtn = e.target.closest(".preset-btn");
        if (presetBtn) {
          applyPreset(presetBtn.getAttribute("data-preset-id"));
          return;
        }

        const removeCreatorBtn = e.target.closest(".remove-creator-btn");
        if (removeCreatorBtn) {
          e.stopPropagation();
          const ch = removeCreatorBtn.getAttribute("data-remove-creator");
          if (ch && state.creatorPrefs) delete state.creatorPrefs[ch];
          renderAll();
          return;
        }

        const removeTopicBtn = e.target.closest(".remove-topic-btn");
        if (removeTopicBtn) {
          e.stopPropagation();
          const tid = removeTopicBtn.getAttribute("data-remove-topic");
          const removedObj = TOPICS.find(t => t.id === tid);
          TOPICS = TOPICS.filter(t => t.id !== tid);
          delete state.topicPrefs[tid];
          renderAll();
          if (removedObj) showToast(`Removed topic "${removedObj.label}"`);
          return;
        }

        const topicBtn = e.target.closest(".topic-toggle-btn");
        if (topicBtn) {
          const tid = topicBtn.getAttribute("data-topic-id");
          const current = state.topicPrefs[tid] || 0;
          const next = current === 0 ? 1 : current === 1 ? -1 : 0;
          state.topicPrefs[tid] = next;
          state.activePreset = "custom";
          const tObj = TOPICS.find(t => t.id === tid);
          if (next === 1 && tObj) {
            fetchLiveVideosForQuery(tObj.query || tObj.label, tObj.label, tObj.id, tObj.label);
          }
          renderAll();
          return;
        }

        const catChip = e.target.closest(".cat-chip");
        if (catChip) {
          const cat = catChip.getAttribute("data-category");
          state.selectedCategory = cat;
          renderAll();
          if (cat !== "All" && cat !== "⚡ Live Fetched Only") {
            fetchLiveVideosForQuery(`${cat} lecture documentary tutorial`, cat, "custom-live", cat);
          }
          return;
        }

        const saveBtn = e.target.closest(".save-queue-btn");
        if (saveBtn) {
          e.stopPropagation();
          const vid = saveBtn.getAttribute("data-save-id");
          if (state.savedIds.has(vid)) {
            state.savedIds.delete(vid);
            showToast("Removed from Intentional Queue");
          } else {
            state.savedIds.add(vid);
            showToast("Saved to Intentional Queue");
          }
          renderAll();
          return;
        }

        const overrideBtn = e.target.closest(".override-allow-btn");
        if (overrideBtn) {
          const vid = overrideBtn.getAttribute("data-override-id");
          state.manualOverrides.add(vid);
          showToast("Video manually allowed into your feed");
          renderAll();
          return;
        }

        const playTrigger = e.target.closest(".play-video-trigger");
        if (playTrigger) {
          openVideoModal(playTrigger.getAttribute("data-video-id"));
          return;
        }
      });

      document.getElementById("closePlayerModalBtn").addEventListener("click", closeVideoModal);
      document.getElementById("videoPlayerModal").addEventListener("click", e => {
        if (e.target.id === "videoPlayerModal") closeVideoModal();
      });

      document.getElementById("modalMoreLikeThisBtn").addEventListener("click", () => {
        const video = VIDEOS.find(v => v.id === state.activeModalVideoId);
        if (video) {
          video.topics.forEach(t => {
            state.topicPrefs[t] = 1;
          });
          state.activePreset = "custom";
          fetchLiveVideosForQuery(`${video.title} ${video.channel}`, video.category, video.topics[0] || "custom-live");
          renderAll();
          showToast(`Boosted & fetching more like "${video.title.slice(0, 28)}..."`);
        }
      });

      document.getElementById("modalBlockTopicBtn").addEventListener("click", () => {
        const video = VIDEOS.find(v => v.id === state.activeModalVideoId);
        if (video && video.topics.length > 0) {
          state.topicPrefs[video.topics[0]] = -1;
          state.activePreset = "custom";
          closeVideoModal();
          renderAll();
          showToast(`Blocked ${video.category} from your feed`);
        }
      });

      const modalBlockCreatorBtn = document.getElementById("modalBlockCreatorBtn");
      if (modalBlockCreatorBtn) {
        modalBlockCreatorBtn.addEventListener("click", () => {
          const video = VIDEOS.find(v => v.id === state.activeModalVideoId);
          if (video && video.channel) {
            state.creatorPrefs[video.channel.toLowerCase().trim()] = -1;
            state.activePreset = "custom";
            closeVideoModal();
            renderAll();
            showToast(`Blocked creator "${video.channel}" from your feed`);
          }
        });
      }

      // Open-Source Algorithm Profile JSON Export / Import
      const algoJsonModal = document.getElementById("algoJsonModal");
      const algoJsonTextarea = document.getElementById("algoJsonTextarea");

      const buildExportPayload = () => ({
        platform: "urYouTube Open-Source Algorithm Profile",
        version: "3.3.1",
        exportedAt: new Date().toISOString(),
        activePromptText: state.activePromptText,
        enablePersonalization: state.enablePersonalization,
        explorationSeed: state.explorationSeed,
        algorithms: state.algorithms,
        weights: state.weights,
        topicPrefs: state.topicPrefs,
        creatorPrefs: state.creatorPrefs,
        includeKeywords: state.includeKeywords,
        excludeKeywords: state.excludeKeywords,
        customTopics: TOPICS.filter(t => t.custom)
      });

      const wipeBtn = document.getElementById("wipeAllLocalDataBtn");
      if (wipeBtn) {
        wipeBtn.addEventListener("click", () => {
          try { sessionStorage.clear(); } catch (e) {}
          try { localStorage.clear(); } catch (e) {}
          state.ytApiKey = "";
          state.geminiApiKey = "";
          state.persistKeysInLocal = false;
          state.savedIds.clear();
          state.manualOverrides.clear();
          state.creatorPrefs = {};
          state.includeKeywords = [];
          state.excludeKeywords = [];
          state.topicPrefs = {};
          state.explorationSeed = 0;
          state.enablePersonalization = true;
          state.showSampleData = true;
          state.showXrayOnCards = true;
          state.prioritizeLiveVideos = false;
          state.searchQuery = "";
          state.selectedCategory = "All";
          state.activePromptText = "Prioritize high-depth CS, system design & science lectures; boost indie creators; block shorts & clickbait.";
          state.refreshCycleIndex = 0;
          state.activeModalVideoId = null;
          Object.keys(state.algorithms).forEach(k => { state.algorithms[k] = true; });
          state.weights.relevance = 80;
          state.weights.popularity = 0;
          state.weights.recency = 0;
          state.weights.baseScore = 18;
          state.weights.topicBoost = 22;
          state.weights.creatorBoost = 18;
          state.weights.keywordBoost = 15;
          state.weights.liveFreshnessBoost = 8;
          state.weights.mmrStrength = 32;
          state.weights.maxPerCreator = 2;
          state.weights.mmrDiversity = true;
          // Remove user-created topics as well as preferences; retain built-in topics.
          TOPICS.splice(0, TOPICS.length, ...TOPICS.filter(t => !t.custom));
          VIDEOS = [...INITIAL_VIDEOS];
          if (document.getElementById("includeKeywordsInput")) document.getElementById("includeKeywordsInput").value = "";
          if (document.getElementById("excludeKeywordsInput")) document.getElementById("excludeKeywordsInput").value = "";
          if (document.getElementById("videoSearchInput")) document.getElementById("videoSearchInput").value = "";
          if (document.getElementById("algoPromptInput")) document.getElementById("algoPromptInput").value = state.activePromptText;
          if (document.getElementById("ytApiKeyInput")) document.getElementById("ytApiKeyInput").value = "";
          if (document.getElementById("geminiApiKeyInput")) document.getElementById("geminiApiKeyInput").value = "";
          applyPreset("deep_learner", false);
          algoJsonModal.classList.add("hidden");
          showToast("Wiped all local preferences, interaction history, custom videos, and keys!");
        });
      }

      document.getElementById("exportAlgoJsonBtn").addEventListener("click", () => {
        algoJsonTextarea.value = JSON.stringify(buildExportPayload(), null, 2);
        algoJsonModal.classList.remove("hidden");
      });

      document.getElementById("importAlgoJsonBtn").addEventListener("click", () => {
        algoJsonTextarea.value = JSON.stringify(buildExportPayload(), null, 2);
        algoJsonModal.classList.remove("hidden");
        algoJsonTextarea.focus();
        algoJsonTextarea.select();
      });

      document.getElementById("closeAlgoJsonModalBtn").addEventListener("click", () => {
        algoJsonModal.classList.add("hidden");
      });

      document.getElementById("copyAlgoJsonBtn").addEventListener("click", () => {
        algoJsonTextarea.select();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(algoJsonTextarea.value);
          } else {
            document.execCommand("copy");
          }
        } catch (err) {
          document.execCommand("copy");
        }
        showToast("Copied Algorithm JSON profile to clipboard!");
      });

      document.getElementById("downloadAlgoJsonFileBtn").addEventListener("click", () => {
        const blob = new Blob([algoJsonTextarea.value], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "uryoutube-algorithm-profile.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Downloaded uryoutube-algorithm-profile.json!");
      });

      document.getElementById("applyImportedAlgoJsonBtn").addEventListener("click", () => {
        try {
          const rawStr = algoJsonTextarea.value || "";
          if (rawStr.includes("__proto__") || rawStr.includes("constructor") || rawStr.includes("prototype")) {
            showToast("Rejected unsafe prototype keys in JSON profile.");
            return;
          }
          const parsed = JSON.parse(rawStr);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            showToast("Profile must be a valid JSON object.");
            return;
          }
          if (parsed.weights && typeof parsed.weights === "object") {
            const clampVal = (v, min, max, fb) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fb;
            state.weights.depth = clampVal(parsed.weights.depth, 0, 100, state.weights.depth);
            state.weights.antiClickbait = clampVal(parsed.weights.antiClickbait, 0, 100, state.weights.antiClickbait);
            state.weights.indie = clampVal(parsed.weights.indie, 0, 100, state.weights.indie);
            state.weights.relevance = clampVal(parsed.weights.relevance, 0, 100, state.weights.relevance ?? 80);
            state.weights.longForm = clampVal(parsed.weights.longForm, 0, 100, state.weights.longForm);
            state.weights.novelty = clampVal(parsed.weights.novelty, 0, 100, state.weights.novelty);
            state.weights.recency = clampVal(parsed.weights.recency, 0, 100, state.weights.recency ?? 0);
            state.weights.popularity = clampVal(parsed.weights.popularity, -100, 100, state.weights.popularity ?? 0);
            state.weights.baseScore = clampVal(parsed.weights.baseScore, 0, 50, state.weights.baseScore ?? 18);
            state.weights.topicBoost = clampVal(parsed.weights.topicBoost, 0, 50, state.weights.topicBoost ?? 22);
            state.weights.creatorBoost = clampVal(parsed.weights.creatorBoost, 0, 50, state.weights.creatorBoost ?? 18);
            state.weights.keywordBoost = clampVal(parsed.weights.keywordBoost, 0, 50, state.weights.keywordBoost ?? 15);
            state.weights.liveFreshnessBoost = clampVal(parsed.weights.liveFreshnessBoost, 0, 30, state.weights.liveFreshnessBoost ?? 8);
            state.weights.mmrStrength = clampVal(parsed.weights.mmrStrength, 0, 85, state.weights.mmrStrength ?? 32);
            state.weights.maxPerCreator = clampVal(parsed.weights.maxPerCreator, 1, 10, state.weights.maxPerCreator ?? 2);
            state.weights.minDurationMin = clampVal(parsed.weights.minDurationMin, 0, 30, state.weights.minDurationMin);
            if (typeof parsed.weights.blockShorts === "boolean") state.weights.blockShorts = parsed.weights.blockShorts;
            if (typeof parsed.weights.hideOutrage === "boolean") state.weights.hideOutrage = parsed.weights.hideOutrage;
          }
          if (parsed.algorithms && typeof parsed.algorithms === "object") {
            for (const k of ["contentBased", "keywordTopic", "videoSimilarity", "weightedScoring", "noveltyExploration", "diversityReranking", "collaborativeFiltering"]) {
              if (typeof parsed.algorithms[k] === "boolean") state.algorithms[k] = parsed.algorithms[k];
            }
          }
          if (typeof parsed.enablePersonalization === "boolean") state.enablePersonalization = parsed.enablePersonalization;
          if (typeof parsed.explorationSeed === "number") state.explorationSeed = Math.max(0, Math.min(999999, Math.floor(parsed.explorationSeed)));
          if (parsed.creatorPrefs && typeof parsed.creatorPrefs === "object" && !Array.isArray(parsed.creatorPrefs)) {
            for (const [k, v] of Object.entries(parsed.creatorPrefs)) {
              const cleanK = String(k || "").replace(/[<>]/g, "").trim().toLowerCase().slice(0, 60);
              if (cleanK && (v === -1 || v === 0 || v === 1)) state.creatorPrefs[cleanK] = v;
            }
          }
          if (Array.isArray(parsed.includeKeywords)) {
            state.includeKeywords = parsed.includeKeywords.slice(0, 30).map(s => String(s || "").replace(/[<>]/g, "").trim().toLowerCase().slice(0, 40)).filter(Boolean);
          }
          if (Array.isArray(parsed.excludeKeywords)) {
            state.excludeKeywords = parsed.excludeKeywords.slice(0, 30).map(s => String(s || "").replace(/[<>]/g, "").trim().toLowerCase().slice(0, 40)).filter(Boolean);
          }
          if (parsed.topicPrefs && typeof parsed.topicPrefs === "object" && !Array.isArray(parsed.topicPrefs)) {
            for (const [k, v] of Object.entries(parsed.topicPrefs)) {
              if (/^[a-zA-Z0-9_-]{1,36}$/.test(k) && (v === -1 || v === 0 || v === 1)) {
                state.topicPrefs[k] = v;
              }
            }
          }
          if (Array.isArray(parsed.customTopics)) {
            parsed.customTopics.slice(0, 25).forEach(ct => {
              if (ct && typeof ct === "object" && typeof ct.id === "string" && typeof ct.label === "string") {
                const safeId = ct.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
                const safeLabel = ct.label.replace(/[<>]/g, "").trim().slice(0, 40);
                const safeQuery = typeof ct.query === "string" ? ct.query.replace(/[<>]/g, "").trim().slice(0, 80) : safeLabel;
                if (safeId && safeLabel && !TOPICS.some(t => t.id === safeId)) {
                  TOPICS.unshift({ id: safeId, label: safeLabel, query: safeQuery, custom: true });
                }
              }
            });
          }
          if (typeof parsed.activePromptText === "string") {
            state.activePromptText = parsed.activePromptText.trim().slice(0, 240);
            document.getElementById("algoPromptInput").value = state.activePromptText;
          }
          state.activePreset = "custom";
          state.parsedDirectives.unshift("📦 Imported Community JSON Profile");
          algoJsonModal.classList.add("hidden");
          syncControlsFromState();
          renderAll();
          refreshLiveFeedNow();
          showToast("Applied imported algorithm JSON profile!");
        } catch (err) {
          showToast("Invalid JSON format — please check syntax.");
        }
      });

      // Global Keyboard Shortcuts ('/' focus search, 'r' refresh live feed, 't' toggle equalizer, 'Escape' close modals)
      window.addEventListener("keydown", e => {
        const tag = (e.target.tagName || "").toLowerCase();
        const isTyping = tag === "input" || tag === "textarea";
        if (e.key === "Escape") {
          closeVideoModal();
          apiModal.classList.add("hidden");
          algoJsonModal.classList.add("hidden");
          return;
        }
        if (isTyping) return;
        if (e.key === "/") {
          e.preventDefault();
          searchInput.focus();
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          refreshLiveFeedNow();
        } else if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          tunerDrawer.classList.toggle("hidden");
        }
      });
    }

    async function probeServerConfigStatus() {
      if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return;
      try {
        const res = await fetchWithTimeout(`${window.location.origin}/api/config-status`, 2500);
        if (!res.ok) return;
        const cfg = await res.json();
        state.serverYoutubeKeyConfigured = Boolean(cfg && cfg.serverYoutubeKeyConfigured);
        state.serverGeminiKeyConfigured = Boolean(cfg && cfg.serverGeminiKeyConfigured);
        const banner = document.getElementById("serverConfigStatusBanner");
        if (banner && (state.serverYoutubeKeyConfigured || state.serverGeminiKeyConfigured)) {
          banner.classList.remove("hidden");
          banner.textContent = `Server-side .env credentials active: YouTube=${state.serverYoutubeKeyConfigured ? "YES" : "NO"}, Gemini=${state.serverGeminiKeyConfigured ? "YES" : "NO"} (raw keys remain on server).`;
        }
        syncControlsFromState();
      } catch (e) {}
    }

    window.addEventListener("DOMContentLoaded", () => {
      syncControlsFromState();
      initEventListeners();
      renderAll();
      probeServerConfigStatus();
      setTimeout(() => {
        refreshLiveFeedNow();
      }, 400);
    });
