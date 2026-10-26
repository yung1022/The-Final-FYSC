/**
 * Offline-growth maths shared by every consumer.
 *
 * The same maths powers:
 *   - the Vercel API (`lib/offline-growth.js` holds the API's copy),
 *   - the standalone Node server (`db.js` and `api/leaderboard.js` require this file),
 *   - the browser board, which loads this file as a plain script and reads `window.OfflineGrowth`.
 *
 * Formula: the `growth` value stored in the realtime database is only valid at
 * the snapshot time (`offlineduration`, a Unix timestamp in seconds). The longer
 * the player has been offline since that snapshot, the more of that growth has
 * decayed away, so the offline gain is the stored growth minus what was lost:
 *
 *   lost          = growth * (1 - 0.9999 ^ (0.2 * (now - offlineduration)))
 *   offlineGrowth = growth - lost
 *
 * `offlineduration` is the Unix timestamp in seconds at which the snapshot was
 * written. The displayed subscriber count is the stored count plus the growth
 * that has accrued since that timestamp.
 */

(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  root.OfflineGrowth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OFFLINE_GROWTH_DECAY_BASE = 0.9999;
  const OFFLINE_GROWTH_TIME_SCALE = 0.2;
  const DEFAULT_TOP_LIMIT = 50;

  function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function readSubscribers(entry) {
    return toFiniteNumber(
      entry?.subscribers ??
      entry?.subscriberCount ??
      entry?.subs ??
      entry?.sub_count ??
      entry?.subscriber_count,
      0
    );
  }

  function readGrowth(entry) {
    return toFiniteNumber(entry?.growth ?? entry?.growthCount ?? entry?.growthValue, 0);
  }

  function readOfflineTimestamp(entry) {
    return toFiniteNumber(entry?.offlineduration ?? entry?.offlineDuration, 0);
  }

  function currentUnixTime() {
    return Math.floor(Date.now() / 1000);
  }

  function offlineGrowthAt(growth, offlineTimestamp, currentUnixTimeValue = currentUnixTime()) {
    const growthValue = toFiniteNumber(growth, 0);
    const offlineAt = toFiniteNumber(offlineTimestamp, 0);
    const now = toFiniteNumber(currentUnixTimeValue, NaN);

    if (growthValue === 0) return 0;
    if (offlineAt <= 0) return 0;
    if (!Number.isFinite(now)) return 0;

    const elapsedSeconds = Math.max(0, now - offlineAt);
    // The snapshot's growth is only worth its full value at the snapshot moment;
    // everything decayed since then is lost and must be subtracted.
    const lostGrowth = growthValue * (1 - (OFFLINE_GROWTH_DECAY_BASE ** (OFFLINE_GROWTH_TIME_SCALE * elapsedSeconds)));
    return growthValue - lostGrowth;
  }

  function offlineGrowth(growth, offlineTimestamp, currentUnixTimeValue = currentUnixTime()) {
    return offlineGrowthAt(growth, offlineTimestamp, currentUnixTimeValue);
  }

    /**
   * Growth lost in a single second, used by the "fastest growing" panel. The
   * remaining offline growth now decays over time, so this is the (positive)
   * magnitude of the per-second loss.
   */
  function offlineGrowthPerSecond(growth, offlineTimestamp, currentUnixTimeValue = currentUnixTime()) {
    return offlineGrowthAt(growth, offlineTimestamp, currentUnixTimeValue) -
      offlineGrowthAt(growth, offlineTimestamp, currentUnixTimeValue + 1);
  }

  function displayedSubscribers(entry, currentUnixTimeValue = currentUnixTime()) {
    return readSubscribers(entry) + offlineGrowthAt(
      readGrowth(entry),
      readOfflineTimestamp(entry),
      currentUnixTimeValue
    );
  }

  function sortByDisplayedSubscribers(entries, currentUnixTimeValue = currentUnixTime()) {
    return [...entries].sort(
      (a, b) => displayedSubscribers(b, currentUnixTimeValue) - displayedSubscribers(a, currentUnixTimeValue)
    );
  }

  function topByDisplayedSubscribers(entries, limit = DEFAULT_TOP_LIMIT, currentUnixTimeValue = currentUnixTime()) {
    return sortByDisplayedSubscribers(entries, currentUnixTimeValue).slice(0, limit);
  }

  return {
    OFFLINE_GROWTH_DECAY_BASE,
    OFFLINE_GROWTH_TIME_SCALE,
    DEFAULT_TOP_LIMIT,
    toFiniteNumber,
    readSubscribers,
    readGrowth,
    readOfflineTimestamp,
    currentUnixTime,
    offlineGrowthAt,
    offlineGrowth,
    offlineGrowthPerSecond,
    displayedSubscribers,
    sortByDisplayedSubscribers,
    topByDisplayedSubscribers,
  };
});
