// Verifies the leaderboard logic added in this change: growth-leader keys and
// the single accelerating-slot highlight. Extracts the functions from script.js
// (top-level DOM code is stripped) and runs them against a stubbed module map.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = '/data/user/0/com.vscodroid/files/home/projects/The-Final-FYSC/leaderboard';
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start !== -1, `function ${name} not found`);
  let depth = 0, i = source.indexOf('{', start);
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  throw new Error('unbalanced');
}

const offlineGrowth = {
  readGrowth: (e) => Number(e.growth ?? 0),
  offlineGrowthAt: () => 0,
  readOfflineTimestamp: () => 0,
  displayedSubscribers: (e) => Number(e.subscribers ?? 0),
  offlineGrowthPerSecond: (growth, ts) => Number(growth) / Math.max(1, Number(ts)),
};
const battleBoard = {};
const window = { OfflineGrowth: offlineGrowth, BattleBoard: battleBoard };
const document = {};
const ACCELERATING_CLASS = 'accelerating';
const ACCELERATING_MIN_SAMPLES = 5;
const ACCELERATING_MIN_RATE = 0.20;
let subscriberHistory = new Map();

const code = [
  'const TOP_CELL_COUNT = 50;',
  extract('calculateOfflineGrowthPerSecond'),
  extract('getPlayerKey'),
  extract('getGrowthLeaderKeys'),
  extract('getAcceleratingPlayerKey'),
].join('\n');

const fnSource = code + '; return { getGrowthLeaderKeys, getAcceleratingPlayerKey };';
// The extracted functions close over the `subscriberHistory` parameter, so the
// factory must be re-run every time the test replaces the history map.
function buildFns(historyMap){
  return new Function('offlineGrowth','battleBoard','window','document','ACCELERATING_CLASS','ACCELERATING_MIN_SAMPLES','ACCELERATING_MIN_RATE','subscriberHistory', fnSource)(
    offlineGrowth, battleBoard, window, document, ACCELERATING_CLASS, ACCELERATING_MIN_SAMPLES, ACCELERATING_MIN_RATE, historyMap);
}
let fns = buildFns(subscriberHistory);
const getGrowthLeaderKeys = (...args) => fns.getGrowthLeaderKeys(...args);
const getAcceleratingPlayerKey = (...args) => fns.getAcceleratingPlayerKey(...args);
// Call this after setting a new `subscriberHistory` so the functions see it.
function refreshFns(){ fns = buildFns(subscriberHistory); }

// --- Test 1: growth leaders order ---
const entries = [
  { userId: 'a', name: 'A', subscribers: 1000, growth: 3000, offlineduration: 100 },
  { userId: 'b', name: 'B', subscribers: 900, growth: 9000, offlineduration: 100 },
  { userId: 'c', name: 'C', subscribers: 800, growth: 6000, offlineduration: 100 },
  { userId: 'd', name: 'D', subscribers: 700, growth: 1000, offlineduration: 100 },
];
const leaders = getGrowthLeaderKeys(entries);
assert.deepStrictEqual(leaders, ['b', 'c', 'a'], `leaders ${leaders}`);
console.log('✔ top-3 growth leaders ranked correctly (b, c, a)');

// --- Test 2: fewer than 3 entries ---
assert.deepStrictEqual(getGrowthLeaderKeys(entries.slice(0, 2)), ['b', 'a']);
console.log('✔ fewer than 3 entries returns only available leaders');

// --- Test 3: accelerating player is found when growth speeds up ---
subscriberHistory = new Map([
  // gains: 10, 20, 40, 80 -> rates: +100% each, avg +100% >= 20% -> accelerating
  ['a', [100, 110, 130, 170, 250]],
  ['b', [500, 501, 502, 503, 504]], // flat-ish gains, rate 0
]);
refreshFns();
let result = getAcceleratingPlayerKey(entries);
assert.strictEqual(result, 'a', `expected a, got ${result}`);
console.log('✔ exactly one slot highlighted when growth accelerates');

// --- Test 4: requirement NOT met when growth is steady ---
refreshFns();
subscriberHistory = new Map([['a', [100, 110, 120, 130, 140]]]); // constant gains, rate 0
refreshFns();
assert.strictEqual(getAcceleratingPlayerKey(entries), null);
console.log('✔ no highlight when growth is steady (requirement not met)');

// --- Test 5: requirement NOT met with too few samples ---
subscriberHistory = new Map([['a', [100, 110, 130, 250]]]); // only 4 samples
refreshFns();
assert.strictEqual(getAcceleratingPlayerKey(entries), null);
console.log('✔ no highlight with fewer than 5 samples');

// --- Test 6: shrinking growth never qualifies ---
subscriberHistory = new Map([['a', [250, 200, 150, 100, 50]]]);
refreshFns();
assert.strictEqual(getAcceleratingPlayerKey(entries), null);
console.log('✔ shrinking history never highlighted');

// --- Test 7: only the single most-accelerating player wins ---
subscriberHistory = new Map([
  ['a', [100, 110, 130, 170, 250]],           // avg +100%
  ['b', [500, 550, 600, 650, 700]],           // avg +0% (steady gains)
]);
refreshFns();
assert.strictEqual(getAcceleratingPlayerKey(entries), 'a');
subscriberHistory = new Map([
  ['a', [100, 110, 120, 130, 140]],           // steady
  ['b', [500, 550, 650, 800, 1000]],          // gains 50,100,150,200 -> rates ~ +100%,+50%,+33% avg ~61%
]);
refreshFns();
assert.strictEqual(getAcceleratingPlayerKey(entries), 'b');
console.log('✔ only one slot highlighted even if several are growing');

console.log('\nAll leaderboard logic checks passed.');
