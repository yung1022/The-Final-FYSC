const DEFAULT_API_URL =
  window.LEADERBOARD_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/leaderboard/top50'
    : '/api/leaderboard/top50');

const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');
let previousRanks = new Map();
let previousDisplayedValues = new Map();
let hasLoadedOnce = false;
let latestEntries = [];
const playerTimers = new Map();
const subscriberHistory = new Map();

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

function getDisplayedSubscribers(item){
  return item.subscribers + calculateOfflineGrowth(item.growth, item.offlineduration);
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

function createGraph(key, value){
  const history = subscriberHistory.get(key) || [];
  history.push(value);
  subscriberHistory.set(key, history.slice(-16));

  const values = subscriberHistory.get(key);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graph.classList.add('sub-graph');
  graph.setAttribute('viewBox', '0 0 100 100');
  graph.setAttribute('preserveAspectRatio', 'none');
  graph.setAttribute('aria-label', 'Subscriber count history');

  const points = values.map((point, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const normalized = range === 0 ? 0.5 : (point - minimum) / range;
    const y = 91 - normalized * 82;
    return `${x},${y}`;
  }).join(' ');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  graph.appendChild(line);

  return graph;
}

function createCell(rank, item, previousValue, key){
  const el = document.createElement('div');
  el.className = 'cell';

  const rankEl = document.createElement('div');
  rankEl.className = 'rank';
  rankEl.textContent = `#${rank}`;

  const imageUrl = item.image || item.imageUrl || item.avatarUrl;
  const imageEl = document.createElement(imageUrl ? 'img' : 'span');
  imageEl.className = 'player-image';
  imageEl.textContent = imageUrl ? '' : '?';
  imageEl.alt = `${item.name || 'Unknown'} avatar`;
  if (imageUrl) {
    imageEl.loading = 'lazy';
    imageEl.src = imageUrl;
    imageEl.addEventListener('error', () => {
      const fallback = document.createElement('span');
      fallback.className = 'player-image image-fallback';
      fallback.textContent = '?';
      imageEl.replaceWith(fallback);
    }, { once: true });
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'name player-name';
  nameEl.textContent = item.name || 'Unknown';

  const subsEl = document.createElement('div');
  subsEl.className = 'player-metrics';
  const displayedValue = getDisplayedSubscribers(item);
  subsEl.appendChild(createOdometer(displayedValue, previousValue));
  subsEl.appendChild(createGraph(key, displayedValue));

  el.appendChild(rankEl);
  el.appendChild(imageEl);
  const content = document.createElement('div');
  content.className = 'cell-content';
  content.appendChild(nameEl);
  content.appendChild(subsEl);
  el.appendChild(content);
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

function getPlayerKey(item){
  return String(item.userId || item.id || item.name);
}

function schedulePlayerCalculation(item){
  const key = getPlayerKey(item);
  if (playerTimers.has(key)) return;
  playerTimers.set(key, setTimeout(() => {
    playerTimers.delete(key);
    renderLeaderboard();
    schedulePlayerCalculation(item);
  }, 5000 + Math.random() * 5000));
}

function syncPlayerTimers(items){
  const activeKeys = new Set(items.map(getPlayerKey));
  for (const [key, timer] of playerTimers) {
    if (!activeKeys.has(key)) {
      clearTimeout(timer);
      playerTimers.delete(key);
    }
  }
  for (const item of items) schedulePlayerCalculation(item);
}

function renderLeaderboard(){
  const normalized = latestEntries.map(normalizeEntry);
  normalized.sort((a, b) => getDisplayedSubscribers(b) - getDisplayedSubscribers(a));
  const top = normalized.slice(0, 50);
  syncPlayerTimers(normalized);

  const currentRanks = new Map(top.map((item, index) => [getPlayerKey(item), index + 1]));
  const someonePassed = hasLoadedOnce && top.some((item, index) => {
    const key = getPlayerKey(item);
    return previousRanks.has(key) && previousRanks.get(key) !== index + 1;
  });

  if (someonePassed) {
    grid.classList.remove('rank-refresh');
    void grid.offsetWidth;
    grid.classList.add('rank-refresh');
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
    const displayedValue = getDisplayedSubscribers(normalizedItem);
    const key = getPlayerKey(normalizedItem);
    currentDisplayedValues.set(key, displayedValue);
    grid.appendChild(createCell(i + 1, normalizedItem, previousDisplayedValues.get(key), key));
  }

  previousDisplayedValues = currentDisplayedValues;
}

async function load(){
  try {
    const data = await fetchLeaderboardData();
    latestEntries = Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? Object.values(data)
        : [];
    renderLeaderboard();
  } catch (err) {
    console.error(err);
    showError('Failed to load leaderboard: ' + err.message);
  }
}

load();
setInterval(load, 15000);
