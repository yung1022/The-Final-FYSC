const test = require('node:test');
const assert = require('node:assert/strict');

const offlineGrowth = require('../offline-growth');
const battleBoard = require('../battle-board');

const NOW = 1_800_000_000;

function makeEntry(name, subscribers, growth, offlineSecondsAgo = 0) {
  return {
    name,
    subscribers,
    growth,
    offlineduration: NOW - offlineSecondsAgo,
  };
}

function bruteForceCrossover(chaser, defender, now) {
  const difference = (seconds) =>
    offlineGrowth.displayedSubscribers(chaser, now + seconds) -
    offlineGrowth.displayedSubscribers(defender, now + seconds);

  if (difference(0) >= 0) return 0;

  const maxSeconds = 200 * 365 * 24 * 60 * 60;
  let upperBound = 1;
  while (upperBound < maxSeconds && difference(upperBound) < 0) upperBound *= 2;
  if (difference(upperBound) < 0) return Infinity;

  let lowerBound = Math.floor(upperBound / 2);
  while (upperBound - lowerBound > 1) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    if (difference(midpoint) >= 0) upperBound = midpoint;
    else lowerBound = midpoint;
  }
  return upperBound;
}

test('duels only pair connected ranks and skip the top seat', () => {
  const ranked = ['Leader', 'Second', 'Third', 'Fourth', 'Fifth']
    .map((name, index) => makeEntry(name, 1_000_000 - index * 1_000, 0));

  const duels = battleBoard.buildDuels(ranked, NOW);

  assert.deepEqual(
    duels.map((duel) => [duel.defenderRank, duel.chaserRank, duel.defender.name, duel.chaser.name]),
    [
      [2, 3, 'Second', 'Third'],
      [4, 5, 'Fourth', 'Fifth'],
    ],
  );
});

test('crossover agrees with a numeric scan of the same offline-growth formula', () => {
  const chaser = makeEntry('Chaser', 0, 1_000_000);
  const defender = makeEntry('Defender', 500_000, 100_000);

  const closed = battleBoard.crossoverSeconds(chaser, defender, NOW);
  const scanned = bruteForceCrossover(chaser, defender, NOW);

  assert.ok(Number.isFinite(closed), 'expected a real crossover');
  assert.ok(Math.abs(closed - scanned) <= 2, `closed=${closed} scanned=${scanned}`);

  const eta = Math.round(closed);
  const beforeCrossing =
    offlineGrowth.displayedSubscribers(chaser, NOW + eta - 5) -
    offlineGrowth.displayedSubscribers(defender, NOW + eta - 5);
  const afterCrossing =
    offlineGrowth.displayedSubscribers(chaser, NOW + eta + 5) -
    offlineGrowth.displayedSubscribers(defender, NOW + eta + 5);

  assert.ok(beforeCrossing < 0, 'chaser must still be behind just before the ETA');
  assert.ok(afterCrossing >= 0, 'chaser must be level or ahead just after the ETA');
});

test('crossover is never when the chaser cannot reach the ceiling above it', () => {
  const frozenChaser = makeEntry('Frozen', 0, 100_000);
  const frozenDefender = makeEntry('Frozen Above', 500_000, 100_000);
  assert.equal(battleBoard.crossoverSeconds(frozenChaser, frozenDefender, NOW), Infinity);

  const slowChaser = makeEntry('Slow', 0, 100_000);
  const highCeilingDefender = makeEntry('High', 500_000, 10_000);
  assert.equal(battleBoard.crossoverSeconds(slowChaser, highCeilingDefender, NOW), Infinity);
});

test('crossover is zero when the chaser is already ahead', () => {
  const chaser = makeEntry('Ahead', 600_000, 0);
  const defender = makeEntry('Behind', 500_000, 0);
  assert.equal(battleBoard.crossoverSeconds(chaser, defender, NOW), 0);
});
test('the featured duel prefers a real crossover over a tighter frozen gap', () => {
  const ranked = [
    makeEntry('Leader', 1_000_000, 0),
    makeEntry('Second', 900_000, 0),
    makeEntry('Third', 100_000, 2_000_000),
    makeEntry('Fourth', 50_000, 0),
    makeEntry('Fifth', 49_000, 0),
  ];

  const duel = battleBoard.selectBattleDuel(ranked, NOW);

  assert.equal(duel.defenderRank, 2);
  assert.equal(duel.chaserRank, 3);
  assert.ok(Number.isFinite(duel.etaSeconds));
});

