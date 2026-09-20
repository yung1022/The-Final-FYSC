const fs = require('fs');
const path = require('path');
const { sortByDisplayedSubscribers, topByDisplayedSubscribers, DEFAULT_TOP_LIMIT } = require('./offline-growth');

const DB_PATH = path.join(__dirname, 'data.json');
const COUNTER_PATH = path.join(__dirname, 'counter.json');

function ensureFile() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, '[]\n', 'utf8');
  }
}

function readDB() {
  ensureFile();

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    if (!raw.trim()) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to read database:', error.message);
    return [];
  }
}

function writeDB(entries) {
  ensureFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

function readCounter() {
  if (!fs.existsSync(COUNTER_PATH)) {
    fs.writeFileSync(COUNTER_PATH, JSON.stringify({ value: 0, history: [] }, null, 2) + '\n', 'utf8');
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(COUNTER_PATH, 'utf8'));
    return {
      value: Number(parsed.value) || 0,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch (error) {
    return { value: 0, history: [] };
  }
}

function writeCounter(counter) {
  fs.writeFileSync(COUNTER_PATH, JSON.stringify(counter, null, 2) + '\n', 'utf8');
}

function incrementCounter() {
  const counter = readCounter();
  counter.value += 1;
  counter.history = [...counter.history, { value: counter.value, timestamp: new Date().toISOString() }].slice(-200);
  writeCounter(counter);
  return counter;
}

function addEntry(entry) {
  const entries = readDB();
  const newEntry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString(),
    ...entry,
  };

  entries.push(newEntry);
  writeDB(entries);
  return newEntry;
}

function getEntries() {
  return sortByDisplayedSubscribers(readDB());
}

/**
 * Rank the whole database first, then slice: applying the offline growth
 * formula before the cut-off is what lets a high-growth player who sits below
 * rank 50 on stored subscribers break into the top 50.
 */
function getTopEntries(limit = DEFAULT_TOP_LIMIT) {
  return topByDisplayedSubscribers(readDB(), limit);
}

function resetDB() {
  writeDB([]);
  return [];
}

module.exports = {
  addEntry,
  getEntries,
  readCounter,
  incrementCounter,
  getTopEntries,
  readDB,
  writeDB,
  resetDB,
};
