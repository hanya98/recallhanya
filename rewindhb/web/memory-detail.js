const API_BASE = 'http://localhost:8000';

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  
  const urlParams = new URLSearchParams(window.location.search);
  let memoryId = urlParams.get('id');

  if (!memoryId) {
    try {
      const res = await fetch(`${API_BASE}/v1/memories?limit=1`);
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          memoryId = data.items[0].id;
        }
      }
    } catch(e) {}
  }

  if (memoryId) {
    await loadMemoryDetail(memoryId);
  }
});

function setupNavigation() {
  const backBtn = document.querySelector('.back-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = 'dashboard-timeline.html';
    };
  }
}

async function loadMemoryDetail(id) {
  try {
    const res = await fetch(`${API_BASE}/v1/memories/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mem = await res.json();

    renderMemoryDetail(mem);
  } catch (err) {
    console.error('Error loading memory detail:', err);
  }
}

function renderMemoryDetail(mem) {
  document.title = `Memory · ${mem.title || 'Detail'} · RecallOS`;

  let domain = mem.domain || '';
  if (!domain && mem.url) {
    try { domain = new URL(mem.url).hostname; } catch(e) {}
  }

  const sourceDiv = document.querySelector('.mem-source');
  if (sourceDiv) {
    sourceDiv.querySelector('.mem-favicon').textContent = (domain[0] || 'M').toUpperCase();
    const urlA = sourceDiv.querySelector('.url');
    urlA.textContent = mem.url;
    urlA.href = mem.url;
    urlA.target = '_blank';
    sourceDiv.querySelector('.mem-cat-pill').textContent = mem.category || 'web';
  }

  const titleH1 = document.querySelector('.mem-title');
  if (titleH1) titleH1.textContent = mem.title || mem.url;

  const breadcrumbCurrent = document.querySelector('.breadcrumb .current');
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = mem.title || 'Memory';

  const metaRow = document.querySelector('.mem-meta-row');
  if (metaRow) {
    const visitedDate = mem.visited_at ? new Date(mem.visited_at).toLocaleString() : 'Recent';
    metaRow.innerHTML = `
      <span>Indexed: ${visitedDate}</span>
      <span>Category: ${escapeHtml(mem.category || 'web')}</span>
      ${mem.word_count ? `<span>Word count: ${mem.word_count} words</span>` : ''}
    `;
  }

  const btnOpen = document.querySelectorAll('.action-bar .btn')[0];
  if (btnOpen) {
    btnOpen.onclick = () => window.open(mem.url, '_blank');
  }

  const btnDelete = document.querySelector('.action-bar .btn.ghost');
  if (btnDelete) {
    btnDelete.onclick = async () => {
      if (confirm('Are you sure you want to delete this memory?')) {
        try {
          await fetch(`${API_BASE}/v1/memories/${mem.id}`, { method: 'DELETE' });
          alert('Memory deleted');
          window.location.href = 'dashboard-timeline.html';
        } catch(e) {
          alert('Failed to delete memory');
        }
      }
    };
  }

  const summaryP = document.querySelector('.summary-card p');
  if (summaryP) {
    summaryP.innerHTML = escapeHtml(mem.summary || mem.excerpt_clean || 'No summary generated yet.');
  }

  const excerptP = document.querySelector('.excerpt p');
  if (excerptP) {
    excerptP.textContent = mem.excerpt_clean || mem.excerpt_raw || 'No excerpt body available.';
  }

  const tagsRow = document.querySelector('.tags-row');
  if (tagsRow) {
    tagsRow.innerHTML = (mem.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
  }

  const metaCells = document.querySelectorAll('.meta-grid .meta-cell .v');
  if (metaCells.length >= 4) {
    metaCells[0].textContent = (mem.id || '').slice(0, 8) + '...';
    metaCells[1].textContent = '1536-dim';
    metaCells[2].textContent = 'text-emb-3-s';
    metaCells[3].textContent = mem.category || 'general';
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
