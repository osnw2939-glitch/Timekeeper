const assert = require("node:assert/strict");
const test = require("node:test");

const { currentProgressTicket, ticketStatusesByCard } = require("../api/public-status");

test("current progress does not move backward when a lower number arrives later", () => {
  const current = currentProgressTicket([
    { actual_number: 100, card_number: 100, status: "admitted" },
    { actual_number: 60, card_number: 60, status: "admitted" },
  ]);

  assert.equal(current.card_number, 100);
});

test("an absent ticket advances the processed progress", () => {
  const current = currentProgressTicket([
    { actual_number: 100, card_number: 100, status: "admitted" },
    { actual_number: 101, card_number: 101, status: "no_show" },
    { actual_number: 102, card_number: 102, status: "waiting" },
  ]);

  assert.equal(current.card_number, 101);
});

test("card numbers are displayed from the highest internal sequence after looping", () => {
  const current = currentProgressTicket([
    { actual_number: 100, card_number: 100, status: "admitted" },
    { actual_number: 501, card_number: 1, status: "admitted" },
  ]);

  assert.equal(current.card_number, 1);
});

test("personal status exposes only public card information", () => {
  const now = new Date("2026-07-20T01:00:00.000Z");
  const tickets = Array.from({ length: 7 }, (_, index) => ({
    actual_number: index + 1,
    card_number: index + 1,
    status: "admitted",
    admitted_at: new Date(now.getTime() - (7 - index) * 60000).toISOString(),
  }));
  tickets.push({
    actual_number: 8,
    card_number: 8,
    status: "waiting",
    estimated_return_at: "2026-07-20T01:15:00.000Z",
  });

  const statuses = ticketStatusesByCard(tickets, { bootstrap_interval_minutes: 1 }, now);

  assert.deepEqual(statuses["8"], {
    status: "waiting",
    promisedReturnAt: "2026-07-20T01:15:00.000Z",
    estimatedReadyAt: "2026-07-20T01:01:00.000Z",
  });
  assert.equal("actualNumber" in statuses["8"], false);
});

test("a lower waiting number is ready after progress moved past it", () => {
  const now = new Date("2026-07-20T03:00:00.000Z");
  const statuses = ticketStatusesByCard(
    [
      { actual_number: 60, card_number: 60, status: "waiting" },
      { actual_number: 100, card_number: 100, status: "admitted", admitted_at: now.toISOString() },
    ],
    { bootstrap_interval_minutes: 1 },
    now,
  );

  assert.equal(statuses["60"].estimatedReadyAt, now.toISOString());
});

test("opening fallback keeps the eighth group at 9:15 when its promise is missing", () => {
  const now = new Date("2026-07-19T23:30:00.000Z");
  const tickets = Array.from({ length: 8 }, (_, index) => ({
    actual_number: index + 1,
    card_number: index + 1,
    status: "waiting",
  }));

  const statuses = ticketStatusesByCard(tickets, { bootstrap_interval_minutes: 1 }, now);

  assert.equal(statuses["7"].estimatedReadyAt, "2026-07-20T00:00:00.000Z");
  assert.equal(statuses["8"].estimatedReadyAt, "2026-07-20T00:15:00.000Z");
});
