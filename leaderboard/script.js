const DEFAULT_API_URL =
  window.LEADERBOARD_API_URL ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/leaderboard/top50'
    : '/api/leaderboard/top50');

const offlineGrowth = window.OfflineGrowth;
const battleBoard = window.BattleBoard;

if (!offlineGrowth || !battleBoard) {
  throw new Error('offline-growth.js and battle-board.js must be loaded before script.js');
}

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
const TOP_CELL_COUNT = 50;
const BATTLE_REFRESH_MS = 1000;
const BATTLE_ROW_WINNER_CLASS = 'battle-winner';
const BATTLE_ROW_CHASER_CLASS = 'battle-chaser';
const BATTLE_FOCUS_CLASS = 'battle-focus';

function fmtNumber(n){
  if(n==null) return '0';
  return Math.round(Number(n)).toLocaleString();
}

/**
 * Displayed subscribers, i.e. the stored count plus offline growth. The formula
 * itself lives in `offline-growth.js`, which is the same copy the battle ETAs
 * are solved from, so the counters and the battle board can never disagree.
 */
function getDisplayedSubscribers(item){
  return offlineGrowth.displayedSubscribers(item);
}

function calculateOfflineGrowthPerSecond(growth, offlineTimestamp){
  return offlineGrowth.offlineGrowthPerSecond(growth, offlineTimestamp);
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

function rankEntries(entries, limit = TOP_CELL_COUNT){
  return entries
    .map(normalizeEntry)
    .sort((a, b) => getDisplayedSubscribers(b) - getDisplayedSubscribers(a))
    .slice(0, limit);
}

function createBattleRow(duel, side){
  const isDefender = side === 'defender';
  const item = isDefender ? duel.defender : duel.chaser;
  const rank = isDefender ? duel.defenderRank : duel.chaserRank;
  const value = isDefender ? duel.defenderValue : duel.chaserValue;

  const row = document.createElement('div');
  row.className = `battle-row ${isDefender ? BATTLE_ROW_WINNER_CLASS : BATTLE_ROW_CHASER_CLASS}`;

  const rankEl = document.createElement('span');
  rankEl.className = 'battle-rank';
  rankEl.textContent = `#${rank}`;

  const nameEl = document.createElement('span');
  nameEl.className = 'battle-name';
  nameEl.textContent = item.name || 'Unknown';

  const valueEl = document.createElement('span');
  valueEl.className = 'battle-value';
  valueEl.textContent = fmtNumber(value);

  row.append(rankEl, nameEl, valueEl);
  return row;
}

function renderBattlePanel(duel){
  battleContentEl.replaceChildren();

  if (!duel) {
    battleContentEl.textContent = 'Waiting for two channels…';
    return;
  }

  const crosses = Number.isFinite(duel.etaSeconds);
  const summary = document.createElement('div');
  summary.className = crosses ? 'battle-summary' : 'battle-summary battle-summary-idle';
  summary.textContent = `Gap ${fmtNumber(duel.gap)} · ETA ${battleBoard.formatEta(duel.etaSeconds)}`;

  battleContentEl.append(
    summary,
    createBattleRow(duel, 'defender'),
    createBattleRow(duel, 'chaser'),
  );
}

function highlightBattleCells(duel){
  for (const card of playerCards.values()) card.classList.remove(BATTLE_FOCUS_CLASS);
  if (!duel) return;

  for (const item of [duel.defender, duel.chaser]) {
    const card = playerCards.get(getPlayerKey(item));
    if (card) card.classList.add(BATTLE_FOCUS_CLASS);
  }
}

/**
 * Channels only battle the channel in the rank connected to them: rank 1 owns
 * the top seat, then 2 battles 3, 4 battles 5, and so on. `battle-board.js`
 * works out which of those duels is closest to resolving; this only paints it.
 */
function renderBattleBoard(){
  if (!hasLoadedOnce && !latestEntries.length) return;

  const duel = battleBoard.selectBattleDuel(rankEntries(latestEntries));
  renderBattlePanel(duel);
  highlightBattleCells(duel);
}

function getMdmGain(item){
  const gain = Number(item.growth ?? item.growthCount ?? item.growthValue ?? 0);
  return Number.isFinite(gain) ? Math.max(0, Math.round(gain)) : 0;
}

function createMdmFire(item){
  const fire = document.createElement('span');
  const gain = getMdmGain(item);
  if (gain < 500000) return null;

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
  const fire = createMdmFire(item);
  if (fire) rankEl.appendChild(fire);

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
  renderGrowthLeaders(normalized);
  normalized.sort((a, b) => getDisplayedSubscribers(b) - getDisplayedSubscribers(a));
  const top = normalized.slice(0, TOP_CELL_COUNT);
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
    renderBattleBoard();
    return;
  }

  const currentDisplayedValues = new Map();
  for (let i = 0; i < TOP_CELL_COUNT; i++) {
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
  renderBattleBoard();
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
setInterval(renderBattleBoard, BATTLE_REFRESH_MS);
