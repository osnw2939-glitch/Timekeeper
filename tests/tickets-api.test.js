const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");

const TICKET_ID = "f80e62d4-b5f9-4db5-98b8-3d62f95f8f35";
const BUSINESS_DATE = "2026-06-02";

function request(method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { "x-admin-token": "test-admin-token" };
  return req;
}

function response() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value ? JSON.parse(value) : null;
    },
  };
}

async function withTicketsHandler(supabase, callback) {
  const supabasePath = require.resolve("../api/_supabase");
  const ticketsPath = require.resolve("../api/tickets");
  const originalSupabase = require.cache[supabasePath];
  const originalToken = process.env.ADMIN_TOKEN;

  process.env.ADMIN_TOKEN = "test-admin-token";
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: supabase,
    children: [],
    paths: [],
  };
  delete require.cache[ticketsPath];

  try {
    await callback(require(ticketsPath));
  } finally {
    delete require.cache[ticketsPath];
    if (originalSupabase) require.cache[supabasePath] = originalSupabase;
    else delete require.cache[supabasePath];
    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  }
}

test("ticket API rejects unsafe dates before querying Supabase", async () => {
  let called = false;
  await withTicketsHandler(
    {
      supabaseRequest: async () => {
        called = true;
        return [];
      },
      supabaseRpc: async () => ({}),
    },
    async (handler) => {
      const res = response();
      await handler(request("GET", "/api/tickets?businessDate=2026-02-30"), res);
      assert.equal(res.statusCode, 400);
      assert.equal(called, false);
    },
  );
});

test("ticket transitions require the expected business date and status", async () => {
  let requestPath = "";
  await withTicketsHandler(
    {
      supabaseRequest: async (path) => {
        requestPath = path;
        return [];
      },
      supabaseRpc: async () => ({}),
    },
    async (handler) => {
      const res = response();
      await handler(
        request("POST", `/api/tickets?businessDate=${BUSINESS_DATE}`, {
          action: "admit",
          id: TICKET_ID,
        }),
        res,
      );
      assert.equal(res.statusCode, 409);
      assert.match(requestPath, /business_date=eq\.2026-06-02/);
      assert.match(requestPath, /status=in\.\(waiting,no_show\)/);
    },
  );
});

test("canceling a call does not claim that the physical card was recovered", async () => {
  let patch = null;
  await withTicketsHandler(
    {
      supabaseRequest: async (_path, options) => {
        patch = JSON.parse(options.body);
        return [{ id: TICKET_ID, status: "canceled" }];
      },
      supabaseRpc: async () => ({}),
    },
    async (handler) => {
      const res = response();
      await handler(
        request("POST", `/api/tickets?businessDate=${BUSINESS_DATE}`, {
          action: "cancel",
          id: TICKET_ID,
        }),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.equal(patch.status, "canceled");
      assert.equal(Object.hasOwn(patch, "card_recovered_at"), false);
    },
  );
});

test("issuance uses the request UUID and falls back while the new RPC is not installed", async () => {
  const calls = [];
  await withTicketsHandler(
    {
      supabaseRequest: async () => [],
      supabaseRpc: async (name, payload) => {
        calls.push({ name, payload });
        if (name === "issue_ticket_v2") {
          const error = new Error("function is not installed");
          error.statusCode = 404;
          throw error;
        }
        return { ticket: { id: TICKET_ID }, settings: { card_count: 300 } };
      },
    },
    async (handler) => {
      const res = response();
      await handler(
        request("POST", `/api/tickets?businessDate=${BUSINESS_DATE}`, {
          action: "issue",
          requestId: TICKET_ID,
          estimatedReturnAt: "2026-06-02T09:15:00+09:00",
        }),
        res,
      );
      assert.equal(res.statusCode, 201);
      assert.deepEqual(
        calls.map((call) => call.name),
        ["issue_ticket_v2", "issue_ticket"],
      );
      assert.equal(calls[0].payload.p_ticket_id, TICKET_ID);
    },
  );
});

test("a ticket cannot be marked absent before its promised return time", async () => {
  let patchCalled = false;
  await withTicketsHandler(
    {
      supabaseRequest: async (_path, options) => {
        if (options.method === "GET") {
          return [{ status: "waiting", estimated_return_at: "2999-06-02T12:30:00+09:00" }];
        }
        patchCalled = true;
        return [];
      },
      supabaseRpc: async () => ({}),
    },
    async (handler) => {
      const res = response();
      await handler(
        request("POST", `/api/tickets?businessDate=${BUSINESS_DATE}`, {
          action: "no_show",
          id: TICKET_ID,
        }),
        res,
      );
      assert.equal(res.statusCode, 422);
      assert.equal(res.body.error, "案内した時刻までは不在にできません。");
      assert.equal(patchCalled, false);
    },
  );
});
