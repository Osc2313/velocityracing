const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PORT = process.env.PORT || 3000;

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
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Failed to save db:', e.message);
  }
}

function broadcast() {
  io.emit('state', db.competitions);
}

// Parse lap time string to milliseconds
// Accepts "M:SS.mmm", "MM:SS.mmm", "SS.mmm", "SS"
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/internal'));
app.get('/external', (req, res) => res.sendFile(path.join(__dirname, 'public', 'external.html')));
app.get('/internal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'internal.html')));

// --- API ---

app.get('/api/competitions', (req, res) => {
  res.json(db.competitions);
});

app.post('/api/competitions', (req, res) => {
  const { name, trackName } = req.body;
  if (!name || !trackName) return res.status(400).json({ error: 'name and trackName required' });
  const id = crypto.randomUUID();
  db.competitions[id] = { id, name, trackName, createdAt: Date.now(), active: false, entries: [] };
  saveDb();
  broadcast();
  res.json(db.competitions[id]);
});

app.delete('/api/competitions/:id', (req, res) => {
  if (!db.competitions[req.params.id]) return res.status(404).json({ error: 'Not found' });
  delete db.competitions[req.params.id];
  saveDb();
  broadcast();
  res.json({ ok: true });
});

app.post('/api/competitions/:id/activate', (req, res) => {
  if (!db.competitions[req.params.id]) return res.status(404).json({ error: 'Not found' });
  Object.values(db.competitions).forEach(c => { c.active = false; });
  db.competitions[req.params.id].active = true;
  saveDb();
  broadcast();
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
    lapTime: lapTime.trim(),
    lapTimeMs,
    driverName: driverName.trim(),
    phone: phone || '',
    simulator: simulator || '',
    notes: notes || '',
    createdAt: Date.now(),
    position: 0,
    isNew: true,
  };
  comp.entries.push(entry);
  sortEntries(comp);
  saveDb();
  broadcast();
  // Clear isNew flag after broadcast
  setTimeout(() => {
    const e = comp.entries.find(x => x.id === entry.id);
    if (e) e.isNew = false;
  }, 3000);
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
  saveDb();
  broadcast();
  res.json(entry);
});

app.delete('/api/competitions/:id/entries/:entryId', (req, res) => {
  const comp = db.competitions[req.params.id];
  if (!comp) return res.status(404).json({ error: 'Not found' });
  const idx = comp.entries.findIndex(e => e.id === req.params.entryId);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found' });
  comp.entries.splice(idx, 1);
  sortEntries(comp);
  saveDb();
  broadcast();
  res.json({ ok: true });
});

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.emit('state', db.competitions);
});

// --- Start ---
loadDb();
server.listen(PORT, () => {
  console.log(`Twilight Leaderboard running on http://localhost:${PORT}`);
  console.log(`  External view: http://localhost:${PORT}/external`);
  console.log(`  Internal view: http://localhost:${PORT}/internal`);
});
