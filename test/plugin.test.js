import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

const originalFetch = globalThis.fetch;
const originalDshHome = process.env.DSH_HOME;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function balancePayload({ total, granted = 0, topped = total }) {
  return {
    is_available: true,
    balance_infos: [{
      currency: "CNY",
      total_balance: String(total),
      granted_balance: String(granted),
      topped_up_balance: String(topped)
    }]
  };
}

function createContext({ apiKey = "test-key", rawContent = "" } = {}) {
  const routes = new Map();
  const secrets = new Map(apiKey === null ? [] : [["DEEPSEEK_API_KEY", apiKey]]);
  const persistence = {
    list: async () => rawContent === "" ? [] : [{ id: "session-1" }],
    readRaw: async () => ({ content: rawContent })
  };
  const ctx = {
    webServer: {
      register(definition) {
        routes.set(definition.path, definition.handler);
        return () => routes.delete(definition.path);
      }
    },
    credentials: {
      async resolve(ref) {
        return secrets.has(ref) ? { value: secrets.get(ref) } : undefined;
      },
      async set(ref, value) {
        secrets.set(ref, value);
      },
      async unset(ref) {
        secrets.delete(ref);
      }
    },
    get(name) {
      return name === "sessionPersistence" ? persistence : undefined;
    },
    effect(start) {
      return start();
    },
    interval() {
      return () => {};
    },
    logger: { warn() {} }
  };
  apply(ctx);
  return { routes, secrets };
}

class MockResponse {
  status = 0;
  headers = {};
  body = "";

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  end(body = "") {
    this.body = body;
  }
}

function request(method, body = "", headers = {}) {
  const req = Readable.from(body === "" ? [] : [Buffer.from(body)]);
  req.method = method;
  req.headers = headers;
  return req;
}

async function invoke(handler, req) {
  const res = new MockResponse();
  await handler(req, res);
  return { status: res.status, headers: res.headers, body: res.body === "" ? null : JSON.parse(res.body) };
}

async function waitForState(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`state was not written: ${path}`);
}

function useTempHome(t) {
  const home = mkdtempSync(join(tmpdir(), "dsh-usage-test-"));
  process.env.DSH_HOME = home;
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, statePath: join(home, "storages", "deepseek-usage-day.json") };
}

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = originalDshHome;
});

test("package, bundle patch, and browser module use one public identity", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.equal(packageJson.name, "@arslan-jh/deepseek-harness-usage");
  assert.match(patch, /name: '@arslan-jh\/deepseek-harness-usage'/);
  assert.match(client, /id: "@arslan-jh\/deepseek-harness-usage"/);
});

test("new-day replay adds only today's log cost to the current balance", async (t) => {
  const { statePath } = useTempHome(t);
  mkdirSync(join(statePath, ".."), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ date: "2000-01-01", opening: 120, last: 100 }), "utf8");
  const event = JSON.stringify({
    type: "assistant/message",
    time: Date.now(),
    data: { usage: { outputTokens: 1_000_000 }, message: { source: { model: "deepseek-v4-flash" } } }
  });
  globalThis.fetch = async () => jsonResponse(balancePayload({ total: 98 }));
  const { routes } = createContext({ rawContent: event });
  await waitForState(statePath);

  const response = await invoke(routes.get("/api/ds-usage"), request("GET"));
  assert.equal(response.status, 200);
  assert.equal(response.body.todayCost, 2);
  assert.equal(response.body.todaySource, "estimate");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).opening, 100);
});

test("balance components preserve spend when a top-up and usage overlap", async (t) => {
  const { statePath } = useTempHome(t);
  mkdirSync(join(statePath, ".."), { recursive: true });
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  writeFileSync(statePath, JSON.stringify({ date, opening: 100, last: 90, granted: 0, topped: 90 }), "utf8");
  globalThis.fetch = async () => jsonResponse(balancePayload({ total: 89, topped: 94 }));
  const { routes } = createContext();
  await waitForState(statePath);

  const response = await invoke(routes.get("/api/ds-usage"), request("GET"));
  assert.equal(response.status, 200);
  assert.equal(response.body.todayCost, 15);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).opening, 104);
});

test("configuration route enforces same-origin JSON requests and a 64 KiB limit", async (t) => {
  useTempHome(t);
  const { routes } = createContext({ apiKey: null });
  const handler = routes.get("/api/ds-usage-config");

  const crossOrigin = await invoke(handler, request("POST", "{}", {
    host: "127.0.0.1:3080",
    origin: "https://attacker.example",
    "content-type": "application/json"
  }));
  assert.equal(crossOrigin.status, 403);

  const wrongType = await invoke(handler, request("POST", "{}", {
    host: "127.0.0.1:3080",
    origin: "http://127.0.0.1:3080",
    "content-type": "text/plain"
  }));
  assert.equal(wrongType.status, 415);

  const tooLarge = await invoke(handler, request("POST", `{"x":"${"a".repeat(70 * 1024)}"}`, {
    host: "127.0.0.1:3080",
    origin: "http://127.0.0.1:3080",
    "content-type": "application/json"
  }));
  assert.equal(tooLarge.status, 413);
});

test("platform token can be removed and usage route is GET-only", async (t) => {
  useTempHome(t);
  const { routes, secrets } = createContext({ apiKey: null });
  secrets.set("DEEPSEEK_PLATFORM_TOKEN", "secret");

  const cleared = await invoke(routes.get("/api/ds-usage-config"), request("POST", "{\"clearToken\":true}", {
    host: "127.0.0.1:3080",
    origin: "http://127.0.0.1:3080",
    "content-type": "application/json"
  }));
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.tokenCleared, true);
  assert.equal(secrets.has("DEEPSEEK_PLATFORM_TOKEN"), false);

  const wrongMethod = await invoke(routes.get("/api/ds-usage"), request("POST"));
  assert.equal(wrongMethod.status, 405);
});
