/**
 * Offline-growth math shared by the standalone leaderboard server.
 *
 * This mirrors `lib/offline-growth.js` (used by the Vercel API) and the browser
 * formula in `script.js`, so the server, the API and the client all rank
 * players identically:
 *
 *   offlineGrowth = growth * (1 - 0.9999 ^ (0.2 * (now - offlineduration)))
 *
 * `offlineduration` is the Unix timestamp in seconds at which the snapshot was
 * written, and the displayed count is the stored count plus pending growth.
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

function offlineGrowthAt(growth, offlineTimestamp, currentUnixTime) {
  const growthValue = Number(growth);
  const offlineAt = Number(offlineTimestamp);
  const now = Number(currentUnixTime);

  if (!Number.isFinite(growthValue) || growthValue === 0) return 0;
  if (!Number.isFinite(offlineAt) || offlineAt <= 0) return 0;
  if (!Number.isFinite(now)) return 0;

  const elapsedSeconds = Math.max(0, now - offlineAt);
  return growthValue * (1 - (OFFLINE_GROWTH_DECAY_BASE ** (OFFLINE_GROWTH_TIME_SCALE * elapsedSeconds)));
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
