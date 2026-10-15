/*
 * Wraps globalThis.fetch for the validation scripts so that thousands of conversions stay
 * within the public services' published limits (one shared hospital IP must never be blocked):
 *   UCSC API      1 request/s (https://genome.ucsc.edu/goldenPath/help/api.html)
 *   Ensembl REST  55,000/hour ≈ 15/s (https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits)
 *   NCBI          3/s without an API key
 * Reference sequences are cached on disk (validation/.cache/sequences.json) so reruns and the
 * two validation scripts share them. With setSequenceOffline(true), uncached sequence requests
 * fail without going out, and the converter falls back to its no-connection behaviour.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".cache", "sequences.json");
const GAP_MS: Record<string, number> = {
  "api.genome.ucsc.edu": 1100,
  "rest.ensembl.org": 250,
  "grch37.rest.ensembl.org": 250,
  "eutils.ncbi.nlm.nih.gov": 400,
  "api.ncbi.nlm.nih.gov": 400,
};
const SEQUENCE_URL = /^https:\/\/(api\.genome\.ucsc\.edu\/getData\/sequence|rest\.ensembl\.org\/sequence\/region)/;

const cache: Record<string, string> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
let dirty = false;
let offline = false;
const queues = new Map<string, Promise<void>>();
export const requestCounts: Record<string, number> = {};

export function setSequenceOffline(value: boolean) {
  offline = value;
}

export function saveSequenceCache() {
  if (!dirty) return;
  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
  dirty = false;
}

function slot(host: string): Promise<void> {
  const gap = GAP_MS[host] ?? 1000;
  const prev = queues.get(host) ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)));
  queues.set(host, next);
  return prev;
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isSequence = SEQUENCE_URL.test(url) && (init?.method ?? "GET") === "GET";
  if (isSequence && url in cache) {
    requestCounts["保存済みの参照配列を再利用"] = (requestCounts["保存済みの参照配列を再利用"] ?? 0) + 1;
    return new Response(cache[url], { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // A 4xx answer is not retried by remote.ts, so offline lookups fail at once.
  if (isSequence && offline) return new Response("offline during validation", { status: 404 });
  const host = new URL(url).host;
  await slot(host);
  requestCounts[host] = (requestCounts[host] ?? 0) + 1;
  const res = await realFetch(input, init);
  if (isSequence && res.ok) {
    const body = await res.text();
    cache[url] = body;
    dirty = true;
    if (Object.keys(cache).length % 100 === 0) saveSequenceCache();
    return new Response(body, { status: res.status, headers: res.headers });
  }
  return res;
};

process.on("exit", saveSequenceCache);
