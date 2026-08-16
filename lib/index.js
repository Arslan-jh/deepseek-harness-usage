/**
 * ds-usage — host half.
 *
 * Registers one exact HTTP route on the dsh web server:
 *
 *   GET /api/ds-usage
 *
 * which resolves DEEPSEEK_API_KEY through the credentials seam, calls
 * DeepSeek's public `/user/balance` endpoint for the total balance, and
 * resolves today's consumption from one of two sources:
 *
 * 1. **Platform page (optional)**: with the optional
 *    DEEPSEEK_PLATFORM_TOKEN credential (the platform.deepseek.com
 *    localStorage `userToken`), the website's private usage endpoint may
 *    supply today's row. Source is reported as `"platform"`; this is not a
 *    documented public API.
 * 2. **Estimate (fallback)**: without the platform token, the plugin meters
 *    the balance — it persists the first (day-opening) balance of the local
 *    calendar day under `$DSH_HOME/storages/deepseek-usage-day.json` and
 *    reports `max(0, opening − current)`. Source is `"estimate"`, and the
 *    client prefixes the value with "≈".
 *
 * The API key never leaves the host: the browser only ever talks to this
 * route, and keys are resolved per request through the credentials seam.
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

const name = "ds-usage";
const inject = ["webServer", "credentials", "timer", "sessionPersistence"];

const BALANCE_URL = "https://api.deepseek.com/user/balance";
const PLATFORM_USAGE_URL = "https://platform.deepseek.com/api/v0/usage/cost";
const API_KEY_REF = credentialRef("DEEPSEEK_API_KEY");
const PLATFORM_TOKEN_REF = credentialRef("DEEPSEEK_PLATFORM_TOKEN");
const TIMEOUT_MS = 15000;
const DAY_STATE_FILE = "deepseek-usage-day.json";
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_MANUAL_COST = 1_000_000;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

/** Local calendar day as `YYYY-MM-DD`. */
function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** UTC calendar day as `YYYY-MM-DD` (dashboard rows are keyed by UTC in exports). */
function utcDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Coerce a possibly-string number to a finite number, or NaN. */
function toFinite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// ---- official pricing engine ---------------------------------------------

/**
 * Official pricing policy timeline (`since` inclusive). Each policy carries
 * a flat per-model table plus a `*` fallback. Units: CNY per 1M tokens
 * {input, cacheRead, output}. Only publicly documented prices belong here.
 */
const PRICING_POLICIES = [
  {
    since: "2025-02-09T00:00:00+08:00",
    label: "deepseek-chat / deepseek-reasoner 标准价",
    prices: {
      "deepseek-chat": { cny: { input: 2, cacheRead: 0.5, output: 8 } },
      "deepseek-reasoner": { cny: { input: 4, cacheRead: 1, output: 16 } },
      "*": { cny: { input: 2, cacheRead: 0.5, output: 8 } }
    }
  },
  {
    since: "2026-05-22T00:00:00+08:00",
    label: "V4 系列 75% 降价转永久（deepseek-v4-flash / deepseek-v4-pro）",
    prices: {
      "deepseek-v4-flash": { cny: { input: 1, cacheRead: 0.02, output: 2 } },
      "deepseek-v4-pro": { cny: { input: 3, cacheRead: 0.025, output: 6 } },
      "deepseek-chat": { cny: { input: 1, cacheRead: 0.02, output: 2 } },
      "deepseek-reasoner": { cny: { input: 1, cacheRead: 0.02, output: 2 } },
      "*": { cny: { input: 1, cacheRead: 0.02, output: 2 } }
    }
  }
];

/** Per-model unit price (CNY/1M tokens) in effect at `timeMs`. */
function priceAt(model, timeMs) {
  const applicable = PRICING_POLICIES.filter((policy) => timeMs >= Date.parse(policy.since));
  const policy = applicable.length > 0 ? applicable[applicable.length - 1] : PRICING_POLICIES[0];
  return (policy.prices[model] ?? policy.prices["*"]).cny;
}

/** Price one usage sample: `{ inputTokens, cacheReadTokens, outputTokens }`. */
function costOf(usage, unit) {
  const inputTokens = usage.inputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return (inputTokens * unit.input + cacheReadTokens * unit.cacheRead + outputTokens * unit.output) / 1e6;
}

/**
 * Replay every local session log and price today's `assistant/message`
 * events (each carries its usage buckets and model name) with the official
 * price table. This recovers the spend between midnight and the first
 * balance observation — the gap a pure balance-delta meter cannot see.
 * @param ctx - plugin context (reads `sessionPersistence`).
 * @returns today's replayed DSH cost in CNY, or `null` when unavailable.
 */
