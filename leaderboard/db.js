const fs = require('fs');
const path = require('path');
const { sortByDisplayedSubscribers, topByDisplayedSubscribers, DEFAULT_TOP_LIMIT } = require('./offline-growth');

const DB_PATH = path.join(__dirname, 'data.json');

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
  getTopEntries,
  readDB,
  writeDB,
  resetDB,
};
