const socket = io();

// Clock
function updateClock() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  document.getElementById('clock').textContent =
    `${hour}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${ampm}`;
}
setInterval(updateClock, 1000);
updateClock();

function msToDisplay(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  if (mins > 0) return `${mins}:${String(secs).padStart(2,'0')}.${String(millis).padStart(3,'0')}`;
  return `${secs}.${String(millis).padStart(3,'0')}`;
}

function gapDisplay(leaderMs, ms) {
  if (ms === leaderMs) return '';
  return `+${((ms - leaderMs) / 1000).toFixed(3)}`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Track new entries per competition to flash them
const prevEntryIdsByComp = new Map();
let prevSlotConfig = '';

function render(state) {
  const competitions = state.competitions || {};
  const broadcastMessage = state.broadcastMessage || '';

  const banner = document.getElementById('messageBanner');
  if (broadcastMessage) {
    document.getElementById('messageText').textContent = broadcastMessage;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }

  const all = Object.values(competitions).filter(Boolean);
  const slot1 = all.find(c => c.slot === 1);
  const slot2 = all.find(c => c.slot === 2);
  const isDual = !!(slot1 && slot2);

  const slotConfig = `${slot1?.id || ''}|${slot2?.id || ''}`;
  const mainContent = document.getElementById('mainContent');
  const compInfo = document.getElementById('compInfo');

  // Only rebuild DOM structure when slot layout changes
  if (slotConfig !== prevSlotConfig) {
    prevSlotConfig = slotConfig;
    mainContent.innerHTML = '';
    mainContent.className = 'main-content' + (isDual ? ' dual' : '');

    if (!slot1 && !slot2) {
      compInfo.innerHTML = '<span class="comp-name">—</span><span class="comp-track"></span>';
      mainContent.innerHTML = `
        <div class="waiting">
          <div class="waiting-icon">🏁</div>
          <div class="waiting-title">LEADERBOARD OFFLINE</div>
          <div class="waiting-sub">No session is currently live</div>
        </div>`;
      return;
    }

    if (isDual) {
      mainContent.innerHTML = `
        <div class="lb-panel compact" id="panel-s1"></div>
        <div class="lb-panel compact" id="panel-s2"></div>`;
    } else {
      mainContent.innerHTML = `<div class="lb-panel" id="panel-main"></div>`;
    }
  }

  if (!slot1 && !slot2) return;

  if (isDual) {
    renderPanel(document.getElementById('panel-s1'), slot1, true);
    renderPanel(document.getElementById('panel-s2'), slot2, true);
    compInfo.innerHTML = `<span class="comp-name" style="font-size:0.95rem">${escHtml(slot1.name)}&nbsp;&nbsp;·&nbsp;&nbsp;${escHtml(slot2.name)}</span>`;
  } else {
    const comp = slot1 || slot2;
    renderPanel(document.getElementById('panel-main'), comp, false);
    compInfo.innerHTML = `<span class="comp-name">${escHtml(comp.name)}</span><span class="comp-track">${escHtml(comp.trackName)}</span>`;
  }
}

function renderPanel(el, comp, compact) {
  if (!comp) {
    el.innerHTML = `<div class="waiting" style="flex:1"><div class="waiting-icon">🏁</div><div class="waiting-title">WAITING</div></div>`;
    return;
  }

  const entries = comp.entries || [];

  if (!prevEntryIdsByComp.has(comp.id)) prevEntryIdsByComp.set(comp.id, new Set());
  const prevIds = prevEntryIdsByComp.get(comp.id);
  const currentIds = new Set(entries.map(e => e.id));
  const newIds = new Set([...currentIds].filter(id => !prevIds.has(id)));
  prevEntryIdsByComp.set(comp.id, currentIds);

  const headerHtml = compact ? `
    <div class="panel-header">
      <div class="panel-name">${escHtml(comp.name)}</div>
      <div class="panel-track">${escHtml(comp.trackName)}</div>
    </div>` : '';

  if (entries.length === 0) {
    el.innerHTML = headerHtml + `
      <div class="waiting" style="flex:1">
        <div class="waiting-icon">🏁</div>
        <div class="waiting-title">WAITING FOR COMPETITORS</div>
        <div class="waiting-sub">Lap times will appear here once entered</div>
      </div>`;
    return;
  }

  const leaderMs = entries[0].lapTimeMs;
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const shouldScroll = rest.length > (compact ? 4 : 6);

  el.innerHTML = headerHtml + buildPodium(top3, leaderMs, compact, newIds) + (rest.length ? buildTable(rest, leaderMs, shouldScroll, compact, newIds) : '');

  // P2/P3 visibility
  const p2el = el.querySelector('.podium-second');
  const p3el = el.querySelector('.podium-third');
  if (p2el) p2el.style.visibility = top3[1] ? 'visible' : 'hidden';
  if (p3el) p3el.style.visibility = top3[2] ? 'visible' : 'hidden';
}

function buildPodium(top3, leaderMs, compact, newIds) {
  function card(entry, cls, posLabel) {
    const isP1 = cls === 'podium-first';
    const flash = entry && newIds.has(entry.id) ? ' flash-green' : '';
    return `
      <div class="podium-card ${cls}${flash}">
        ${isP1 ? '<div class="podium-crown">👑</div>' : ''}
        <div class="podium-pos">${posLabel}</div>
        <div class="podium-name">${entry ? escHtml(entry.driverName.toUpperCase()) : '—'}</div>
        <div class="podium-time">${entry ? msToDisplay(entry.lapTimeMs) : '—'}</div>
        ${!isP1 ? `<div class="podium-gap">${entry ? gapDisplay(leaderMs, entry.lapTimeMs) : ''}</div>` : ''}
        <div class="podium-sim">${escHtml(entry?.simulator || '')}</div>
      </div>`;
  }
  return `
    <section class="podium${compact ? ' podium-compact' : ''}">
      ${card(top3[1], 'podium-second', 'P2')}
      ${card(top3[0], 'podium-first', 'P1')}
      ${card(top3[2], 'podium-third', 'P3')}
    </section>`;
}

function buildTable(rest, leaderMs, shouldScroll, compact, newIds) {
  const rows = rest.map(e => `
    <tr class="${newIds.has(e.id) ? 'new-entry' : ''}">
      <td><span class="pos-badge">${e.position}</span></td>
      <td class="driver-name">${escHtml(e.driverName.toUpperCase())}</td>
      <td class="lap-time">${msToDisplay(e.lapTimeMs)}</td>
      <td class="gap">${gapDisplay(leaderMs, e.lapTimeMs)}</td>
      <td class="sim">${escHtml(e.simulator || '—')}</td>
    </tr>`).join('');

  const tbodyStyle = shouldScroll
    ? `animation-duration:${rest.length * (compact ? 2 : 2.5)}s;--scroll-height:-${rest.length * (compact ? 42 : 48)}px`
    : '';

  return `
    <section class="table-section" style="display:flex">
      <div class="table-wrapper">
        <table class="leaderboard-table${compact ? ' table-compact' : ''}">
          <thead><tr><th>POS</th><th>DRIVER</th><th>LAP TIME</th><th>GAP</th><th>SIM</th></tr></thead>
          <tbody class="${shouldScroll ? 'scrolling-tbody' : ''}" style="${tbodyStyle}">
            ${shouldScroll ? rows + rows : rows}
          </tbody>
        </table>
      </div>
    </section>`;
}

socket.on('state', render);