async function replaySinceMidnight(ctx) {
  const persistence = ctx.get("sessionPersistence");
  if (persistence === void 0 || typeof persistence.list !== "function" || typeof persistence.readRaw !== "function") return null;
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const nowMs = now.getTime();
  let headers;
  try {
    headers = await persistence.list();
  } catch {
    return null;
  }
  if (!Array.isArray(headers)) return null;
  let total = 0;
  for (const header of headers) {
    try {
      if (typeof persistence.locate === "function") {
        const location = persistence.locate(header);
        if (location?.kind === "jsonl" && typeof location.path === "string" && statSync(location.path).mtimeMs < dayStart) continue;
      }
      const raw = await persistence.readRaw(header.id);
      if (raw === void 0 || raw === null || typeof raw.content !== "string") continue;
      for (const line of raw.content.split("\n")) {
        if (line === "") continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event === null || typeof event !== "object" || event.type !== "assistant/message") continue;
        const time = typeof event.time === "number" ? event.time : Date.parse(String(event.time ?? ""));
        if (!Number.isFinite(time) || time < dayStart || time > nowMs) continue;
        const data = event.data;
        const usage = data !== null && typeof data === "object" ? data.usage : void 0;
        if (usage === undefined || usage === null || typeof usage !== "object") continue;
        const source = data !== null && typeof data === "object" ? data.message?.source : void 0;
        const model = source !== null && typeof source === "object" && typeof source.model === "string" ? source.model : "unknown";
        total += costOf(usage, priceAt(model, time));
      }
    } catch {
      // one unreadable session must not fail the whole replay
    }
  }
  return Math.round(total * 100) / 100;
}

async function fetchBalance(key) {
  const response = await fetch(BALANCE_URL, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`DeepSeek 余额接口返回 HTTP ${response.status}`);
  const body = await response.json();
  const infos = body !== null && typeof body === "object" && Array.isArray(body.balance_infos) ? body.balance_infos : null;
  if (infos === null || infos.length === 0) throw new Error("unexpected balance payload");
  const first = infos[0];
  const total = Number(first.total_balance);
  if (!Number.isFinite(total)) throw new Error("balance payload has no numeric total");
  return {
    currency: String(first.currency || "CNY"),
    total: Math.round(total * 100) / 100,
    granted: Number(first.granted_balance) || 0,
    topped: Number(first.topped_up_balance) || 0
  };
}

/**
 * Fetch today's official cost from the DeepSeek platform dashboard API.
 * Matches both the local and the UTC calendar date; returns `null` when
 * today's row is absent (caller falls back).
 */
