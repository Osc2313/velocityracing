const socket = io();

let competitions = {};
let selectedCompId = null;
let scheduleItems = [];

// ---- Tab switching ----
function switchTab(tab) {
  ['leaderboard', 'schedule'].forEach(t => {
    document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = t === tab ? '' : 'none';
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  if (tab === 'schedule') populateScheduleCompSelect();
}
window.switchTab = switchTab;

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
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Server error (${res.status}) — please try again`);
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// --- Competition selector ---
function populateCompSelect() {
  const sel = document.getElementById('compSelect');
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— Select Competition —</option>';
  Object.values(competitions)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      const slotTag = c.slot === 1 ? ' · S1' : c.slot === 2 ? ' · S2' : '';
      opt.textContent = `${c.name} — ${c.trackName}${slotTag}`;
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
  const all = Object.values(competitions).filter(Boolean);
  const s1 = all.find(c => c.slot === 1);
  const s2 = all.find(c => c.slot === 2);
  const banner = document.getElementById('activeBanner');
  if (s1 || s2) {
    banner.style.display = 'flex';
    const parts = [];
    if (s1) parts.push(`S1: ${s1.name}`);
    if (s2) parts.push(`S2: ${s2.name}`);
    document.getElementById('activeBannerText').textContent = `On big screen: ${parts.join(' · ')}`;
  } else {
    banner.style.display = 'none';
  }
}

function updateSlotBar() {
  const all = Object.values(competitions).filter(Boolean);
  const s1 = all.find(c => c.slot === 1);
  const s2 = all.find(c => c.slot === 2);
  const bar = document.getElementById('slotBar');
  const chip1 = document.getElementById('slotChip1');
  const chip2 = document.getElementById('slotChip2');
  if (s1 || s2) {
    bar.style.display = 'flex';
    chip1.textContent = s1 ? `S1: ${s1.name}` : 'S1: empty';
    chip1.className = 'slot-chip' + (s1 ? ' filled' : '') + (s1?.id === selectedCompId ? ' selected' : '');
    chip2.textContent = s2 ? `S2: ${s2.name}` : 'S2: empty';
    chip2.className = 'slot-chip' + (s2 ? ' filled' : '') + (s2?.id === selectedCompId ? ' selected' : '');
  } else {
    bar.style.display = 'none';
  }
}

function updateCompButtons() {
  const comp = selectedCompId ? competitions[selectedCompId] : null;
  const btnSlot1 = document.getElementById('btnSlot1');
  const btnSlot2 = document.getElementById('btnSlot2');
  const dangerZone = document.getElementById('dangerZone');
  if (comp) {
    btnSlot1.style.display = 'inline-flex';
    btnSlot2.style.display = 'inline-flex';
    if (comp.slot === 1) {
      btnSlot1.textContent = '● S1';
      btnSlot1.className = 'btn btn-sm btn-slot-active';
    } else {
      btnSlot1.textContent = 'Screen 1';
      btnSlot1.className = 'btn btn-sm btn-outline';
    }
    if (comp.slot === 2) {
      btnSlot2.textContent = '● S2';
      btnSlot2.className = 'btn btn-sm btn-slot-active';
    } else {
      btnSlot2.textContent = 'Screen 2';
      btnSlot2.className = 'btn btn-sm btn-outline';
    }
    dangerZone.style.display = 'block';
  } else {
    btnSlot1.style.display = 'none';
    btnSlot2.style.display = 'none';
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

document.getElementById('btnSlot1').addEventListener('click', async () => {
  if (!selectedCompId) return;
  const comp = competitions[selectedCompId];
  const newSlot = comp?.slot === 1 ? null : 1;
  try { await apiFetch(`/api/competitions/${selectedCompId}/setslot`, 'POST', { slot: newSlot }); }
  catch (err) { alert(err.message); }
});

document.getElementById('btnSlot2').addEventListener('click', async () => {
  if (!selectedCompId) return;
  const comp = competitions[selectedCompId];
  const newSlot = comp?.slot === 2 ? null : 2;
  try { await apiFetch(`/api/competitions/${selectedCompId}/setslot`, 'POST', { slot: newSlot }); }
  catch (err) { alert(err.message); }
});

document.getElementById('slotChip1').addEventListener('click', () => {
  const comp = Object.values(competitions).filter(Boolean).find(c => c.slot === 1);
  if (comp) { selectedCompId = comp.id; document.getElementById('compSelect').value = comp.id; updateCompButtons(); updateMainView(); updateSlotBar(); }
});
document.getElementById('slotChip2').addEventListener('click', () => {
  const comp = Object.values(competitions).filter(Boolean).find(c => c.slot === 2);
  if (comp) { selectedCompId = comp.id; document.getElementById('compSelect').value = comp.id; updateCompButtons(); updateMainView(); updateSlotBar(); }
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
  scheduleItems = state.schedule || [];
  populateCompSelect();
  updateActiveBanner();
  updateSlotBar();
  updateCompButtons();
  updateMainView();
  renderSchedule();

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

function escAttr(s) {
  return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// ============================================================
// SCHEDULE
// ============================================================

function populateScheduleCompSelect() {
  const sel = document.getElementById('sCompetition');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select a competition —</option>';
  Object.values(competitions)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} — ${c.trackName}`;
      sel.appendChild(opt);
    });
  if (prev) sel.value = prev;
}

