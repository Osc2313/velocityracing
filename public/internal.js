const socket = io();

// Check if server has persistent storage configured
fetch('/api/status').then(r => r.json()).then(({ persistent }) => {
  // Only show warning when hosted (not localhost), and not persistent
  const isCloud = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  if (isCloud && !persistent) {
    document.getElementById('persistWarning').style.display = 'flex';
  }
}).catch(() => {});

let competitions = {};
let selectedCompId = null;

// --- Helpers ---
function msToDisplay(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  if (mins > 0) {
    return `${mins}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }
  return `${secs}.${String(millis).padStart(3, '0')}`;
}

function gapDisplay(leaderMs, ms) {
  if (ms === leaderMs) return 'Leader';
  const diff = ms - leaderMs;
  return `+${(diff / 1000).toFixed(3)}s`;
}

function escHtml(s) {
  if (!s) return '—';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function apiFetch(url, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// --- Competition selector ---
function populateCompSelect() {
  const sel = document.getElementById('compSelect');
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— Select Competition —</option>';
  Object.values(competitions)
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} — ${c.trackName}${c.active ? ' 🟢' : ''}`;
      sel.appendChild(opt);
    });
  // Restore selection or keep current
  if (selectedCompId && competitions[selectedCompId]) {
    sel.value = selectedCompId;
  } else if (prevVal && competitions[prevVal]) {
    sel.value = prevVal;
    selectedCompId = prevVal;
  }
}

function updateActiveBanner() {
  const active = Object.values(competitions).find(c => c.active);
  const banner = document.getElementById('activeBanner');
  if (active) {
    banner.style.display = 'flex';
    document.getElementById('activeBannerText').textContent =
      `On big screen: ${active.name} — ${active.trackName}`;
  } else {
    banner.style.display = 'none';
  }
}

function updateCompButtons() {
  const comp = selectedCompId ? competitions[selectedCompId] : null;
  const btnActivate = document.getElementById('btnActivate');
  const dangerZone = document.getElementById('dangerZone');
  if (comp) {
    btnActivate.style.display = 'inline-flex';
    if (comp.active) {
      btnActivate.textContent = 'Hide from Screen';
      btnActivate.classList.remove('btn-outline');
      btnActivate.classList.add('btn-live');
    } else {
      btnActivate.textContent = 'Set Live';
      btnActivate.classList.remove('btn-live');
      btnActivate.classList.add('btn-outline');
    }
    btnActivate.disabled = false;
    dangerZone.style.display = 'block';
  } else {
    btnActivate.style.display = 'none';
    dangerZone.style.display = 'none';
  }
}