async function fetchTodayCost(token) {
  const now = new Date();
  const url = `${PLATFORM_USAGE_URL}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "x-app-version": "1.0.0",
      Origin: "https://platform.deepseek.com",
      Referer: "https://platform.deepseek.com/usage"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`DeepSeek 平台用量接口返回 HTTP ${response.status}`);
  const body = await response.json();
  const biz = body !== null && typeof body === "object" ? body.data : void 0;
  if (body?.code !== 0 || biz === void 0 || biz.biz_code !== 0) {
    const code = body?.code ?? biz?.biz_code;
    throw new Error(`DeepSeek 平台用量接口错误 (code ${code ?? "unknown"})`);
  }
  const container = Array.isArray(biz.biz_data) ? biz.biz_data[0] : biz.biz_data;
  const days = container !== null && typeof container === "object" ? container.days : void 0;
  if (!Array.isArray(days)) return null;
  const want = [localDate(now), utcDate(now)];
  for (const target of want) {
    const entry = days.find((d) => d !== null && typeof d === "object" && d.date === target);
    if (entry === void 0 || !Array.isArray(entry.data)) continue;
    let total = 0;
    for (const modelEntry of entry.data) {
      if (modelEntry === null || typeof modelEntry !== "object" || !Array.isArray(modelEntry.usage)) continue;
      for (const u of modelEntry.usage) {
        if (u === null || typeof u !== "object") continue;
        const value = toFinite(u.cost !== void 0 ? u.cost : u.amount);
        if (Number.isFinite(value)) total += value;
      }
    }
    return Math.round(total * 100) / 100;
  }
  return null;
}

/** Absolute path of the daily-meter state file under the harness home. */
function dayStatePath() {
  const base = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(base, "storages", DAY_STATE_FILE);
}

/** Read the persisted meter state; `null` when absent or malformed. */
function loadDayState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.date === "string" &&
      Number.isFinite(parsed.opening) &&
      Number.isFinite(parsed.last) &&
      (parsed.granted === undefined || Number.isFinite(parsed.granted)) &&
      (parsed.topped === undefined || Number.isFinite(parsed.topped))
    ) return parsed;
  } catch {}
  return null;
}

/** Persist the meter state atomically; returns false when persistence fails. */
function saveDayState(path, state) {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    try {
      unlinkSync(tmp);
    } catch {}
    return false;
  }
}

/**
 * Today's consumption estimate: `max(0, day-opening − current)`, rounded to
 * cents. A rising balance is a top-up, never negative spending, so the
 * opening shifts up by the same amount. When a new day opens (or on first
 * run), the meter cannot see the spend between midnight and the first
 * observation, so the local DSH session logs are replayed and priced with
 * the official table to backfill the baseline.
 */
async function computeTodayConsumed(ctx, balance) {
  if (balance === null || typeof balance !== "object" || !Number.isFinite(balance.total)) return null;
  const path = dayStatePath();
  const today = localDate(new Date());
  const stored = loadDayState(path);
  let opening;
  let backfilled = false;
  if (stored !== null && stored.date === today) {
    opening = stored.opening;
    if (Number.isFinite(stored.granted) && Number.isFinite(stored.topped)) {
      opening += Math.max(0, balance.granted - stored.granted);
      opening += Math.max(0, balance.topped - stored.topped);
    } else if (balance.total > stored.last) {
      // Legacy state did not preserve balance components, so only a visible
      // net increase can be recognized as a top-up.
      opening += balance.total - stored.last;
    }
  } else {
    opening = balance.total;
    try {
      const replay = await replaySinceMidnight(ctx);
      if (replay !== null && replay > 0) {
        opening += replay;
        backfilled = true;
      }
    } catch (error) {
      ctx.logger.warn("ds-usage: log replay backfill failed");
      ctx.logger.warn(error);
    }
  }
  const state = {
    date: today,
    opening: Math.round(opening * 100) / 100,
    last: balance.total,
    granted: balance.granted,
    topped: balance.topped
  };
  if (!saveDayState(path, state)) ctx.logger.warn(`ds-usage: failed to persist meter state at ${path}`);
  const consumed = Math.max(0, opening - balance.total);
  return { value: Math.round(consumed * 100) / 100, backfilled };
}

/** Read one JSON request body up to 64 KiB; `null` for an empty body. */
async function readJsonBody(req) {
  const declaredLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw Object.assign(new Error("request body exceeds 64 KiB"), { status: 413 });
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw Object.assign(new Error("request body exceeds 64 KiB"), { status: 413 });
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return null;
  return JSON.parse(text);
}

function requestOriginAllowed(req) {
  const origin = req.headers?.origin;
  if (origin === undefined) return true;
  const host = req.headers?.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function apply(ctx) {
  // Settings-panel config route: manual official-cost calibration and
  // optional DEEPSEEK_PLATFORM_TOKEN storage (auto official data).
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/ds-usage-config",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, message: "POST only" }));
        return;
      }
      if (!requestOriginAllowed(req)) {
        sendJson(res, 403, { ok: false, message: "cross-origin request rejected" });
        return;
      }
      const contentType = String(req.headers?.["content-type"] ?? "").toLowerCase();
      if (!contentType.startsWith("application/json")) {
        sendJson(res, 415, { ok: false, message: "application/json required" });
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const cost = payload !== null && typeof payload === "object" && payload.cost !== undefined ? Number(payload.cost) : NaN;
        const token = payload !== null && typeof payload === "object" && typeof payload.token === "string" && payload.token.trim() !== "" ? payload.token.trim() : null;
        const clearToken = payload !== null && typeof payload === "object" && payload.clearToken === true;
        let tokenStored = false;
        let tokenCleared = false;
        if (clearToken) {
          try {
            await ctx.credentials.unset(PLATFORM_TOKEN_REF);
            tokenCleared = true;
          } catch (error) {
            ctx.logger.warn("ds-usage: platform token removal failed");
            ctx.logger.warn(error);
            sendJson(res, 500, { ok: false, message: "平台令牌删除失败" });
            return;
          }
        }
        if (token !== null) {
          try {
            await ctx.credentials.set(PLATFORM_TOKEN_REF, token);
            tokenStored = true;
          } catch (error) {
            ctx.logger.warn("ds-usage: platform token storage failed");
            ctx.logger.warn(error);
            sendJson(res, 500, { ok: false, message: "平台令牌保存失败" });
            return;
          }
        }
        if (payload !== null && typeof payload === "object" && payload.cost !== undefined && (!Number.isFinite(cost) || cost < 0 || cost > MAX_MANUAL_COST)) {
          sendJson(res, 400, { ok: false, message: `cost must be between 0 and ${MAX_MANUAL_COST}` });
          return;
        }
        if (Number.isFinite(cost)) {
          const keyHit = await ctx.credentials.resolve(API_KEY_REF);
          if (keyHit === void 0) {
            sendJson(res, 503, { ok: false, message: "未配置 DEEPSEEK_API_KEY" });
            return;
          }
          const balance = await fetchBalance(keyHit.value);
          const path = dayStatePath();
          const today = localDate(new Date());
          const opening = Math.round((balance.total + cost) * 100) / 100;
          const saved = saveDayState(path, {
            date: today,
            opening,
            last: balance.total,
            granted: balance.granted,
            topped: balance.topped
          });
          if (!saved) {
            sendJson(res, 500, { ok: false, message: "今日消费校准保存失败" });
            return;
          }
          sendJson(res, 200, { ok: true, cost: Math.round(cost * 100) / 100, balance: balance.total, opening, tokenStored, tokenCleared });
        } else if (tokenStored || tokenCleared) {
          sendJson(res, 200, { ok: true, tokenStored, tokenCleared });
        } else {
          sendJson(res, 400, { ok: false, message: "provide a numeric cost, a non-empty token, or clearToken" });
        }
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : error instanceof SyntaxError ? 400 : 500;
        sendJson(res, status, { ok: false, message: String(error?.message ?? error) });
      }
    }
  }), "ds-usage: config route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/ds-usage",
    handler: async (req, res) => {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, message: "GET only" });
        return;
      }
      try {
        const keyHit = await ctx.credentials.resolve(API_KEY_REF);
        if (keyHit === void 0) {
          sendJson(res, 503, {
            ok: false,
            balance: null,
            todayCost: null,
            todaySource: null,
            message: "未配置 DEEPSEEK_API_KEY"
          });
          return;
        }
        let balance = null;
        try {
          balance = await fetchBalance(keyHit.value);
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            balance: null,
            todayCost: null,
            todaySource: null,
            message: `余额获取失败: ${String(error?.message ?? error)}`
          });
          return;
        }
        let todayCost = null;
        let todaySource = null;
        let message = null;
        const tokenHit = await ctx.credentials.resolve(PLATFORM_TOKEN_REF);
        if (tokenHit !== void 0) {
          try {
            const official = await fetchTodayCost(tokenHit.value);
            if (official !== null) {
              todayCost = official;
              todaySource = "platform";
            }
          } catch (error) {
            ctx.logger.warn("ds-usage: platform usage fetch failed; falling back to the balance-delta estimate");
            ctx.logger.warn(error);
            message = "官方今日消费获取失败，已改用余额差值估算";
          }
        }
        if (todaySource === null) {
          const estimated = await computeTodayConsumed(ctx, balance);
          if (estimated !== null) {
            todayCost = estimated.value;
            todaySource = "estimate";
          }
        }
        sendJson(res, 200, { ok: true, balance, todayCost, todaySource, message });
      } catch (error) {
        ctx.logger.warn("ds-usage: usage route failed");
        ctx.logger.warn(error);
        sendJson(res, 502, {
          ok: false,
          balance: null,
          todayCost: null,
          todaySource: null,
          message: `内部错误: ${String(error?.message ?? error)}`
        });
      }
    }
  }), "ds-usage: usage route");
  // 24/7 maintenance meter: the host itself samples the balance every three
  // minutes, so the daily opening baseline is captured automatically at the
  // first sample after midnight — no page, calibration, or user input needed.
  const maintenanceTick = async () => {
    try {
      const keyHit = await ctx.credentials.resolve(API_KEY_REF);
      if (keyHit === void 0) return;
      const balance = await fetchBalance(keyHit.value);
      await computeTodayConsumed(ctx, balance);
    } catch (error) {
      ctx.logger.warn("ds-usage: maintenance tick failed");
      ctx.logger.warn(error);
    }
  };
  void maintenanceTick();
  ctx.effect(() => ctx.interval(() => { void maintenanceTick(); }, 180000), "ds-usage: balance maintenance");
}

export { name, inject };
