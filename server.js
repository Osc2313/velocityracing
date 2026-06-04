const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');
const QRCode = require('qrcode');
const multer = require('multer');
const { createWorker } = require('tesseract.js');

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
let db = { competitions: {}, broadcastMessage: '' };

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
  io.emit('state', { competitions: db.competitions, broadcastMessage: db.broadcastMessage });
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
  // Use the actual request host so links work on Render, localhost, or any other host
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const base = `${proto}://${host}`;

  const internalUrl = `${base}/internal`;
  const externalUrl = `${base}/external`;

  const internalQR = await QRCode.toDataURL(internalUrl, { width: 220, margin: 2, color: { dark: '#1e293b', light: '#f8fafc' } });
  const externalQR = await QRCode.toDataURL(externalUrl, { width: 220, margin: 2, color: { dark: '#1e293b', light: '#f8fafc' } });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Velocity Racing</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f8fafc;
      color: #0f172a;
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      gap: 2.5rem;
    }
    .logo { text-align: center; }
    .logo-main {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    .logo-main span { color: #2563eb; }
    .logo-sub {
      font-size: 0.8rem;
      font-weight: 400;
      color: #94a3b8;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }
    .cards {
      display: flex;
      gap: 1.25rem;
      flex-wrap: wrap;
      justify-content: center;
    }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 1.75rem 1.5rem;
      text-align: center;
      width: 260px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .card-label {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #94a3b8;
    }
    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: #0f172a;
    }
    .card-desc {
      font-size: 0.8rem;
      color: #64748b;
      line-height: 1.6;
    }
    .qr {
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      padding: 8px;
      background: #f8fafc;
    }
    .url {
      font-size: 0.68rem;
      color: #94a3b8;
      word-break: break-all;
      font-family: monospace;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 0.65rem 1.25rem;
      border-radius: 8px;
      border: none;
      font-family: 'Inter', sans-serif;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s;
    }
    .btn-blue { background: #2563eb; color: #fff; }
    .btn-blue:hover { background: #1d4ed8; }
    .btn-dark { background: #0f172a; color: #fff; }
    .btn-dark:hover { background: #1e293b; }
    .footer {
      font-size: 0.75rem;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="logo">
    <div class="logo-main">Velocity <span>Racing</span></div>
    <div class="logo-sub">Leaderboard System</div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-label">Admin</div>
      <div class="card-title">Phone / Tablet</div>
      <div class="card-desc">Scan to enter lap times and manage competitions from your phone</div>
      <img class="qr" src="${internalQR}" width="180" height="180" alt="QR Code for admin">
      <div class="url">${internalUrl}</div>
      <a href="/internal" class="btn btn-blue">Open Admin Panel</a>
    </div>

    <div class="card">
      <div class="card-label">Display</div>
      <div class="card-title">Big Screen / TV</div>
      <div class="card-desc">Open this on your TV or monitor to show the live leaderboard</div>
      <img class="qr" src="${externalQR}" width="180" height="180" alt="QR Code for leaderboard">
      <div class="url">${externalUrl}</div>
      <a href="/external" class="btn btn-dark">Open Leaderboard</a>
    </div>
  </div>

  <div class="footer">All devices must be on the same network when running locally</div>
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

app.post('/api/competitions/:id/deactivate', (req, res) => {
  if (!db.competitions[req.params.id]) return res.status(404).json({ error: 'Not found' });
  db.competitions[req.params.id].active = false;
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

// --- Lap time OCR ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Extract all lap-time-shaped tokens from raw OCR text.
// Accepts M:SS.mmm, MM:SS.mmm, SS.mmm — returns best candidate or null.
function extractLapTime(text) {
  const lines = text.replace(/[^\x20-\x7E\n]/g, ' ').split('\n');
  const candidates = [];

  for (const line of lines) {
    // Try colon-separated format first: 1:23.456 or 01:23.456
    const colonMatches = line.match(/\b(\d{1,2}):(\d{2})[.,](\d{2,3})\b/g) || [];
    for (const m of colonMatches) {
      const norm = m.replace(',', '.');
      const [minsStr, rest] = norm.split(':');
      const mins = parseInt(minsStr, 10);
      const secs = parseFloat(rest);
      if (mins < 60 && secs < 60) candidates.push({ str: norm, ms: mins * 60000 + Math.round(secs * 1000) });
    }
    // Seconds-only: 83.456 or 83,456
    const secMatches = line.match(/\b(\d{2,3})[.,](\d{2,3})\b/g) || [];
    for (const m of secMatches) {
      const norm = m.replace(',', '.');
      const secs = parseFloat(norm);
      if (secs >= 1 && secs < 600) candidates.push({ str: norm, ms: Math.round(secs * 1000) });
    }
  }

  if (!candidates.length) return null;
  // Prefer colon-format; otherwise pick shortest (most specific) seconds value
  const colon = candidates.find(c => c.str.includes(':'));
  return colon ? colon.str : candidates.sort((a, b) => a.ms - b.ms)[0].str;
}

const TESSDATA_PATH = path.join(__dirname, 'tessdata');

app.post('/api/scan-laptime', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  let worker;
  try {
    worker = await createWorker('eng', 1, {
      langPath: TESSDATA_PATH,
      cacheMethod: 'none',
      logger: () => {},
    });
    await worker.setParameters({ tessedit_char_whitelist: '0123456789:.,/ ' });
    const { data: { text } } = await worker.recognize(req.file.buffer);
    const lapTime = extractLapTime(text);
    res.json({ lapTime, rawText: text.trim() });
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: 'OCR failed: ' + err.message });
  } finally {
    if (worker) await worker.terminate();
  }
});

// --- Broadcast message ---
app.put('/api/message', (req, res) => {
  const { message } = req.body;
  db.broadcastMessage = (message || '').trim();
  saveDb(); broadcast();
  res.json({ ok: true });
});

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.emit('state', { competitions: db.competitions, broadcastMessage: db.broadcastMessage });
});

// --- Start ---
loadDb();
server.listen(PORT, '0.0.0.0', () => {
  const launcherUrl = `http://localhost:${PORT}`;
  console.log(`\nVelocity Racing Leaderboard running!`);
  console.log(`Launcher: ${launcherUrl}`);
  getLocalIPs().forEach(ip => console.log(`Network: http://${ip.address}:${PORT}`));
  // Auto-open launcher in browser
  if (!process.env.NO_OPEN) openBrowser(launcherUrl);
});
