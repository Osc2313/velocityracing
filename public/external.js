const socket = io();

// Clock
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

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
  if (ms === leaderMs) return '';
  const diff = ms - leaderMs;
  return `+${(diff / 1000).toFixed(3)}`;
}

let prevEntryIds = new Set();
let scrollAnimation = null;

function render(competitions) {
  const active = Object.values(competitions).find(c => c.active);

  const waiting = document.getElementById('waiting');
  const podium = document.getElementById('podium');
  const tableSection = document.getElementById('tableSection');
  const compName = document.getElementById('compName');
  const compTrack = document.getElementById('compTrack');

  if (!active || active.entries.length === 0) {
    waiting.style.display = 'flex';
    podium.style.display = 'none';
    tableSection.style.display = 'none';
    compName.textContent = active ? active.name : '—';
    compTrack.textContent = active ? active.trackName : '';
    document.getElementById('waitingTitle').textContent = active ? 'WAITING FOR COMPETITORS' : 'LEADERBOARD OFFLINE';
    document.getElementById('waitingSub').textContent = active ? 'Lap times will appear here once entered' : 'No session is currently live';
    prevEntryIds = new Set();
    return;
  }

  compName.textContent = active.name;
  compTrack.textContent = active.trackName;
  waiting.style.display = 'none';

  const entries = active.entries; // already sorted
  const leaderMs = entries[0].lapTimeMs;

  // Detect new entries
  const currentIds = new Set(entries.map(e => e.id));
  const newIds = new Set([...currentIds].filter(id => !prevEntryIds.has(id)));
  prevEntryIds = currentIds;

  // Podium
  const top3 = entries.slice(0, 3);
  podium.style.display = 'flex';

  function fillPodiumSlot(prefix, entry, showGap) {
    const nameEl = document.getElementById(`${prefix}-name`);
    const timeEl = document.getElementById(`${prefix}-time`);
    const gapEl = document.getElementById(`${prefix}-gap`);
    const simEl = document.getElementById(`${prefix}-sim`);

    if (!entry) {
      nameEl.textContent = '—';
      timeEl.textContent = '—';
      if (gapEl) gapEl.textContent = '';
      if (simEl) simEl.textContent = '';
      return;
    }
    nameEl.textContent = entry.driverName.toUpperCase();
    timeEl.textContent = msToDisplay(entry.lapTimeMs);
    if (gapEl) gapEl.textContent = showGap ? gapDisplay(leaderMs, entry.lapTimeMs) : '';
    if (simEl) simEl.textContent = entry.simulator ? entry.simulator : '';

    if (newIds.has(entry.id)) {
      const card = document.getElementById(prefix);
      card.classList.remove('flash-green');
      void card.offsetWidth;
      card.classList.add('flash-green');
    }
  }

  fillPodiumSlot('p1', top3[0], false);
  fillPodiumSlot('p2', top3[1], true);
  fillPodiumSlot('p3', top3[2], true);

  // Hide P2/P3 cards if not enough entries
  document.getElementById('p2').style.visibility = top3[1] ? 'visible' : 'hidden';
  document.getElementById('p3').style.visibility = top3[2] ? 'visible' : 'hidden';

  // Table for P4+
  const rest = entries.slice(3);
  if (rest.length === 0) {
    tableSection.style.display = 'none';
  } else {
    tableSection.style.display = 'flex';
    const tbody = document.getElementById('tableBody');

    // For scroll loop, duplicate rows if many
    const shouldScroll = rest.length > 6;
    const rows = rest.map(e => `
      <tr class="${newIds.has(e.id) ? 'new-entry' : ''}">
        <td><span class="pos-badge">${e.position}</span></td>
        <td class="driver-name">${escHtml(e.driverName.toUpperCase())}</td>
        <td class="lap-time">${msToDisplay(e.lapTimeMs)}</td>
        <td class="gap">${gapDisplay(leaderMs, e.lapTimeMs)}</td>
        <td class="sim">${escHtml(e.simulator || '—')}</td>
      </tr>
    `).join('');

    if (shouldScroll) {
      tbody.innerHTML = rows + rows; // duplicate for seamless loop
      const rowHeight = 48;
      const totalHeight = rest.length * rowHeight;
      tbody.classList.add('scrolling-tbody');
      tbody.style.animationDuration = `${rest.length * 2.5}s`;
      tbody.style.setProperty('--scroll-height', `-${totalHeight}px`);
    } else {
      tbody.innerHTML = rows;
      tbody.classList.remove('scrolling-tbody');
    }
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

socket.on('state', render);
