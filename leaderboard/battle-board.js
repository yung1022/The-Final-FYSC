/**
 * Battle-board maths: which two channels are battling, and when the lower one
 * overtakes the upper one.
 *
 * Duels only ever happen between connected ranks. Rank 1 owns the top seat, then
 * rank 2 battles 3, rank 4 battles 5, rank 6 battles 7, and so on. Of those
 * duels the board shows whichever resolves first: the one with the soonest real
 * crossover, or - when no connected duel can ever cross - the tightest gap.
 *
 * The ETA (crossover) is solved in closed form from the offline-growth formula
 * in `offline-growth.js`. Both counts follow
 *
 *   displayed(t) = subscribers + growth * (1 - b ^ (k * (now + t - offlineduration)))
 *
 * so the difference between a chaser and the channel it is chasing is linear in
 * u = b ^ (k * t):
 *
 *   difference = (chaserCeiling - defenderCeiling)
 *              - u * (chaserGrowth * chaserDecay - defenderGrowth * defenderDecay)
 *
 * where ceiling = subscribers + growth and
 * decay = b ^ (k * (now - offlineduration)). Solving difference = 0 gives u, and
 * t = ln(u) / (k * ln(b)).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./offline-growth'));
    return;
  }

  root.BattleBoard = factory(root.OfflineGrowth);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (offlineGrowth) {
  'use strict';

  if (!offlineGrowth) {
    throw new Error('battle-board.js requires offline-growth.js to be loaded first');
  }

  const LEADER_RANK = 1;   // rank 1 owns the top seat and never duels
  const DUEL_STRIDE = 2;   // rank 2 battles 3, rank 4 battles 5, ...
  const RANK_OFFSET = 1;   // zero-based index -> one-based rank

  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
  const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

  const OFFLINE_GROWTH_DECAY_BASE = offlineGrowth.OFFLINE_GROWTH_DECAY_BASE;
  const OFFLINE_GROWTH_TIME_SCALE = offlineGrowth.OFFLINE_GROWTH_TIME_SCALE;
  const DECAY_RATE = OFFLINE_GROWTH_TIME_SCALE * Math.log(OFFLINE_GROWTH_DECAY_BASE); // negative

  /** Final displayed count once every pending subscriber has accrued. */
  function ceilingSubscribers(entry) {
    return offlineGrowth.readSubscribers(entry) + Math.max(0, offlineGrowth.readGrowth(entry));
  }

  /** Subscribers still to accrue per second at `unixTime` (decays towards zero). */
  function remainingGrowthRate(entry, unixTime) {
    const elapsedSeconds = Math.max(0, unixTime - offlineGrowth.readOfflineTimestamp(entry));
    return offlineGrowth.readGrowth(entry) *
      Math.pow(OFFLINE_GROWTH_DECAY_BASE, OFFLINE_GROWTH_TIME_SCALE * elapsedSeconds);
  }

  /**
   * Seconds until `chaser` overtakes `defender`, or Infinity when it never will.
   * Returns 0 when the chaser has already caught up.
   */
  function crossoverSeconds(chaser, defender, unixTime = offlineGrowth.currentUnixTime()) {
    const differenceNow =
      offlineGrowth.displayedSubscribers(chaser, unixTime) -
      offlineGrowth.displayedSubscribers(defender, unixTime);
    if (differenceNow >= 0) return 0;

    const growthSlope = remainingGrowthRate(chaser, unixTime) - remainingGrowthRate(defender, unixTime);
    if (growthSlope === 0) return Number.POSITIVE_INFINITY; // the gap never moves

    const remainingFraction = (ceilingSubscribers(chaser) - ceilingSubscribers(defender)) / growthSlope;
    if (!(remainingFraction > 0) || remainingFraction > 1) return Number.POSITIVE_INFINITY;
    if (remainingFraction === 1) return 0;

    return Math.log(remainingFraction) / DECAY_RATE;
  }

  /** Every connected-rank duel in a ranked list: (2 vs 3), (4 vs 5), (6 vs 7), ... */
  function buildDuels(rankedEntries, unixTime = offlineGrowth.currentUnixTime()) {
    const duels = [];

    for (let index = LEADER_RANK; index + 1 < rankedEntries.length; index += DUEL_STRIDE) {
      const defender = rankedEntries[index];
      const chaser = rankedEntries[index + 1];
      const defenderValue = offlineGrowth.displayedSubscribers(defender, unixTime);
      const chaserValue = offlineGrowth.displayedSubscribers(chaser, unixTime);

      duels.push({
        defender,
        chaser,
        defenderRank: index + RANK_OFFSET,
        chaserRank: index + RANK_OFFSET + 1,
        defenderValue,
        chaserValue,
        gap: Math.abs(defenderValue - chaserValue),
        etaSeconds: crossoverSeconds(chaser, defender, unixTime),
      });
    }

    return duels;
  }

  function isBetterDuel(candidate, best) {
    const candidateCrosses = Number.isFinite(candidate.etaSeconds);
    const bestCrosses = Number.isFinite(best.etaSeconds);

    if (candidateCrosses !== bestCrosses) return candidateCrosses;
    if (candidateCrosses) return candidate.etaSeconds < best.etaSeconds;
    return candidate.gap < best.gap;
  }

  /** The duel to feature: soonest crossover if any duel has one, else tightest gap. */
  function selectBattleDuel(rankedEntries, unixTime = offlineGrowth.currentUnixTime()) {
    const duels = buildDuels(rankedEntries, unixTime);
    if (!duels.length) return null;

    return duels.reduce((best, duel) => (isBetterDuel(duel, best) ? duel : best));
  }

  /** Compact duration for the panel: "45s", "12m 30s", "9h 37m", "3d 4h". */
  function formatEta(seconds) {
    if (!Number.isFinite(seconds)) return 'never';

    const total = Math.round(seconds);
    if (total <= 0) return 'now';

    const days = Math.floor(total / SECONDS_PER_DAY);
    const hours = Math.floor((total % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
    const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const remainingSeconds = total % SECONDS_PER_MINUTE;

    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
  }

  return {
    LEADER_RANK,
    DUEL_STRIDE,
    ceilingSubscribers,
    remainingGrowthRate,
    crossoverSeconds,
    buildDuels,
    selectBattleDuel,
    formatEta,
  };
});
