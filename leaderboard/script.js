const DEFAULT_API_URL =
  window.LEADERBOARD_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/leaderboard/top50'
    : '/api/leaderboard/top50');

const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');
const refreshStatusEl = document.getElementById('refresh-status');
let previousRanks = new Map();
let hasLoadedOnce = false;

function fmtNumber(n){
  if(n==null) return '0';
  return Math.round(Number(n)).toLocaleString();
}

function calculateOfflineGrowth(growth, offlineTimestamp){
  const x = Number(growth);
  const timestamp = Number(offlineTimestamp);
  const currentUnixTime = Math.floor(Date.now() / 1000);
  const y = currentUnixTime - timestamp;

  if (!Number.isFinite(x) || !Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(y)) return 0;
  return x * (1 - (0.9999 ** (0.2 * Math.max(0, y))));
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
    growth: Number(entry.growth ?? 0),
    offlineduration: Number(entry.offlineduration ?? 0),
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
  subsEl.className = 'subs odometer';
  const offlineGrowth = calculateOfflineGrowth(item.growth, item.offlineduration);
  subsEl.textContent = fmtNumber(item.subscribers + offlineGrowth);

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
  const res = await fetch(DEFAULT_API_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`API returned HTTP ${res.status}`);
  }
  return res.json();
}

async function load(){
  try {
    const data = await fetchLeaderboardData();
    let items = Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? Object.values(data)
        : [];

    const normalized = items.map(normalizeEntry);
    normalized.sort((a, b) => Number(b.subscribers || 0) - Number(a.subscribers || 0));
    const top = normalized.slice(0, 50);

    const currentRanks = new Map(top.map((item, index) => [String(item.userId || item.id || item.name), index + 1]));
    const someonePassed = hasLoadedOnce && top.some((item, index) => {
      const key = String(item.userId || item.id || item.name);
      return previousRanks.has(key) && previousRanks.get(key) !== index + 1;
    });

    if (someonePassed) {
      grid.classList.remove('rank-refresh');
      void grid.offsetWidth;
      grid.classList.add('rank-refresh');
      refreshStatusEl.textContent = 'Rankings refreshed · someone moved up';
    } else {
      refreshStatusEl.textContent = `Last checked ${new Date().toLocaleTimeString()}`;
    }

    previousRanks = currentRanks;
    hasLoadedOnce = true;

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
setInterval(load, 15000);
