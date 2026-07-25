const API_BASE = 'http://localhost:8000';

document.addEventListener('DOMContentLoaded', () => {
  loadGraph();
});

async function loadGraph() {
  try {
    const res = await fetch(`${API_BASE}/v1/graph`);
    if (!res.ok) return;
    const data = await res.json();
    renderGraph(data.nodes || [], data.edges || []);
  } catch (err) {
    console.error('Failed to load graph:', err);
  }
}

function renderGraph(nodes, edges) {
  const svg = document.getElementById('graphSvg');
  if (!svg) return;

  const statValues = document.querySelectorAll('.stats .stat .v');
  if (statValues.length >= 4) {
    statValues[0].textContent = nodes.length;
    statValues[1].textContent = edges.length;
    
    const categories = new Set(nodes.map(n => n.category || 'other'));
    statValues[2].textContent = categories.size;
    statValues[3].textContent = nodes.length > 0 ? (edges.length / (nodes.length * (nodes.length - 1) / 2 || 1)).toFixed(2) : '0.00';
  }

  const legend = document.querySelector('.legend');
  if (legend && nodes.length > 0) {
    const catCounts = {};
    nodes.forEach(n => {
      const c = n.category || 'other';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });

    let legendHtml = '<h5>Categories</h5>';
    Object.keys(catCounts).forEach(cat => {
      const color = getCatColor(cat);
      legendHtml += `
        <div class="legend-row">
          <span class="dot" style="background: ${color}"></span>
          ${escapeHtml(cat)}
          <span class="count">${catCounts[cat]}</span>
        </div>
      `;
    });
    legend.innerHTML = legendHtml;
  }

  if (nodes.length === 0) return;

  const width = 900;
  const height = 700;
  const centerX = width / 2;
  const centerY = height / 2;

  const nodePos = {};
  const catCenters = {
    repo: { x: 650, y: 180 },
    paper: { x: 220, y: 200 },
    article: { x: 750, y: 520 },
    video: { x: 160, y: 540 },
    doc: { x: 480, y: 540 },
    other: { x: 450, y: 350 }
  };

  nodes.forEach((node, i) => {
    const cat = (node.category || 'other').toLowerCase();
    const center = catCenters[cat] || { x: centerX + (i % 3) * 100 - 100, y: centerY + Math.floor(i / 3) * 100 - 100 };
    
    const angle = (i * 2.4);
    const radius = 30 + (i % 5) * 20;
    const x = Math.max(50, Math.min(850, center.x + radius * Math.cos(angle)));
    const y = Math.max(80, Math.min(650, center.y + radius * Math.sin(angle)));
    
    nodePos[node.id] = { x, y, node };
  });

  let svgContent = `
    <defs>
      <radialGradient id="node-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(167,139,250,0.4)"/>
        <stop offset="100%" stop-color="rgba(167,139,250,0)"/>
      </radialGradient>
    </defs>
  `;

  edges.forEach(e => {
    const p1 = nodePos[e.source];
    const p2 = nodePos[e.target];
    if (p1 && p2) {
      svgContent += `<line class="edge" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke-width="${Math.max(1, e.weight * 2)}"/>`;
    }
  });

  Object.keys(nodePos).forEach(id => {
    const { x, y, node } = nodePos[id];
    const color = getCatColor(node.category);
    const r = Math.min(16, Math.max(8, (node.size || 5) + 3));
    
    svgContent += `
      <g class="node" data-id="${id}" transform="translate(${x}, ${y})">
        <circle class="node-circle" r="${r}" fill="${color}" />
        <text class="node-label" y="${r + 14}">${escapeHtml(node.title.slice(0, 15))}</text>
      </g>
    `;
  });

  svg.innerHTML = svgContent;

  svg.querySelectorAll('.node').forEach(g => {
    g.onclick = async () => {
      const id = g.getAttribute('data-id');
      await inspectMemory(id);
    };
  });

  if (nodes.length > 0) {
    inspectMemory(nodes[0].id);
  }
}

async function inspectMemory(id) {
  const inspector = document.querySelector('.inspector');
  if (!inspector) return;

  try {
    const res = await fetch(`${API_BASE}/v1/memories/${id}`);
    if (!res.ok) return;
    const mem = await res.json();

    let domain = mem.domain || '';
    if (!domain && mem.url) {
      try { domain = new URL(mem.url).hostname; } catch(e) {}
    }

    inspector.innerHTML = `
      <div class="ins-head">
        <div class="favicon" style="background:${getCatColor(mem.category)};color:white;">${(domain[0] || 'M').toUpperCase()}</div>
        <div class="meta">
          <div class="url">${escapeHtml(mem.url)}</div>
          <span class="cat" style="background:var(--accent-soft);color:var(--accent);">${escapeHtml(mem.category || 'web')}</span>
        </div>
      </div>

      <div class="ins-title">${escapeHtml(mem.title || mem.url)}</div>
      <div class="ins-summary">${escapeHtml(mem.summary || mem.excerpt_clean || 'No summary available.')}</div>

      <div class="ins-section-title">Tags</div>
      <div class="ins-tags">
        ${(mem.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}
      </div>

      <div class="ins-actions" style="margin-top:24px;">
        <button class="ins-btn primary" id="btn-open-mem">Open original</button>
      </div>
    `;

    document.getElementById('btn-open-mem').onclick = () => {
      window.open(mem.url, '_blank');
    };
  } catch(e) {
    console.warn('Failed to inspect memory:', e);
  }
}

function getCatColor(cat) {
  cat = (cat || '').toLowerCase();
  if (cat === 'repo') return '#60a5fa';
  if (cat === 'article') return '#c084fc';
  if (cat === 'video') return '#f87171';
  if (cat === 'paper') return '#22d3ee';
  if (cat === 'doc') return '#34d399';
  if (cat === 'social') return '#f472b6';
  return '#a78bfa';
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
