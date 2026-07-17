const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");

const {
  filterValue,
  optionalTimestamp,
  readJson,
  requireBusinessDate,
  requireUuid,
} = require("../api/_validation");

test("accepts real ISO business dates", () => {
  assert.equal(requireBusinessDate("2026-06-02"), "2026-06-02");
  assert.equal(requireBusinessDate("2024-02-29"), "2024-02-29");
});

test("rejects malformed and impossible business dates", () => {
  assert.throws(() => requireBusinessDate("2026-6-2"), { statusCode: 400 });
  assert.throws(() => requireBusinessDate("2026-02-30"), { statusCode: 400 });
  assert.throws(() => requireBusinessDate("2026-06-02&status=eq.waiting"), { statusCode: 400 });
});

test("validates UUIDs used for ticket transitions", () => {
  const id = "f80e62d4-b5f9-4db5-98b8-3d62f95f8f35";
  assert.equal(requireUuid(id), id);
  assert.throws(() => requireUuid("not-a-ticket-id"), { statusCode: 400 });
});

test("normalizes optional timestamps", () => {
  assert.equal(optionalTimestamp(null, "estimatedReturnAt"), null);
  assert.equal(
    optionalTimestamp("2026-06-02T09:15:00+09:00", "estimatedReturnAt"),
    "2026-06-02T00:15:00.000Z",
  );
  assert.throws(() => optionalTimestamp("tomorrow-ish", "estimatedReturnAt"), { statusCode: 400 });
});

test("reads valid JSON and rejects invalid or oversized request bodies", async () => {
  assert.deepEqual(await readJson(Readable.from([Buffer.from('{"action":"issue"}')])), {
    action: "issue",
  });

  await assert.rejects(() => readJson(Readable.from([Buffer.from("{")])), { statusCode: 400 });
  await assert.rejects(() => readJson(Readable.from([Buffer.alloc(16 * 1024 + 1, "x")])), {
    statusCode: 413,
  });
});

test("encodes values before adding them to PostgREST filters", () => {
  assert.equal(filterValue("2026-06-02&status=eq.waiting"), "2026-06-02%26status%3Deq.waiting");
});