test('the featured duel falls back to the tightest gap when nothing can cross', () => {
  const ranked = [
    makeEntry('Leader', 1_000_000, 0),
    makeEntry('Second', 900_000, 0),
    makeEntry('Third', 800_000, 0),
    makeEntry('Fourth', 700_000, 0),
    makeEntry('Fifth', 699_000, 0),
  ];

  const duel = battleBoard.selectBattleDuel(ranked, NOW);

  assert.equal(duel.defenderRank, 4);
  assert.equal(duel.chaserRank, 5);
  assert.equal(duel.gap, 1_000);
  assert.equal(duel.etaSeconds, Infinity);
});

test('equally tight duels resolve to the higher ranked pair', () => {
  const ranked = [
    makeEntry('Leader', 1_000_000, 0),
    makeEntry('Second', 900_000, 0),
    makeEntry('Third', 899_000, 0),
    makeEntry('Fourth', 700_000, 0),
    makeEntry('Fifth', 699_000, 0),
  ];

  const duel = battleBoard.selectBattleDuel(ranked, NOW);

  assert.equal(duel.defenderRank, 2);
  assert.equal(duel.chaserRank, 3);
});

test('a board without a completed pair has no duel to feature', () => {
  assert.equal(battleBoard.selectBattleDuel([], NOW), null);
  assert.equal(battleBoard.selectBattleDuel([makeEntry('Solo', 10, 0)], NOW), null);
});

test('ETA formatting covers seconds, minutes, hours, days and never', () => {
  assert.equal(battleBoard.formatEta(Number.POSITIVE_INFINITY), 'never');
  assert.equal(battleBoard.formatEta(0), 'now');
  assert.equal(battleBoard.formatEta(45), '45s');
  assert.equal(battleBoard.formatEta(750), '12m 30s');
  assert.equal(battleBoard.formatEta(34_620), '9h 37m');
  assert.equal(battleBoard.formatEta(273_600), '3d 4h');
});

test('displayed values match the documented offline-growth formula', () => {
  const elapsedSeconds = 3_600;
  const entry = makeEntry('Growing', 1_000, 5_000, elapsedSeconds);

  const expectedGrowth = 5_000 * (1 - 0.9999 ** (0.2 * elapsedSeconds));
  assert.equal(offlineGrowth.offlineGrowthAt(5_000, NOW - elapsedSeconds, NOW), expectedGrowth);
  assert.equal(offlineGrowth.displayedSubscribers(entry, NOW), 1_000 + expectedGrowth);
  assert.ok(offlineGrowth.offlineGrowthPerSecond(5_000, NOW - elapsedSeconds, NOW) > 0);
});

test('ranking uses displayed counts, so pending growth can climb the board', () => {
  const stored = [
    { name: 'Stored Leader', subscribers: 1_000_000, growth: 0, offlineduration: NOW },
    { name: 'Climber', subscribers: 100_000, growth: 2_000_000, offlineduration: NOW - 86_400 },
  ];

  assert.deepEqual(offlineGrowth.sortByDisplayedSubscribers(stored, NOW).map((entry) => entry.name), [
    'Climber',
    'Stored Leader',
  ]);
  assert.equal(offlineGrowth.topByDisplayedSubscribers(stored, 1, NOW)[0].name, 'Climber');
});

test('growth maths guards against missing or invalid values', () => {
  assert.equal(offlineGrowth.offlineGrowthAt(0, NOW - 10, NOW), 0);
  assert.equal(offlineGrowth.offlineGrowthAt(1_000, 0, NOW), 0);
  assert.equal(offlineGrowth.offlineGrowthAt(1_000, NOW - 10, Number.NaN), 0);
  assert.equal(offlineGrowth.displayedSubscribers({ name: 'Empty' }, NOW), 0);
  assert.equal(offlineGrowth.readSubscribers({ subs: '250' }), 250);
});
