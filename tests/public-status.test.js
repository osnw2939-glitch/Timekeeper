const assert = require("node:assert/strict");
const test = require("node:test");

const { currentProgressTicket } = require("../api/public-status");

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