function updateMainView() {
  const comp = selectedCompId ? competitions[selectedCompId] : null;
  const emptyState = document.getElementById('emptyState');
  const addTimeSection = document.getElementById('addTimeSection');
  const entriesSection = document.getElementById('entriesSection');

  if (!comp) {
    emptyState.style.display = 'block';
    addTimeSection.style.display = 'none';
    entriesSection.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  addTimeSection.style.display = 'block';
  entriesSection.style.display = 'block';

  renderEntries(comp);
}

function renderEntries(comp) {
  const list = document.getElementById('entriesList');
  const count = document.getElementById('entryCount');
  count.textContent = `${comp.entries.length} entr${comp.entries.length === 1 ? 'y' : 'ies'}`;

  if (comp.entries.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;text-align:center;padding:1.5rem">No entries yet.</p>';
    return;
  }

  const leaderMs = comp.entries[0].lapTimeMs;

  list.innerHTML = comp.entries.map(e => `
    <div class="entry-card pos-${e.position <= 3 ? e.position : 'other'}" data-id="${e.id}">
      <div class="entry-main" onclick="toggleEntry('${e.id}')">
        <div class="entry-pos">${e.position}</div>
        <div class="entry-info">
          <div class="entry-name">${escHtml(e.driverName)}</div>
          <div class="entry-meta">${escHtml(e.simulator || '')}${e.simulator ? ' · ' : ''}${gapDisplay(leaderMs, e.lapTimeMs)}</div>
        </div>
        <div class="entry-time">${msToDisplay(e.lapTimeMs)}</div>
        <div class="entry-chevron">▼</div>
      </div>
      <div class="entry-details">
        <div class="detail-row">
          <span class="detail-label">Lap Time</span>
          <span class="detail-value">${escHtml(e.lapTime)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Phone</span>
          <span class="detail-value">${escHtml(e.phone)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Simulator</span>
          <span class="detail-value">${escHtml(e.simulator)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Notes</span>
          <span class="detail-value">${escHtml(e.notes)}</span>
        </div>
        <div class="entry-actions">
          <button class="btn btn-outline btn-sm" onclick="openEditModal('${e.id}')">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')">🗑 Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

function toggleEntry(id) {
  const card = document.querySelector(`.entry-card[data-id="${id}"]`);
  if (card) card.classList.toggle('expanded');
}

// --- Add time form ---
document.getElementById('addTimeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  errEl.style.display = 'none';

  const body = {
    lapTime: document.getElementById('fLapTime').value,
    driverName: document.getElementById('fDriverName').value,
    simulator: document.getElementById('fSimulator').value,
    phone: document.getElementById('fPhone').value,
    notes: document.getElementById('fNotes').value,
  };

  try {
    await apiFetch(`/api/competitions/${selectedCompId}/entries`, 'POST', body);
    document.getElementById('addTimeForm').reset();
    document.getElementById('fLapTime').focus();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

// --- Edit modal ---
function openEditModal(entryId) {
  const comp = competitions[selectedCompId];
  const entry = comp.entries.find(e => e.id === entryId);
  if (!entry) return;
  document.getElementById('editEntryId').value = entryId;
  document.getElementById('eDriverName').value = entry.driverName;
  document.getElementById('ePhone').value = entry.phone || '';
  document.getElementById('eSimulator').value = entry.simulator || '';
  document.getElementById('eNotes').value = entry.notes || '';
  document.getElementById('editModal').style.display = 'flex';
}

document.getElementById('btnCancelEdit').addEventListener('click', () => {
  document.getElementById('editModal').style.display = 'none';
});

document.getElementById('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entryId = document.getElementById('editEntryId').value;
  const body = {
    driverName: document.getElementById('eDriverName').value,
    phone: document.getElementById('ePhone').value,
    simulator: document.getElementById('eSimulator').value,
    notes: document.getElementById('eNotes').value,
  };
  try {
    await apiFetch(`/api/competitions/${selectedCompId}/entries/${entryId}`, 'PUT', body);
    document.getElementById('editModal').style.display = 'none';
  } catch (err) {
    alert(err.message);
  }
});

// --- Delete entry ---
async function deleteEntry(entryId) {
  if (!confirm('Delete this entry?')) return;
  try {
    await apiFetch(`/api/competitions/${selectedCompId}/entries/${entryId}`, 'DELETE');
  } catch (err) {
    alert(err.message);
  }
}

// --- Delete competition (danger zone) ---
document.getElementById('btnDeleteCompMain').addEventListener('click', async () => {
  const comp = competitions[selectedCompId];
  if (!comp) return;
  const label = `"${comp.name} — ${comp.trackName}"`;
  if (!confirm(`Delete ${label}?\n\nThis will permanently remove all ${comp.entries.length} lap time${comp.entries.length !== 1 ? 's' : ''}. This cannot be undone.`)) return;
  try {
    await apiFetch(`/api/competitions/${selectedCompId}`, 'DELETE');
    selectedCompId = null;
  } catch (err) {
    alert(err.message);
  }
});

// --- Competition management ---
document.getElementById('compSelect').addEventListener('change', (e) => {
  selectedCompId = e.target.value || null;
  updateCompButtons();
  updateMainView();
});

document.getElementById('btnActivate').addEventListener('click', async () => {
  if (!selectedCompId) return;
  const comp = competitions[selectedCompId];
  try {
    if (comp && comp.active) {
      await apiFetch(`/api/competitions/${selectedCompId}/deactivate`, 'POST');
    } else {
      await apiFetch(`/api/competitions/${selectedCompId}/activate`, 'POST');
    }
  } catch (err) {
    alert(err.message);
  }
});

// --- New competition modal ---
document.getElementById('btnNewComp').addEventListener('click', () => {
  document.getElementById('newCompModal').style.display = 'flex';
  document.getElementById('mCompName').focus();
});

document.getElementById('btnCancelComp').addEventListener('click', () => {
  document.getElementById('newCompModal').style.display = 'none';
  document.getElementById('newCompForm').reset();
});

document.getElementById('newCompForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById('mCompName').value,
    trackName: document.getElementById('mTrackName').value,
  };
  try {
    const comp = await apiFetch('/api/competitions', 'POST', body);
    selectedCompId = comp.id;
    document.getElementById('newCompModal').style.display = 'none';
    document.getElementById('newCompForm').reset();
  } catch (err) {
    alert(err.message);
  }
});

// Close modals on overlay click
document.getElementById('newCompModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('newCompModal').style.display = 'none';
    document.getElementById('newCompForm').reset();
  }
});
document.getElementById('editModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('editModal').style.display = 'none';
});

// --- Socket.io ---
socket.on('state', (state) => {
  competitions = state.competitions || state;
  populateCompSelect();
  updateActiveBanner();
  updateCompButtons();
  updateMainView();

  // Sync message input only when not focused
  const input = document.getElementById('broadcastInput');
  if (document.activeElement !== input) {
    input.value = state.broadcastMessage || '';
  }
  const status = document.getElementById('messageStatus');
  if (state.broadcastMessage) {
    status.textContent = `Showing on big screen: "${state.broadcastMessage}"`;
    status.style.color = '#15803d';
  } else {
    status.textContent = '';
  }
});

// --- Photo scan ---
document.getElementById('btnScanPhoto').addEventListener('click', () => {
  document.getElementById('photoInput').click();
});

document.getElementById('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const btn = document.getElementById('btnScanPhoto');
  const hint = document.getElementById('scanHint');
  const lapTimeInput = document.getElementById('fLapTime');

  btn.textContent = '⏳ Reading…';
  btn.disabled = true;
  hint.textContent = 'Scanning image…';
  hint.style.color = 'var(--text-muted)';

  try {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('/api/scan-laptime', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.lapTime) {
      lapTimeInput.value = data.lapTime;
      hint.textContent = `✓ Detected: ${data.lapTime} — check and submit`;
      hint.style.color = '#15803d';
      lapTimeInput.focus();
    } else {
      hint.textContent = `Couldn't detect a lap time — please type it manually`;
      hint.style.color = 'var(--red)';
    }
  } catch (err) {
    hint.textContent = 'Scan failed — please type the lap time manually';
    hint.style.color = 'var(--red)';
  } finally {
    btn.textContent = '📷 Scan';
    btn.disabled = false;
    // Reset file input so same file can be re-scanned
    e.target.value = '';
  }
});

// --- Broadcast message ---
document.getElementById('btnSendMessage').addEventListener('click', async () => {
  const msg = document.getElementById('broadcastInput').value.trim();
  if (!msg) return;
  try { await apiFetch('/api/message', 'PUT', { message: msg }); } catch (e) { alert(e.message); }
});

document.getElementById('broadcastInput').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const msg = e.target.value.trim();
    if (!msg) return;
    try { await apiFetch('/api/message', 'PUT', { message: msg }); } catch (err) { alert(err.message); }
  }
});

document.getElementById('btnClearMessage').addEventListener('click', async () => {
  try {
    await apiFetch('/api/message', 'PUT', { message: '' });
    document.getElementById('broadcastInput').value = '';
  } catch (e) { alert(e.message); }
});

// Make functions available globally (called from onclick in HTML)
window.toggleEntry = toggleEntry;
window.openEditModal = openEditModal;
window.deleteEntry = deleteEntry;
