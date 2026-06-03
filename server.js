const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// When packaged with pkg, data lives next to the .exe; otherwise in project root
const DATA_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Static files: always at __dirname (bundled into pkg snapshot or on disk)
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

// --- Network helpers ---
function getLocalIPs() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.error('Could not open browser:', err.message); });
}

// --- Data store ---
let db = { competitions: {} };

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load db, starting fresh:', e.message);
  }
}

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Failed to save db:', e.message);
  }
}

function broadcast() {
  io.emit('state', db.competitions);
}

function parselapTime(str) {
  if (!str) return null;
  str = str.trim();
  let ms = 0;
  const colonIdx = str.indexOf(':');
  if (colonIdx !== -1) {
    const mins = parseInt(str.slice(0, colonIdx), 10);
    const rest = parseFloat(str.slice(colonIdx + 1));
    if (isNaN(mins) || isNaN(rest)) return null;
    ms = mins * 60000 + Math.round(rest * 1000);
  } else {
    const secs = parseFloat(str);
    if (isNaN(secs)) return null;
    ms = Math.round(secs * 1000);
  }
  return ms > 0 ? ms : null;
}

function sortEntries(competition) {
  competition.entries.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  competition.entries.forEach((e, i) => { e.position = i + 1; });
}

// --- Express setup ---
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Launcher page — served from route so we can inject live QR codes
app.get('/', async (req, res) => {
  const ips = getLocalIPs();
  const primaryIp = ips.length > 0 ? ips[0].address : 'localhost';
  const base = `http://${primaryIp}:${PORT}`;

  const internalUrl = `${base}/internal`;
  const externalUrl = `${base}/external`;

  const internalQR = await QRCode.toDataURL(internalUrl, { width: 220, margin: 1, color: { dark: '#f0f0f8', light: '#12121e' } });
  const externalQR = await QRCode.toDataURL(externalUrl, { width: 220, margin: 1, color: { dark: '#f0f0f8', light: '#12121e' } });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Twilight SimRacing — Launcher</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #07070d;
      color: #f0f0f8;
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      gap: 2rem;
    }
    .logo { text-align: center; }
    .logo-main {
      font-family: 'Rajdhani', sans-serif;
      font-size: 2.2rem;
      font-weight: 700;
      color: #f0c040;
      letter-spacing: 0.15em;
    }
    .logo-sub {
      font-family: 'Rajdhani', sans-serif;
      font-size: 0.9rem;
      color: #6a6a88;
      letter-spacing: 0.3em;
    }
    .cards {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      justify-content: center;
    }
    .card {
      background: #12121e;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 1.5rem;
      text-align: center;
      width: 260px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }
    .card.phone { border-color: rgba(123,94,167,0.5); }
    .card.screen { border-color: rgba(240,192,64,0.4); }
    .card-icon { font-size: 2rem; }
    .card-title {
      font-family: 'Rajdhani', sans-serif;
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #f0f0f8;
    }
    .card-desc { font-size: 0.8rem; color: #6a6a88; line-height: 1.5; }
    .qr { border-radius: 10px; overflow: hidden; }
    .url {
      font-size: 0.72rem;
      color: #6a6a88;
      word-break: break-all;
      font-family: monospace;
    }
    .btn {
      display: inline-block;
      padding: 0.6rem 1.4rem;
      border-radius: 8px;
      border: none;
      font-family: 'Rajdhani', sans-serif;
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-purple { background: #7b5ea7; color: #fff; }
    .btn-gold { background: #f0c040; color: #07070d; }
    .ip-info {
      font-size: 0.78rem;
      color: #6a6a88;
      text-align: center;
    }
    .ip-info span { color: #f0f0f8; font-weight: 600; }
  </style>
</head>
<body>
  <div class="logo">
    <div class="logo-main">TWILIGHT SIMRACING</div>
    <div class="logo-sub">LEADERBOARD SYSTEM</div>
  </div>

  <div class="cards">
    <div class="card phone">
      <div class="card-icon">📱</div>
      <div class="card-title">YOUR PHONE</div>
      <div class="card-desc">Scan to open the admin panel — enter lap times and manage competitions</div>
      <img class="qr" src="${internalQR}" width="200" height="200" alt="QR Code">
      <div class="url">${internalUrl}</div>
      <a href="${internalUrl}" class="btn btn-purple" target="_blank">OPEN ADMIN</a>
    </div>

    <div class="card screen">
      <div class="card-icon">📺</div>
      <div class="card-title">BIG SCREEN</div>
      <div class="card-desc">Open this on the TV or monitor — shows the live leaderboard</div>
      <img class="qr" src="${externalQR}" width="200" height="200" alt="QR Code">
      <div class="url">${externalUrl}</div>
      <a href="${externalUrl}" class="btn btn-gold" target="_blank">OPEN LEADERBOARD</a>
    </div>
  </div>

  <div class="ip-info">
    Server running on <span>${primaryIp}:${PORT}</span> &nbsp;·&nbsp;
    All devices must be on the same Wi-Fi
    ${ips.length > 1 ? `<br>Other IPs: ${ips.slice(1).map(i => i.address).join(', ')}` : ''}
  </div>
</body>
</html>`);
});

app.get('/external', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'external.html')));
app.get('/internal', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'internal.html')));

// --- API ---

app.get('/api/competitions', (req, res) => res.json(db.competitions));

app.post('/api/competitions', (req, res) => {
  const { name, trackName } = req.body;
  if (!name || !trackName) return res.status(400).json({ error: 'name and trackName required' });
  const id = crypto.randomUUID();
  db.competitions[id] = { id, name, trackName, createdAt: Date.now(), active: false, entries: [] };
  saveDb(); broadcast();
  res.json(db.competitions[id]);
});

app.delete('/api/competitions/:id', (req, res) => {
  if (!db.competitions[req.params.id]) return res.status(404).json({ error: 'Not found' });
  delete db.competitions[req.params.id];
  saveDb(); broadcast();
  res.json({ ok: true });
});

app.post('/api/competitions/:id/activate', (req, res) => {
  if (!db.competitions[req.params.id]) return res.status(404).json({ error: 'Not found' });
  Object.values(db.competitions).forEach(c => { c.active = false; });
  db.competitions[req.params.id].active = true;
  saveDb(); broadcast();
  res.json({ ok: true });
});

app.get('/api/competitions/:id/entries', (req, res) => {
  const comp = db.competitions[req.params.id];
  if (!comp) return res.status(404).json({ error: 'Not found' });
  res.json(comp.entries);
});

app.post('/api/competitions/:id/entries', (req, res) => {
  const comp = db.competitions[req.params.id];
  if (!comp) return res.status(404).json({ error: 'Not found' });
  const { lapTime, driverName, phone, simulator, notes } = req.body;
  const lapTimeMs = parselapTime(lapTime);
  if (!lapTimeMs) return res.status(400).json({ error: 'Invalid lap time format. Use M:SS.mmm or SS.mmm' });
  if (!driverName) return res.status(400).json({ error: 'driverName required' });
  const entry = {
    id: crypto.randomUUID(),
    lapTime: lapTime.trim(), lapTimeMs,
    driverName: driverName.trim(),
    phone: phone || '', simulator: simulator || '', notes: notes || '',
    createdAt: Date.now(), position: 0, isNew: true,
  };
  comp.entries.push(entry);
  sortEntries(comp);
  saveDb(); broadcast();
  setTimeout(() => { const e = comp.entries.find(x => x.id === entry.id); if (e) e.isNew = false; }, 3000);
  res.json(entry);
});

app.put('/api/competitions/:id/entries/:entryId', (req, res) => {
  const comp = db.competitions[req.params.id];
  if (!comp) return res.status(404).json({ error: 'Not found' });
  const entry = comp.entries.find(e => e.id === req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const { driverName, phone, simulator, notes } = req.body;
  if (driverName !== undefined) entry.driverName = driverName.trim();
  if (phone !== undefined) entry.phone = phone;
  if (simulator !== undefined) entry.simulator = simulator;
  if (notes !== undefined) entry.notes = notes;
  saveDb(); broadcast();
  res.json(entry);
});

app.delete('/api/competitions/:id/entries/:entryId', (req, res) => {
  const comp = db.competitions[req.params.id];
  if (!comp) return res.status(404).json({ error: 'Not found' });
  const idx = comp.entries.findIndex(e => e.id === req.params.entryId);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found' });
  comp.entries.splice(idx, 1);
  sortEntries(comp);
  saveDb(); broadcast();
  res.json({ ok: true });
});

// --- Socket.io ---
io.on('connection', (socket) => { socket.emit('state', db.competitions); });

// --- Start ---
loadDb();
server.listen(PORT, '0.0.0.0', () => {
  const launcherUrl = `http://localhost:${PORT}`;
  console.log(`\nTwilight Leaderboard running!`);
  console.log(`Launcher: ${launcherUrl}`);
  getLocalIPs().forEach(ip => console.log(`Network: http://${ip.address}:${PORT}`));
  // Auto-open launcher in browser
  if (!process.env.NO_OPEN) openBrowser(launcherUrl);
});
