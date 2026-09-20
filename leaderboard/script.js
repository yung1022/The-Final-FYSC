const DEFAULT_API_URL =
  window.LEADERBOARD_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/leaderboard/top50'
    : '/api/leaderboard/top50');

const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');
const growthListEl = document.getElementById('growth-list');
const battleContentEl = document.getElementById('battle-content');
let previousRanks = new Map();
let previousDisplayedValues = new Map();
let hasLoadedOnce = false;
let latestEntries = [];
const playerTimers = new Map();
const playerCards = new Map();
const subscriberHistory = new Map();
const GRAPH_MAX_POINTS = 200;

function fmtNumber(n){
  if(n==null) return '0';
  return Math.round(Number(n)).toLocaleString();
}

/**
 * Offline growth: growth * (1 - 0.9999 ^ (0.2 * (now - offlineduration))).
 *
 * This MUST stay identical to `offlineGrowthAt` in `lib/offline-growth.js` and
 * `leaderboard/offline-growth.js`. The server now applies this formula to every
 * entry before slicing the top 50, so the client only re-applies it to animate
 * the live counters — any drift here would reorder the board against the API.
 */
const OFFLINE_GROWTH_DECAY_BASE = 0.9999;
const OFFLINE_GROWTH_TIME_SCALE = 0.2;

function calculateOfflineGrowthAt(growth, offlineTimestamp, currentUnixTime){
  const growthValue = Number(growth);
  const offlineAt = Number(offlineTimestamp);
  const now = Number(currentUnixTime);

  if (!Number.isFinite(growthValue) || growthValue === 0) return 0;
  if (!Number.isFinite(offlineAt) || offlineAt <= 0) return 0;
  if (!Number.isFinite(now)) return 0;

  const elapsedSeconds = Math.max(0, now - offlineAt);
  return growthValue * (1 - (OFFLINE_GROWTH_DECAY_BASE ** (OFFLINE_GROWTH_TIME_SCALE * elapsedSeconds)));
}

function calculateOfflineGrowth(growth, offlineTimestamp){
  return calculateOfflineGrowthAt(growth, offlineTimestamp, Math.floor(Date.now() / 1000));
}

function calculateOfflineGrowthPerSecond(growth, offlineTimestamp){
  const currentUnixTime = Math.floor(Date.now() / 1000);
  return calculateOfflineGrowthAt(growth, offlineTimestamp, currentUnixTime + 1) -
    calculateOfflineGrowthAt(growth, offlineTimestamp, currentUnixTime);
}

function getDisplayedSubscribers(item){
  return item.subscribers + calculateOfflineGrowth(item.growth, item.offlineduration);
}

function fmtGrowth(n){
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
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

  const target = Math.max(0, Math.round(Number(value) || 0));
  const start = previousValue == null
    ? target
    : Math.max(0, Math.round(Number(previousValue) || 0));
  odometer.textContent = String(start);

  if (window.Odometer) {
    const counter = new window.Odometer({
      el: odometer,
      value: start,
      format: '(,ddd)',
      theme: 'default',
      duration: 1800,
    });
    if (start !== target) {
      window.setTimeout(() => counter.update(target), 30);
    }
  } else {
    odometer.textContent = fmtNumber(target);
  }

  return odometer;
}

