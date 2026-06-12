const socket = io();

let competitions = {};
let selectedCompId = null;
let scheduleItems = [];

// ---- Tab switching ----
function switchTab(tab) {
  ['leaderboard', 'schedule', 'timers'].forEach(t => {
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
  sel.innerHTML = '<option value="">— Select —</option>';
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

function fmtTime(ts) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')}${ampm}`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function renderSchedule() {
  const body = document.getElementById('timetableBody');
  if (!body) return;

  const sorted = [...scheduleItems].sort((a, b) => a.scheduledAt - b.scheduledAt);
  const s1Items = sorted.filter(i => (i.slot || 1) === 1);
  const s2Items = sorted.filter(i => i.slot === 2);

  if (sorted.length === 0) {
    body.innerHTML = '<p style="color:var(--text-faint);font-size:0.85rem;text-align:center;padding:2rem 1rem">No sessions scheduled yet.</p>';
    return;
  }

  function renderCol(items) {
    if (items.length === 0) return '<div class="tt-empty">Nothing scheduled</div>';
    return items.map(item => {
      const comp = competitions[item.competitionId];
      const name = comp ? comp.name : 'Deleted';
      const track = comp ? comp.trackName : '';
      const isLive = comp && comp.slot && item.triggered;
      const badge = isLive ? 'live' : item.triggered ? 'done' : 'upcoming';
      const badgeLabel = isLive ? '● Live' : item.triggered ? 'Done' : 'Upcoming';
      return `
        <div class="tt-item ${item.triggered ? 'triggered' : ''}">
          <div class="tt-time">${fmtTime(item.scheduledAt)}</div>
          <div class="tt-date">${fmtDate(item.scheduledAt)}</div>
          <div class="tt-name">${escHtml(name)}</div>
          ${track ? `<div class="tt-track">${escHtml(track)}</div>` : ''}
          ${item.label ? `<div class="tt-label">${escHtml(item.label)}</div>` : ''}
          <div class="tt-footer">
            <span class="schedule-badge ${badge}">${badgeLabel}</span>
            <button class="btn-remove" onclick="deleteScheduleItem('${item.id}')" title="Remove">×</button>
          </div>
        </div>`;
    }).join('');
  }

  body.innerHTML = `
    <div class="timetable-cols">
      <div class="timetable-col-items">${renderCol(s1Items)}</div>
      <div class="timetable-col-items">${renderCol(s2Items)}</div>
    </div>`;
}

// Screen toggle for schedule form
document.getElementById('sSlot1Btn').addEventListener('click', () => {
  document.getElementById('sSlot').value = '1';
  document.getElementById('sSlot1Btn').classList.add('active');
  document.getElementById('sSlot2Btn').classList.remove('active');
});
document.getElementById('sSlot2Btn').addEventListener('click', () => {
  document.getElementById('sSlot').value = '2';
  document.getElementById('sSlot2Btn').classList.add('active');
  document.getElementById('sSlot1Btn').classList.remove('active');
});

function initDatetimeInput() {
  const input = document.getElementById('sDateTime');
  if (!input || input.value) return;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
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
  const slot = Number(document.getElementById('sSlot').value);
  if (!competitionId || !dtVal) return;
  const scheduledAt = new Date(dtVal).getTime();
  try {
    await apiFetch('/api/schedule', 'POST', { competitionId, scheduledAt, label, slot });
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

const origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  origSwitchTab(tab);
  if (tab === 'schedule') { populateScheduleCompSelect(); initDatetimeInput(); }
  if (tab === 'timers') renderTimers();
};

// ============================================================
// SIM TIMERS
// ============================================================

const SIM_NAMES = ['Sim 1', 'Sim 2', 'Sim 3', 'Sim 4'];
const SIM_IDS   = ['Sim1',  'Sim2',  'Sim3',  'Sim4'];

const simStates = {};
SIM_NAMES.forEach((sim, i) => {
  simStates[sim] = { phase: 'idle', remaining: 0, total: 0, interval: null };
});

function renderTimers() {
  SIM_NAMES.forEach(renderTimerCard);
}

function updateTimerTopbar() {
  const bar = document.getElementById('timerTopbar');
  if (!bar) return;
  const active = SIM_NAMES.filter(sim => simStates[sim].phase !== 'idle');
  if (!active.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = active.map(sim => {
    const s = simStates[sim];
    const label = sim.replace('Sim ', 'S');
    if (s.phase === 'finished') {
      return `<div class="timer-chip chip-urgent" onclick="switchTab('timers')">${label} ⏰</div>`;
    }
    const m = Math.floor(s.remaining / 60), sec = s.remaining % 60;
    const t = `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    const pct = s.remaining / s.total;
    const cls = pct < 0.2 ? 'chip-urgent' : pct < 0.4 ? 'chip-warning' : 'chip-ok';
    return `<div class="timer-chip ${cls}" onclick="switchTab('timers')">${label} ${t}</div>`;
  }).join('');
}

function renderTimerCard(sim) {
  const id = sim.replace(' ', '');
  const card = document.getElementById('timer-' + id);
  if (!card) return;
  const s = simStates[sim];

  const mins = Math.floor(s.remaining / 60);
  const secs = s.remaining % 60;
  const display = s.remaining > 0
    ? `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
    : '00:00';

  let html = `<div class="timer-sim-name">${sim}</div>`;

  if (s.phase === 'idle') {
    html += `
      <div class="timer-display timer-idle">—:——</div>
      <p class="timer-hint">Tap to start a turn</p>
      <div class="timer-start-btns">
        <button class="btn btn-outline btn-sm" onclick="startTimer('${sim}',3)">3 min</button>
        <button class="btn btn-outline btn-sm" onclick="startTimer('${sim}',4)">4 min</button>
        <button class="btn btn-outline btn-sm" onclick="startTimer('${sim}',5)">5 min</button>
      </div>`;

  } else if (s.phase === 'running') {
    const pct = s.remaining / s.total;
    const cls = pct < 0.2 ? 'urgent' : pct < 0.4 ? 'warning' : 'ok';
    html += `
      <div class="timer-display timer-${cls}">${display}</div>
      <div class="timer-progress"><div class="timer-bar timer-bar-${cls}" style="width:${(pct*100).toFixed(1)}%"></div></div>
      <button class="btn btn-outline btn-sm" style="margin-top:0.6rem" onclick="stopTimer('${sim}')">■ Stop</button>`;

  } else if (s.phase === 'finished') {
    html += `
      <div class="timer-display timer-urgent">00:00</div>
      <div class="timer-finished-label">⏰ Time's up!</div>
      <div class="timer-log-actions" style="margin-top:0.5rem">
        <button class="btn btn-primary btn-sm" onclick="openTimerLogModal('${sim}')">Log Lap Time</button>
        <button class="btn btn-outline btn-sm" onclick="resetTimer('${sim}')">Skip</button>
      </div>`;
  }

  card.innerHTML = html;
  updateTimerTopbar();
}

function startTimer(sim, minutes) {
  const s = simStates[sim];
  if (s.interval) clearInterval(s.interval);
  s.total = minutes * 60;
  s.remaining = s.total;
  s.phase = 'running';
  renderTimerCard(sim);
  s.interval = setInterval(() => {
    s.remaining--;
    if (s.remaining <= 0) {
      s.remaining = 0;
      s.phase = 'finished';
      clearInterval(s.interval);
      s.interval = null;
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      setTimeout(() => openTimerLogModal(sim), 300);
    }
    renderTimerCard(sim);
  }, 1000);
}
window.startTimer = startTimer;

function stopTimer(sim) {
  const s = simStates[sim];
  if (s.interval) { clearInterval(s.interval); s.interval = null; }
  s.phase = 'idle';
  renderTimerCard(sim); // also calls updateTimerTopbar
}
window.stopTimer = stopTimer;

function resetTimer(sim) {
  const s = simStates[sim];
  if (s.interval) { clearInterval(s.interval); s.interval = null; }
  s.phase = 'idle';
  s.remaining = 0;
  s.total = 0;
  renderTimerCard(sim); // also calls updateTimerTopbar
}
window.resetTimer = resetTimer;

function openTimerLogModal(sim) {
  const all = Object.values(competitions).filter(Boolean);
  const s1 = all.find(c => c.slot === 1);
  const s2 = all.find(c => c.slot === 2);

  document.getElementById('timerLogSim').value = sim;
  document.getElementById('timerLogSimName').textContent = sim;
  document.getElementById('timerLogDriver').value = '';
  document.getElementById('timerLogTime').value = '';
  document.getElementById('timerLogError').style.display = 'none';

  // Live screen quick-pick pills
  const pillsEl = document.getElementById('timerSessionPills');
  pillsEl.innerHTML = [s1 && { id: s1.id, label: `S1: ${s1.name}` }, s2 && { id: s2.id, label: `S2: ${s2.name}` }]
    .filter(Boolean)
    .map(p => `<button type="button" class="session-pill" data-id="${p.id}" onclick="pickTimerSession('${p.id}')">${escHtml(p.label)}</button>`)
    .join('');

  // Populate full dropdown
  const sel = document.getElementById('timerLogComp');
  sel.innerHTML = '<option value="">— Select session —</option>';
  all.sort((a,b) => b.createdAt - a.createdAt).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} — ${c.trackName}`;
    sel.appendChild(opt);
  });

  // Auto-select: prefer single live screen, else last selected comp
  if (s1 && !s2) pickTimerSession(s1.id);
  else if (s2 && !s1) pickTimerSession(s2.id);
  else if (selectedCompId) pickTimerSession(selectedCompId);

  document.getElementById('timerLogModal').style.display = 'flex';
  setTimeout(() => document.getElementById('timerLogDriver').focus(), 80);
}
window.openTimerLogModal = openTimerLogModal;

function pickTimerSession(compId) {
  document.getElementById('timerLogComp').value = compId;
  document.querySelectorAll('#timerSessionPills .session-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.id === compId);
  });
}
window.pickTimerSession = pickTimerSession;

document.getElementById('timerLogSubmit').addEventListener('click', async () => {
  const sim = document.getElementById('timerLogSim').value;
  const compId = document.getElementById('timerLogComp').value;
  const driverName = document.getElementById('timerLogDriver').value.trim();
  const lapTime = document.getElementById('timerLogTime').value.trim();
  const errEl = document.getElementById('timerLogError');
  errEl.style.display = 'none';
  if (!compId) { errEl.textContent = 'Select a session.'; errEl.style.display = 'block'; return; }
  if (!driverName) { errEl.textContent = 'Enter a driver name.'; errEl.style.display = 'block'; return; }
  if (!lapTime) { errEl.textContent = 'Enter a lap time.'; errEl.style.display = 'block'; return; }
  try {
    await apiFetch(`/api/competitions/${compId}/entries`, 'POST', { lapTime, driverName, simulator: sim });
    document.getElementById('timerLogModal').style.display = 'none';
    resetTimer(sim);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

document.getElementById('timerLogCancel').addEventListener('click', () => {
  const sim = document.getElementById('timerLogSim').value;
  document.getElementById('timerLogModal').style.display = 'none';
  resetTimer(sim);
});

document.getElementById('timerLogModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    const sim = document.getElementById('timerLogSim').value;
    document.getElementById('timerLogModal').style.display = 'none';
    resetTimer(sim);
  }
});
