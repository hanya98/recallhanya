const API_BASE = 'http://localhost:8000';
let allMemories = [];
let currentCategory = 'all';

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  await loadCollections();
  await loadMemories();
  setupCategoryFilters();
});

function setupNavigation() {
  const topbarSearch = document.querySelector('.topbar-search');
  if (topbarSearch) {
    topbarSearch.onclick = () => { window.location.href = 'spotlight.html'; };
  }
}

async function loadCollections() {
  try {
    const res = await fetch(`${API_BASE}/v1/collections`);
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    const navSection = document.querySelectorAll('.sidebar-section')[1];
    if (!navSection) return;

    let html = '<div class="sidebar-section-title">Smart Collections</div>';
    const colors = ['var(--accent)', 'var(--repo)', 'var(--recipe)', 'var(--email)', 'var(--paper)'];

    items.forEach((c, idx) => {
      const color = c.color || colors[idx % colors.length];
      html += `
        <a href="#" class="nav-item collection-item">
          <span class="swatch" style="background: ${color}"></span>
          ${escapeHtml(c.title)}
          <span class="badge">${c.member_count || 0}</span>
        </a>
      `;
    });
    navSection.innerHTML = html;
  } catch(e) {
    console.warn('Could not load collections:', e);
  }
}

async function loadMemories() {
  try {
    const res = await fetch(`${API_BASE}/v1/memories?limit=100`);
    if (!res.ok) return;
    const data = await res.json();
    allMemories = data.items || [];

    updateStats(allMemories.length);
    renderTimeline();
  } catch(e) {
    console.warn('Could not load memories:', e);
  }
}

function updateStats(totalCount) {
  const subDiv = document.querySelector('.page-head .sub');
  if (subDiv) {
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const todayMemories = allMemories.filter(m => isToday(m.visited_at)).length;
    subDiv.innerHTML = `
      <span>${todayStr}</span>
      <span class="dot">·</span>
      <strong>${todayMemories} memories today</strong>
      <span class="dot">·</span>
      <span>${totalCount} total indexed</span>
    `;
  }

  const badgeTimeline = document.querySelector('.nav-item.active .badge');
  if (badgeTimeline) badgeTimeline.textContent = totalCount;
  
  const badgeAll = document.querySelectorAll('.nav-item .badge')[1];
  if (badgeAll) badgeAll.textContent = totalCount;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function setupCategoryFilters() {
  const chips = document.querySelectorAll('.filter-bar .filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const text = chip.textContent.trim().toLowerCase();
      if (text.includes('all')) currentCategory = 'all';
      else if (text.includes('repo')) currentCategory = 'repo';
      else if (text.includes('article')) currentCategory = 'article';
      else if (text.includes('video')) currentCategory = 'video';
      else if (text.includes('paper')) currentCategory = 'paper';
      else if (text.includes('doc')) currentCategory = 'doc';
      else if (text.includes('social')) currentCategory = 'social';
      else currentCategory = 'all';

      renderTimeline();
    });
  });
}

function renderTimeline() {
  const scrollInner = document.querySelector('.scroll-inner');
  if (!scrollInner) return;

  const pageHead = scrollInner.querySelector('.page-head');
  const filterBar = scrollInner.querySelector('.filter-bar');
  
  const children = Array.from(scrollInner.children);
  children.forEach(child => {
    if (child !== pageHead && child !== filterBar) {
      child.remove();
    }
  });

  const filtered = currentCategory === 'all' 
    ? allMemories 
    : allMemories.filter(m => (m.category || '').toLowerCase() === currentCategory);

  if (filtered.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'end-note';
    emptyDiv.textContent = 'No memories found for this filter.';
    scrollInner.appendChild(emptyDiv);
    return;
  }

  const groups = {};
  filtered.forEach(m => {
    const key = getDateLabel(m.visited_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  Object.keys(groups).forEach(dateLabel => {
    const groupItems = groups[dateLabel];
    
    const dayHead = document.createElement('div');
    dayHead.className = 'day-header';
    dayHead.innerHTML = `
      <span class="label">${escapeHtml(dateLabel)}</span>
      <span class="line"></span>
      <span class="meta">${groupItems.length} memories</span>
    `;
    scrollInner.appendChild(dayHead);

    groupItems.forEach(mem => {
      const card = document.createElement('div');
      card.className = 'memory-card';
      
      let domain = mem.domain || '';
      if (!domain && mem.url) {
        try { domain = new URL(mem.url).hostname; } catch(e) {}
      }

      const catColor = getCategoryColor(mem.category);

      card.innerHTML = `
        <div class="time-col">${formatTime(mem.visited_at)}</div>
        <div class="body-col">
          <div class="mem-meta">
            <span class="mem-favicon" style="background:${catColor.bg};color:white;">${(domain[0] || 'W').toUpperCase()}</span>
            <span>${escapeHtml(domain)}</span>
            <span style="color:var(--ink-faint)">·</span>
            <span class="mem-cat" style="background:${catColor.soft};color:${catColor.bg}">
              <span class="cat-dot" style="background:${catColor.bg}"></span>${escapeHtml(mem.category || 'web')}
            </span>
          </div>
          <div class="mem-title">${escapeHtml(mem.title || mem.url)}</div>
          <div class="mem-summary">${escapeHtml(mem.summary || mem.excerpt_clean || '')}</div>
          <div class="mem-tags">
            ${(mem.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}
          </div>
        </div>
        <div class="action-col">
          <button class="open-btn">Open</button>
        </div>
      `;

      card.querySelector('.open-btn').onclick = (e) => {
        e.stopPropagation();
        window.open(mem.url, '_blank');
      };

      card.onclick = () => {
        window.location.href = `memory-detail.html?id=${mem.id}`;
      };

      scrollInner.appendChild(card);
    });
  });

  const endNote = document.createElement('div');
  endNote.className = 'end-note';
  endNote.textContent = `— ${filtered.length} memories displayed —`;
  scrollInner.appendChild(endNote);
}

function getDateLabel(isoStr) {
  if (!isoStr) return 'Recent';
  const d = new Date(isoStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const parts = timeStr.split(' ');
  if (parts.length === 2) {
    return `${parts[0]}<br/><span style="font-size:10px;">${parts[1]}</span>`;
  }
  return timeStr;
}

function getCategoryColor(cat) {
  cat = (cat || '').toLowerCase();
  if (cat === 'repo') return { bg: 'var(--repo)', soft: 'rgba(96,165,250,0.12)' };
  if (cat === 'article') return { bg: 'var(--article)', soft: 'rgba(192,132,252,0.12)' };
  if (cat === 'video') return { bg: 'var(--video)', soft: 'rgba(248,113,113,0.12)' };
  if (cat === 'paper') return { bg: 'var(--paper)', soft: 'rgba(34,211,238,0.12)' };
  if (cat === 'doc') return { bg: 'var(--doc)', soft: 'rgba(52,211,153,0.12)' };
  if (cat === 'social') return { bg: 'var(--social)', soft: 'rgba(244,114,182,0.12)' };
  return { bg: 'var(--accent)', soft: 'rgba(167,139,250,0.12)' };
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
