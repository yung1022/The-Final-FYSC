/**
 * Shared offline-growth math.
 *
 * Formula: the `growth` value stored in the realtime database is only valid at
 * the snapshot time (`offlineduration`, a Unix timestamp in seconds). The longer
 * the player has been offline since that snapshot, the more of that growth has
 * decayed away, so the offline gain is the stored growth minus what was lost:
 *
 *   lost          = growth * (1 - 0.9999 ^ (0.2 * (now - offlineduration)))
 *   offlineGrowth = growth - lost
 */

const OFFLINE_GROWTH_DECAY_BASE = 0.9999;
const OFFLINE_GROWTH_TIME_SCALE = 0.2;
const DEFAULT_TOP_LIMIT = 50;

function readSubscribers(entry) {
  const value = Number(
    entry?.subscribers ??
    entry?.subscriberCount ??
    entry?.subs ??
    entry?.sub_count ??
    entry?.subscriber_count ??
    0
  );
  return Number.isFinite(value) ? value : 0;
}

function offlineGrowthAt(growth, offlineTimestamp, currentUnixTime = currentUnixTime()) {
  const growthValue = Number(growth);
  const offlineAt = Number(offlineTimestamp);
  const now = Number(currentUnixTime);

  if (!Number.isFinite(growthValue) || growthValue === 0) return 0;
  if (!Number.isFinite(offlineAt) || offlineAt <= 0) return 0;
  if (!Number.isFinite(now)) return 0;

  const elapsedSeconds = Math.max(0, now - offlineAt);
  // The snapshot's growth is only worth its full value at the snapshot moment;
  // everything decayed since then is lost and must be subtracted.
  const lostGrowth = growthValue * (1 - (OFFLINE_GROWTH_DECAY_BASE ** (OFFLINE_GROWTH_TIME_SCALE * elapsedSeconds)));
  return growthValue - lostGrowth;
}

function currentUnixTime() {
  return Math.floor(Date.now() / 1000);
}

function offlineGrowth(growth, offlineTimestamp, currentUnixTimeValue = currentUnixTime()) {
  return offlineGrowthAt(growth, offlineTimestamp, currentUnixTimeValue);
}

function displayedSubscribers(entry, currentUnixTimeValue = currentUnixTime()) {
  return readSubscribers(entry) + offlineGrowthAt(
    entry?.growth,
    entry?.offlineduration,
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

module.exports = {
  OFFLINE_GROWTH_DECAY_BASE,
  OFFLINE_GROWTH_TIME_SCALE,
  DEFAULT_TOP_LIMIT,
  readSubscribers,
  offlineGrowthAt,
  offlineGrowth,
  displayedSubscribers,
  sortByDisplayedSubscribers,
  topByDisplayedSubscribers,
  currentUnixTime,
};
