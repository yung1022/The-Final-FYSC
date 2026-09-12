const DEFAULT_API_URL =
  window.LEADERBOARD_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/leaderboard/top50'
    : '/api/leaderboard/top50');

const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');
const refreshStatusEl = document.getElementById('refresh-status');
let previousRanks = new Map();
let previousDisplayedValues = new Map();
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

function createOdometer(value, previousValue){
  const odometer = document.createElement('div');
  odometer.className = 'odometer';
  odometer.setAttribute('aria-label', fmtNumber(value));

  const formatted = Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
  const previousFormatted = previousValue == null
    ? formatted
    : Math.max(0, Math.round(Number(previousValue) || 0)).toLocaleString();
  const previousDigitString = previousFormatted.replace(/,/g, '').slice(-formatted.replace(/,/g, '').length).padStart(
    formatted.replace(/,/g, '').length,
    ' '
  );
  let digitIndex = 0;

  for (const character of formatted) {
    if (character === ',') {
      const separator = document.createElement('span');
      separator.className = 'odometer-separator';
      separator.textContent = ',';
      odometer.appendChild(separator);
      continue;
    }

    const digit = Number(character);
    const previousDigit = Number(previousDigitString[digitIndex])
      || (previousDigitString[digitIndex] === '0' ? 0 : digit);
    digitIndex += 1;
    const slot = document.createElement('span');
    slot.className = 'odometer-digit';

    const track = document.createElement('span');
    track.className = 'odometer-track';
    for (let number = 0; number <= 9; number++) {
      const face = document.createElement('span');
      face.textContent = number;
      track.appendChild(face);
    }

    slot.appendChild(track);
    odometer.appendChild(slot);
    track.style.transform = `translateY(-${previousDigit * 10}%)`;
    requestAnimationFrame(() => {
      track.style.transform = `translateY(-${digit * 10}%)`;
    });
  }

  return odometer;
}

function createCell(rank, item, previousValue){
  const el = document.createElement('div');
  el.className = 'cell';

  const rankEl = document.createElement('div');
  rankEl.className = 'rank';
  rankEl.textContent = `#${rank}`;

  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = item.name || 'Unknown';

  const subsEl = document.createElement('div');
  const offlineGrowth = calculateOfflineGrowth(item.growth, item.offlineduration);
  subsEl.appendChild(createOdometer(item.subscribers + offlineGrowth, previousValue));

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

    const currentDisplayedValues = new Map();
    for (let i = 0; i < 50; i++) {
      const item = top[i] || { name: '—', subscribers: 0 };
      const normalizedItem = normalizeEntry(item);
      const offlineGrowth = calculateOfflineGrowth(normalizedItem.growth, normalizedItem.offlineduration);
      const displayedValue = normalizedItem.subscribers + offlineGrowth;
      const key = String(normalizedItem.userId || normalizedItem.id || normalizedItem.name);
      currentDisplayedValues.set(key, displayedValue);
      grid.appendChild(createCell(i + 1, normalizedItem, previousDisplayedValues.get(key)));
    }

    previousDisplayedValues = currentDisplayedValues;
  } catch (err) {
    console.error(err);
    showError('Failed to load leaderboard: ' + err.message);
  }
}

load();
setInterval(load, 15000);
