const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cardNumberFromHash,
  createServerClock,
  currentServerTime,
  roundedRemainingMinutes,
} = require("../public-status-logic");

test("card number is read from the URL fragment", () => {
  assert.equal(cardNumberFromHash("#100"), 100);
  assert.equal(cardNumberFromHash("#card=100"), null);
  assert.equal(cardNumberFromHash("#0"), null);
});

test("server clock includes cache age and local elapsed time", () => {
  const receivedAt = Date.parse("2026-07-20T00:00:20.000Z");
  const clock = createServerClock("2026-07-20T00:00:00.000Z", 20, receivedAt);

  assert.equal(
    currentServerTime(clock, receivedAt + 60000),
    Date.parse("2026-07-20T00:01:20.000Z"),
  );
});

test("remaining time counts down locally and rounds up to five minutes", () => {
  const readyAt = "2026-07-20T00:15:00.000Z";

  assert.equal(roundedRemainingMinutes(readyAt, Date.parse("2026-07-20T00:00:00.000Z")), 15);
  assert.equal(roundedRemainingMinutes(readyAt, Date.parse("2026-07-20T00:05:01.000Z")), 10);
  assert.equal(roundedRemainingMinutes(readyAt, Date.parse("2026-07-20T00:10:01.000Z")), 5);
  assert.equal(roundedRemainingMinutes(readyAt, Date.parse("2026-07-20T00:15:00.000Z")), 0);
});
