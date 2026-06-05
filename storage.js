/**
 * Storage layer — uses Upstash Redis when env vars are set, otherwise a local JSON file.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DB_KEY = 'velocity_racing_db';

const EMPTY_DB = () => ({ competitions: {}, broadcastMessage: '', staff: {}, statusOptions: [], schedule: [] });

// --- Upstash Redis (cloud persistent storage) ---
// Uses the command-array format which handles large/complex values safely.
function makeRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisCommand(redis, ...args) {
  const res = await fetch(redis.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redis.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

// --- File storage (local fallback) ---
function fileLoad() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('Failed to load db file:', e.message);
  }
  return EMPTY_DB();
}

function fileSave(db) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Failed to save db file:', e.message);
  }
}

// --- Public API ---
const redis = makeRedis();

async function load() {
  if (redis) {
    try {
      const raw = await redisCommand(redis, 'GET', DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Redis load failed, using empty db:', e.message);
    }
    return EMPTY_DB();
  }
  return fileLoad();
}

async function save(db) {
  if (redis) {
    try {
      await redisCommand(redis, 'SET', DB_KEY, JSON.stringify(db));
    } catch (e) {
      console.error('Redis save failed:', e.message);
    }
    return;
  }
  fileSave(db);
}

function isPersistent() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

module.exports = { load, save, isPersistent };