function formatScheduleTime(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  const time = `${hour}:${String(m).padStart(2, '0')}${ampm}`;
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return { time, date };
}

function renderSchedule() {
  const list = document.getElementById('scheduleList');
  const countEl = document.getElementById('scheduleCount');
  if (!list) return;

  const now = Date.now();
  const sorted = [...scheduleItems].sort((a, b) => a.scheduledAt - b.scheduledAt);
  const upcoming = sorted.filter(s => !s.triggered);
  const past = sorted.filter(s => s.triggered);

  countEl.textContent = `${upcoming.length} upcoming`;

  if (sorted.length === 0) {
    list.innerHTML = '<p style="color:var(--text-faint);font-size:0.85rem;text-align:center;padding:1.5rem">No sessions scheduled yet.</p>';
    return;
  }

  list.innerHTML = sorted.map(item => {
    const comp = competitions[item.competitionId];
    const compName = comp ? `${comp.name} — ${comp.trackName}` : 'Deleted competition';
    const isLive = comp && comp.slot && item.triggered;
    const { time, date } = formatScheduleTime(item.scheduledAt);
    const badge = isLive
      ? '<span class="schedule-badge live">● Live</span>'
      : item.triggered
        ? '<span class="schedule-badge done">Done</span>'
        : '<span class="schedule-badge upcoming">Upcoming</span>';
    return `
      <div class="schedule-item ${item.triggered ? 'triggered' : ''}">
        <div class="schedule-time-block">
          <div class="schedule-time">${time}</div>
          <div class="schedule-date">${date}</div>
        </div>
        <div class="schedule-info">
          <div class="schedule-comp">${escHtml(compName)}</div>
          ${item.label ? `<div class="schedule-label">${escHtml(item.label)}</div>` : ''}
        </div>
        ${badge}
        <button class="btn-remove" onclick="deleteScheduleItem('${item.id}')" title="Remove">×</button>
      </div>`;
  }).join('');
}

// Set default datetime to now + 1 hour rounded to nearest 15 min
function initDatetimeInput() {
  const input = document.getElementById('sDateTime');
  if (!input || input.value) return;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  // datetime-local format: YYYY-MM-DDTHH:MM
  const pad = n => String(n).padStart(2, '0');
  input.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

document.getElementById('scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('scheduleError');
  errEl.style.display = 'none';
  const competitionId = document.getElementById('sCompetition').value;
  const dtVal = document.getElementById('sDateTime').value;
  const label = document.getElementById('sLabel').value.trim();
  if (!competitionId || !dtVal) return;
  const scheduledAt = new Date(dtVal).getTime();
  try {
    await apiFetch('/api/schedule', 'POST', { competitionId, scheduledAt, label });
    document.getElementById('sLabel').value = '';
    document.getElementById('sCompetition').value = '';
    initDatetimeInput();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

async function deleteScheduleItem(id) {
  if (!confirm('Remove this scheduled rotation?')) return;
  await apiFetch(`/api/schedule/${id}`, 'DELETE');
}
window.deleteScheduleItem = deleteScheduleItem;

// Init datetime when switching to schedule tab
const origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  origSwitchTab(tab);
  if (tab === 'schedule') initDatetimeInput();
};
