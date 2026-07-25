const API_BASE = 'http://localhost:8000';

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.querySelector('.search-bar input');
  const resultsContainer = document.querySelector('.results');
  const sessionResumeBox = document.querySelector('.session-resume');
  const totalCountLabel = document.querySelector('.foot-hints .right span:last-child');
  const searchMetaLabel = document.querySelectorAll('.section-label .meta')[0];
  const relatedMetaLabel = document.querySelectorAll('.section-label .meta')[1];

  let debounceTimer;
  let currentMatches = [];
  let selectedIndex = -1; // -1 means Top Match selected, 0..N-1 means related match selected

  async function loadStats() {
    try {
      const res = await fetch(`${API_BASE}/v1/memories?limit=100`);
      if (res.ok) {
        const data = await res.json();
        const total = data.items ? data.items.length : 0;
        if (totalCountLabel) {
          totalCountLabel.textContent = `${total} memories indexed · pgvector search`;
        }
      }
    } catch (e) {
      console.warn('Could not fetch stats:', e);
    }
  }

  loadStats();
  performSearch('');

  async function performSearch(query) {
    if (!query || !query.trim()) {
      try {
        const res = await fetch(`${API_BASE}/v1/memories?limit=6`);
        if (res.ok) {
          const data = await res.json();
          const items = data.items || [];
          renderSearchResults({
            matches: items.map(m => ({
              memory_id: m.id,
              url: m.url,
              domain: m.domain,
              title: m.title,
              summary: m.summary || m.excerpt_clean || m.title,
              category: m.category,
              tags: m.tags || [],
              visited_at: m.visited_at,
              score: 1.0,
            }))
          }, 10);
        }
      } catch(e) {}
      return;
    }

    const startTime = performance.now();
    try {
      const res = await fetch(`${API_BASE}/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 6 })
      });
      const elapsed = Math.round(performance.now() - startTime);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      renderSearchResults(data, elapsed);
    } catch (err) {
      console.error('Search error:', err);
    }
  }

  function renderSearchResults(data, elapsedMs) {
    currentMatches = data.matches || [];
    selectedIndex = -1; // Reset selection to Top Match

    if (searchMetaLabel) {
      searchMetaLabel.textContent = `${elapsedMs}ms · hybrid search`;
    }

    const topMatchSection = document.querySelector('.top-match');

    if (currentMatches.length === 0) {
      if (topMatchSection) topMatchSection.style.display = 'none';
      if (resultsContainer) {
        resultsContainer.replaceChildren();
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding: 24px; color: var(--ink-faint); text-align: center; font-size: 13px;';
        emptyDiv.textContent = 'No memories found matching query';
        resultsContainer.appendChild(emptyDiv);
      }
      if (relatedMetaLabel) relatedMetaLabel.textContent = '0 matches';
      if (sessionResumeBox) sessionResumeBox.style.display = 'none';
      return;
    }

    // 1. Render Top Match Card inside static container
    const top = currentMatches[0];
    if (topMatchSection) {
      topMatchSection.style.display = 'block';
      updateTopMatchCard(topMatchSection, top);
    }

    // 2. Render Related Memories List
    const related = currentMatches.slice(1);
    if (relatedMetaLabel) {
      relatedMetaLabel.textContent = `${related.length} matches`;
    }

    if (resultsContainer) {
      resultsContainer.replaceChildren();
      related.forEach((item, idx) => {
        const row = createResultRow(item, selectedIndex === idx);
        resultsContainer.appendChild(row);
      });
    }

    // 3. Session Resume Block
    if (data.session_resume && data.session_resume.urls && data.session_resume.urls.length > 0 && sessionResumeBox) {
      sessionResumeBox.style.display = 'grid';
      const h4 = sessionResumeBox.querySelector('h4');
      const p = sessionResumeBox.querySelector('p');
      if (h4) h4.textContent = `Context Resume · ${data.session_resume.topic || 'Session'}`;
      if (p) p.textContent = `${data.session_resume.count || data.session_resume.urls.length} tabs related by topic`;
      
      const resumeBtn = sessionResumeBox.querySelector('.resume-btn');
      if (resumeBtn) {
        resumeBtn.onclick = () => {
          data.session_resume.urls.forEach(u => window.open(u, '_blank'));
        };
      }
    } else if (sessionResumeBox) {
      sessionResumeBox.style.display = 'none';
    }

    updateSelectionHighlight();
  }

  function updateSelectionHighlight() {
    const topCard = document.querySelector('.top-match');
    if (topCard) {
      if (selectedIndex === -1) {
        topCard.style.outline = '2px solid var(--accent)';
        topCard.style.outlineOffset = '-1px';
      } else {
        topCard.style.outline = 'none';
      }
    }

    const rows = document.querySelectorAll('.results .result');
    rows.forEach((r, idx) => {
      if (idx === selectedIndex) {
        r.classList.add('active');
      } else {
        r.classList.remove('active');
      }
    });
  }

  // Keyboard navigation
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performSearch(e.target.value);
      }, 200);
    });

    searchInput.addEventListener('keydown', (e) => {
      const maxIdx = Math.max(0, currentMatches.length - 2);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedIndex < maxIdx) {
          selectedIndex++;
          updateSelectionHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedIndex > -1) {
          selectedIndex--;
          updateSelectionHighlight();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const targetMatch = selectedIndex === -1 ? currentMatches[0] : currentMatches[selectedIndex + 1];
        if (targetMatch && targetMatch.url) {
          window.open(targetMatch.url, '_blank');
        }
      } else if (e.key === 'Escape') {
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'RECALLOS_CLOSE_SPOTLIGHT' }, '*');
        }
      }
    });

    searchInput.focus();
  }

  performSearch('');
});

// Component Update & Builder Functions

function updateTopMatchCard(container, top) {
  let domain = top.domain || '';
  if (!domain && top.url) {
    try { domain = new URL(top.url).hostname; } catch(e) {}
  }
  if (!domain) domain = 'web';

  const scorePercent = Math.round((top.score || 0.95) * 100);
  const catColor = getCategoryBgColor(top.category);

  container.replaceChildren();

  // 1. Favicon row
  const faviconRow = document.createElement('div');
  faviconRow.className = 'favicon-row';

  const favicon = document.createElement('span');
  favicon.className = 'favicon';
  favicon.style.background = catColor;
  favicon.style.color = '#fff';
  favicon.textContent = (domain[0] || 'W').toUpperCase();
  faviconRow.appendChild(favicon);

  const domainSpan = document.createElement('span');
  domainSpan.textContent = domain;
  faviconRow.appendChild(domainSpan);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = `${scorePercent}% match`;
  faviconRow.appendChild(badge);

  container.appendChild(faviconRow);

  // 2. Title
  const titleDiv = document.createElement('div');
  titleDiv.className = 'title';
  titleDiv.textContent = top.title || top.url || 'Untitled Memory';
  container.appendChild(titleDiv);

  // 3. Summary
  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'summary';
  const summaryText = top.summary || top.excerpt_clean || top.title || 'No summary available.';
  summaryDiv.textContent = summaryText;
  container.appendChild(summaryDiv);

  // 4. Tags
  const tagsDiv = document.createElement('div');
  tagsDiv.className = 'tags';

  const catTag = document.createElement('span');
  catTag.className = 'tag cat';
  catTag.textContent = top.category || 'web';
  tagsDiv.appendChild(catTag);

  if (Array.isArray(top.tags)) {
    top.tags.slice(0, 5).forEach(t => {
      if (t) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = `#${t.replace(/^#/, '')}`;
        tagsDiv.appendChild(tag);
      }
    });
  }
  container.appendChild(tagsDiv);

  // 5. Actions
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'actions';

  const openBtn = document.createElement('button');
  openBtn.className = 'action-btn primary';
  openBtn.textContent = 'Open ↵';
  openBtn.onclick = (e) => {
    e.stopPropagation();
    if (top.url) window.open(top.url, '_blank');
  };
  actionsDiv.appendChild(openBtn);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'action-btn secondary';
  copyBtn.style.cssText = 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: var(--ink-faint); margin-left: 8px; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;';
  copyBtn.textContent = 'Copy URL';
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    if (top.url) {
      navigator.clipboard.writeText(top.url);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 1500);
    }
  };
  actionsDiv.appendChild(copyBtn);

  container.appendChild(actionsDiv);

  container.onclick = () => {
    if (top.url) window.open(top.url, '_blank');
  };
}

