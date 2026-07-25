// RecallOS Content Script — runs on web pages at document_idle
// Rich metadata extraction for GitHub, YouTube, arXiv, PDFs, Blogs, and StackOverflow.

(function () {
  function extractRichMetadata(url, title) {
    const meta = {
      category: 'other',
      author: null,
      stars: null,
      language: null,
      duration: null,
      readingTime: null,
      abstract: null,
      tags: []
    };

    const host = new URL(url).hostname.toLowerCase();

    // 1. GITHUB
    if (host.includes('github.com')) {
      meta.category = 'repo';
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        meta.repoOwner = parts[0];
        meta.repoName = parts[1];
        meta.tags.push(`repo:${parts[0]}/${parts[1]}`);
      }

      const langEl = document.querySelector('span[itemprop="programmingLanguage"]') ||
                     document.querySelector('.repo-language-color + span');
      if (langEl) {
        meta.language = langEl.innerText.trim();
        meta.tags.push(meta.language.toLowerCase());
      }

      const starEl = document.querySelector('#repo-stars-counter-star') ||
                     document.querySelector('a[href*="/stargazers"] span');
      if (starEl) {
        meta.stars = starEl.innerText.trim();
      }
    }

    // 2. YOUTUBE
    else if (host.includes('youtube.com') || host.includes('youtu.be')) {
      meta.category = 'video';
      const channelEl = document.querySelector('link[itemprop="name"]') ||
                        document.querySelector('ytd-channel-name a') ||
                        document.querySelector('#channel-name a');
      if (channelEl) {
        meta.author = channelEl.getAttribute('content') || channelEl.innerText.trim();
      }

      const durMeta = document.querySelector('meta[itemprop="duration"]');
      if (durMeta) {
        meta.duration = durMeta.content;
      }
      meta.tags.push('video', 'youtube');
    }

    // 3. ARXIV
    else if (host.includes('arxiv.org')) {
      meta.category = 'paper';
      const authorsEl = document.querySelector('.authors');
      if (authorsEl) {
        meta.author = authorsEl.innerText.replace(/^Authors:\s*/i, '').trim();
      }
      const abstractEl = document.querySelector('.abstract');
      if (abstractEl) {
        meta.abstract = abstractEl.innerText.replace(/^Abstract:\s*/i, '').trim();
      }
      meta.tags.push('paper', 'arxiv');
    }

    // 4. MEDIUM / BLOGS
    else if (host.includes('medium.com') || document.querySelector('meta[property="og:type"][content="article"]')) {
      meta.category = 'article';
      const authorEl = document.querySelector('meta[name="author"]') ||
                       document.querySelector('a[rel="author"]');
      if (authorEl) {
        meta.author = authorEl.content || authorEl.innerText.trim();
      }
      const readTimeEl = document.querySelector('.pw-reading-time') ||
                         document.querySelector('meta[name="twitter:data1"]');
      if (readTimeEl) {
        meta.readingTime = readTimeEl.content || readTimeEl.innerText.trim();
      }
      meta.tags.push('article', 'blog');
    }

    // 5. STACK OVERFLOW
    else if (host.includes('stackoverflow.com') || host.includes('stackexchange.com')) {
      meta.category = 'forum';
      const tagEls = document.querySelectorAll('.post-tag');
      tagEls.forEach(t => meta.tags.push(t.innerText.trim()));
      meta.tags.push('stackoverflow', 'q&a');
    }

    return meta;
  }

  function extractPayload(isManual = false) {
    try {
      if (window !== window.top) return null;

      const url = location.href || '';
      if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('blob:')) {
        return null;
      }

      const ct = document.contentType || '';
      if (ct.startsWith('image/')) return null;

      const title = (document.title || '').trim();
      if (!title) return null;

      // Extract visible text
      let text = '';
      if (document.body) {
        const clone = document.body.cloneNode(true);
        const junk = clone.querySelectorAll(
          'script, style, nav, header, footer, aside, [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"], noscript, iframe, svg'
        );
        junk.forEach(n => n.remove());
        text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
      }

      // Metadata & SPA Headings fallback
      const metaDesc = document.querySelector('meta[name="description"]')?.content ||
                       document.querySelector('meta[property="og:description"]')?.content || '';
      const headings = Array.from(document.querySelectorAll('h1, h2')).map(h => h.innerText.trim()).filter(Boolean).join('. ');

      const richMeta = extractRichMetadata(url, title);

      if (text.length < 50) {
        text = `${title}. ${headings}. ${metaDesc}. ${richMeta.abstract || ''}`.trim();
      }

      if (text.length < 20 && !isManual) return null;

      const textSnippet = text.slice(0, 4000);

      const favicon =
        document.querySelector('link[rel*="icon"]')?.href ||
        `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;

      return {
        url,
        title,
        excerpt: textSnippet || title,
        faviconUrl: favicon,
        contentType: ct || 'text/html',
        wordCount: (textSnippet || title).split(/\s+/).length,
        language: richMeta.language || document.documentElement.lang || null,
        force: isManual,
        richMetadata: richMeta
      };
    } catch (err) {
      console.warn('[RecallOS Content] Extraction error:', err);
      return null;
    }
  }

  function extractAndSend(isManual = false) {
    const payload = extractPayload(isManual);
    if (payload) {
      console.log('[RecallOS Content] Sending capture payload:', payload.url);
      chrome.runtime.sendMessage({ type: 'RECALLOS_CAPTURE', payload });
    }
    return payload;
  }

  // Auto extract on idle
  setTimeout(() => extractAndSend(false), 500);

  // Listen for manual trigger from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'RECALLOS_TRIGGER_EXTRACTION') {
      const payload = extractAndSend(true);
      if (payload) {
        sendResponse({ ok: true, payload });
      } else {
        sendResponse({ ok: false, reason: 'Restricted page or missing content' });
      }
    }
    return true;
  });
})();
