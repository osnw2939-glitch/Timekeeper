(function registerPublicStatusLogic(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PublicStatusLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPublicStatusLogic() {
  function cardNumberFromHash(hash) {
    const value = String(hash || "").replace(/^#/, "").trim();
    if (!/^\d+$/.test(value)) return null;
    const cardNumber = Number(value);
    return Number.isSafeInteger(cardNumber) && cardNumber > 0 ? cardNumber : null;
  }

  function createServerClock(serverTime, responseAgeSeconds = 0, receivedAt = Date.now()) {
    const serverTimeMs = new Date(serverTime).getTime();
    const ageMs = Math.max(0, Number(responseAgeSeconds) || 0) * 1000;
    return {
      baseTimeMs: Number.isNaN(serverTimeMs) ? receivedAt : serverTimeMs + ageMs,
      receivedAtMs: receivedAt,
    };
  }

  function currentServerTime(clock, now = Date.now()) {
    if (!clock) return now;
    return clock.baseTimeMs + Math.max(0, now - clock.receivedAtMs);
  }

  function roundedRemainingMinutes(estimatedReadyAt, currentTimeMs, stepMinutes = 5) {
    const readyTimeMs = new Date(estimatedReadyAt).getTime();
    const step = Number(stepMinutes);
    if (Number.isNaN(readyTimeMs) || !Number.isFinite(step) || step <= 0) return null;
    const remainingMs = readyTimeMs - currentTimeMs;
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / 60000 / step) * step;
  }

  return {
    cardNumberFromHash,
    createServerClock,
    currentServerTime,
    roundedRemainingMinutes,
  };
});
