const fs = require('fs');
const path = require('path');

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
  return readDB();
}

function getTopEntries(limit = 50) {
  return [...readDB()]
    .sort((a, b) => Number(b.subscribers ?? 0) - Number(a.subscribers ?? 0))
    .slice(0, limit);
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