function createResultRow(item, isSelected) {
  const row = document.createElement('div');
  row.className = `result ${isSelected ? 'active' : ''}`;

  let domain = item.domain || '';
  if (!domain && item.url) {
    try { domain = new URL(item.url).hostname; } catch(e) {}
  }
  if (!domain) domain = 'web';

  const cat = (item.category || 'article').toLowerCase();
  const iconDiv = document.createElement('div');
  iconDiv.className = `r-icon ${cat}`;
  iconDiv.textContent = getCategoryEmoji(cat);
  row.appendChild(iconDiv);

  const textCol = document.createElement('div');

  const metaDiv = document.createElement('div');
  metaDiv.className = 'r-meta';
  metaDiv.textContent = `${domain} · ${item.category || 'web'}`;
  textCol.appendChild(metaDiv);

  const titleDiv = document.createElement('div');
  titleDiv.className = 'r-title';
  titleDiv.textContent = item.title || item.url || 'Untitled';
  textCol.appendChild(titleDiv);

  row.appendChild(textCol);

  const timeSpan = document.createElement('span');
  timeSpan.className = 'r-time';
  timeSpan.textContent = formatTime(item.visited_at);
  row.appendChild(timeSpan);

  row.onclick = () => {
    if (item.url) window.open(item.url, '_blank');
  };

  return row;
}

function getCategoryEmoji(cat) {
  cat = (cat || '').toLowerCase();
  if (cat === 'repo') return '⚙';
  if (cat === 'video') return '▶';
  if (cat === 'paper') return '📄';
  if (cat === 'doc') return '📘';
  if (cat === 'recipe') return '🍳';
  if (cat === 'forum' || cat === 'social') return '💬';
  return '🌐';
}

function getCategoryBgColor(cat) {
  cat = (cat || '').toLowerCase();
  if (cat === 'repo') return '#2563eb';
  if (cat === 'video') return '#dc2626';
  if (cat === 'paper') return '#0891b2';
  if (cat === 'doc') return '#059669';
  if (cat === 'social') return '#db2777';
  return '#1f2937';
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
