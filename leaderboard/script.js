const DEMO_ENTRIES = [
  { name: 'Alice', subscribers: 25000 },
  { name: 'Ben', subscribers: 22000 },
  { name: 'Chris', subscribers: 21000 },
  { name: 'Diana', subscribers: 19800 },
  { name: 'Ethan', subscribers: 18500 },
  { name: 'Fiona', subscribers: 17000 },
  { name: 'George', subscribers: 16500 },
  { name: 'Hannah', subscribers: 15200 },
  { name: 'Ian', subscribers: 14800 },
  { name: 'Julia', subscribers: 14300 },
];

const DEFAULT_API_URL =
  window.LEADERBOARD_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/leaderboard/top50'
    : '/api/leaderboard/top50');

const FALLBACK_DB_URL = 'https://final-fysc-default-rtdb.asia-southeast1.firebasedatabase.app/.json';
const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');

function fmtNumber(n){
  if(n==null) return '0';
  return Number(n).toLocaleString();
}

function normalizeEntry(item){
  const entry = item && typeof item === 'object' ? item : {};
  const subs = Number(
    entry.subscribers ??
    entry.subscriberCount ??
    entry.subs ??
    entry.sub_count ??
    entry.subscriber_count ??
    entry.count ??
    0
  );

  return {
    ...entry,
    name: entry.name || entry.displayName || entry.username || 'Unknown',
    subscribers: Number.isFinite(subs) ? subs : 0,
  };
}

function createCell(rank, item){
  const el = document.createElement('div');
  el.className = 'cell';

  const rankEl = document.createElement('div');
  rankEl.className = 'rank';
  rankEl.textContent = `#${rank}`;

  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = item.name || 'Unknown';

  const subsEl = document.createElement('div');
  subsEl.className = 'subs';
  subsEl.textContent = `${fmtNumber(item.subscribers)} subscribers`;

  el.appendChild(rankEl);
  el.appendChild(nameEl);
  el.appendChild(subsEl);
  return el;
}

function showError(msg){
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

async function fetchLeaderboardData(){
  const urls = [DEFAULT_API_URL, FALLBACK_DB_URL];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn(`Failed to fetch ${url}:`, err.message);
    }
  }

  throw new Error('Could not load leaderboard data');
}

async function load(){
  try {
    const data = await fetchLeaderboardData();
    let items = Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? Object.values(data)
        : [];

    if (!items.length) {
      items = DEMO_ENTRIES;
    }

    const normalized = items.map(normalizeEntry);
    normalized.sort((a, b) => Number(b.subscribers || 0) - Number(a.subscribers || 0));
    const top = normalized.slice(0, 50);

    grid.innerHTML = '';

    if (!top.length) {
      const empty = document.createElement('div');
      empty.className = 'cell empty-state';
      empty.textContent = 'No leaderboard entries yet.';
      grid.appendChild(empty);
      return;
    }

    for (let i = 0; i < 50; i++) {
      const item = top[i] || { name: '—', subscribers: 0 };
      grid.appendChild(createCell(i + 1, normalizeEntry(item)));
    }
  } catch (err) {
    console.error(err);
    showError('Failed to load leaderboard: ' + err.message);
  }
}

load();