function createGraph(key, value){
  const history = subscriberHistory.get(key) || [];
  history.push(value);
  subscriberHistory.set(key, history.slice(-GRAPH_MAX_POINTS));

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

function getEtaSeconds(item){
  const eta = Number(item.eta ?? item.etaSeconds ?? item.etaTime ?? item.timeToNext ?? Infinity);
  return Number.isFinite(eta) && eta >= 0 ? eta : Infinity;
}

function selectBattleChannels(items){
  const withEta = items.filter((item) => getEtaSeconds(item) !== Infinity);
  const candidates = withEta.length >= 2 ? withEta : items;
  return [...candidates]
    .sort((a, b) => {
      const etaDifference = getEtaSeconds(a) - getEtaSeconds(b);
      if (Number.isFinite(etaDifference) && etaDifference !== 0) return etaDifference;
      return getDisplayedSubscribers(b) - getDisplayedSubscribers(a);
    })
    .slice(0, 2);
}

function formatEta(seconds){
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function renderBattle(items){
  const channels = selectBattleChannels(items);
  battleContentEl.replaceChildren();
  if (channels.length < 2) {
    battleContentEl.textContent = 'Waiting for two channels…';
    return;
  }

  const [first, second] = channels;
  const sharedGap = Math.abs(getDisplayedSubscribers(first) - getDisplayedSubscribers(second));
  const sharedEta = Math.min(getEtaSeconds(first), getEtaSeconds(second));
  const summary = document.createElement('div');
  summary.className = 'battle-summary';
  summary.textContent = `Gap ${fmtNumber(sharedGap)} · ETA ${formatEta(sharedEta)}`;

  const firstRow = document.createElement('div');
  firstRow.className = 'battle-row battle-winner';
  firstRow.textContent = `${first.name || 'Unknown'} · ${fmtNumber(getDisplayedSubscribers(first))} subs`;
  const secondRow = document.createElement('div');
  secondRow.className = 'battle-row';
  secondRow.textContent = `${second.name || 'Unknown'} · ${fmtNumber(getDisplayedSubscribers(second))} subs`;
  battleContentEl.append(summary, firstRow, secondRow);
}

function getMdmGain(item){
  const gain = Number(item.growth ?? item.growthCount ?? item.growthValue ?? 0);
  return Number.isFinite(gain) ? Math.max(0, Math.round(gain)) : 0;
}

function createMdmFire(item){
  const fire = document.createElement('span');
  const gain = getMdmGain(item);
  const level = gain >= 25000000
    ? 'fire-red'
    : gain >= 8000000
      ? 'fire-orange'
      : gain >= 2500000
        ? 'fire-yellow'
        : 'fire-blue';
  fire.className = `mdm-fire ${level}`;
  fire.textContent = '🔥';
  fire.setAttribute('aria-label', `MDM fire: ${fmtNumber(gain)} subscribers gained`);
  fire.title = `${fmtNumber(gain)} subscriber${gain === 1 ? '' : 's'} gained`;
  return fire;
}

function createCell(rank, item, previousValue, key){
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.playerKey = key;

  const rankEl = document.createElement('div');
  rankEl.className = 'rank';
  rankEl.textContent = `#${rank}`;
  rankEl.appendChild(createMdmFire(item));

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
  const graphRow = document.createElement('div');
  graphRow.className = 'graph-row';
  graphRow.appendChild(createGraph(key, displayedValue));

  el.appendChild(rankEl);
  el.appendChild(imageEl);
  const content = document.createElement('div');
  content.className = 'cell-content';
  content.appendChild(nameEl);
  content.appendChild(subsEl);
  el.appendChild(content);
  el.appendChild(graphRow);
  return el;
}

function updatePlayerCard(item){
  const key = getPlayerKey(item);
  const card = playerCards.get(key);
  if (!card) return;

  const previousValue = previousDisplayedValues.get(key);
  const displayedValue = getDisplayedSubscribers(item);
  const metrics = card.querySelector('.player-metrics');
  const graphRow = card.querySelector('.graph-row');

  if (!metrics || !graphRow) return;

  metrics.replaceChildren(createOdometer(displayedValue, previousValue));
  graphRow.replaceChildren(createGraph(key, displayedValue));
  previousDisplayedValues.set(key, displayedValue);
}

function renderGrowthLeaders(items){
  const leaders = items
    .map((item) => ({ item, growth: calculateOfflineGrowthPerSecond(item.growth, item.offlineduration) }))
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 3);

  growthListEl.innerHTML = '';
  leaders.forEach(({ item, growth }, index) => {
    const row = document.createElement('div');
    row.className = 'growth-row';

    const rank = document.createElement('span');
    rank.className = 'growth-rank';
    rank.textContent = `#${index + 1}`;

    const name = document.createElement('span');
    name.className = 'growth-name';
    name.textContent = item.name || 'Unknown';

    const value = document.createElement('span');
    value.className = 'growth-value';
    value.textContent = `+${fmtGrowth(growth)}`;

    row.append(rank, name, value);
    growthListEl.appendChild(row);
  });
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
    const currentItem = latestEntries.map(normalizeEntry).find((entry) => getPlayerKey(entry) === key);
    if (currentItem) updatePlayerCard(currentItem);
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
  renderBattle(normalized);
  renderGrowthLeaders(normalized);
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
  playerCards.clear();

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
    const card = createCell(i + 1, normalizedItem, previousDisplayedValues.get(key), key);
    playerCards.set(key, card);
    grid.appendChild(card);
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
