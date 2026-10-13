import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Transcript } from "./types";

export interface RefSeqIndex {
  builtAt: string;
  sources: { ucsc: string; mane: string; maneVersion: string };
  byAcc: Map<string, Transcript[]>;
  byBase: Map<string, Transcript[]>;
  byProt: Map<string, Transcript[]>;
  byProtBase: Map<string, Transcript[]>;
  byGene: Map<string, Transcript[]>;
  bySynonym: Map<string, Transcript[]>;
  byChrom: Map<string, { t: Transcript; start: number; end: number }[]>;
  count: number;
}

export const DATA_FILE = path.join(process.cwd(), "data", "refseq-hg38.json.gz");

const g = globalThis as unknown as { __refseqIndex?: Promise<RefSeqIndex> };

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function accBase(acc: string): string {
  return acc.split(".")[0];
}

export function accVersion(acc: string): number {
  return Number(acc.split(".")[1] ?? 0);
}

async function load(): Promise<RefSeqIndex> {
  if (!existsSync(DATA_FILE)) {
    throw new Error("転写産物データが見つかりません。`npm run data` を実行してください");
  }
  const json = JSON.parse(gunzipSync(await readFile(DATA_FILE)).toString("utf8")) as {
    builtAt: string;
    sources: RefSeqIndex["sources"];
    transcripts: Transcript[];
  };
  const idx: RefSeqIndex = {
    builtAt: json.builtAt,
    sources: json.sources,
    byAcc: new Map(),
    byBase: new Map(),
    byProt: new Map(),
    byProtBase: new Map(),
    byGene: new Map(),
    bySynonym: new Map(),
    byChrom: new Map(),
    count: json.transcripts.length,
  };
  for (const t of json.transcripts) {
    push(idx.byAcc, t.acc, t);
    push(idx.byBase, accBase(t.acc), t);
    if (t.prot) {
      push(idx.byProt, t.prot, t);
      push(idx.byProtBase, accBase(t.prot), t);
    }
    if (t.gene) push(idx.byGene, t.gene.toUpperCase(), t);
    if (!t.hist) {
      for (const s of t.syn.split(",")) {
        const k = s.trim().toUpperCase();
        if (k) push(idx.bySynonym, k, t);
      }
      const gs = t.blocks.map((b) => b[1]);
      const ge = t.blocks.map((b) => b[1] + b[2]);
      push(idx.byChrom, t.chrom, { t, start: Math.min(...gs) + 1, end: Math.max(...ge) });
    }
  }
  return idx;
}

export function getIndex(): Promise<RefSeqIndex> {
  if (!g.__refseqIndex) {
    g.__refseqIndex = load().catch((e) => {
      g.__refseqIndex = undefined;
      throw e;
    });
  }
  return g.__refseqIndex;
}

const MANE_RANK: Record<string, number> = { "MANE Select": 0, "MANE Plus Clinical": 1 };

export function sortTranscripts(ts: Transcript[]): Transcript[] {
  return [...ts].sort((a, b) => {
    const ra = MANE_RANK[a.mane] ?? 9;
    const rb = MANE_RANK[b.mane] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.hist !== b.hist) return a.hist ? 1 : -1;
    const na = Number(accBase(a.acc).slice(3));
    const nb = Number(accBase(b.acc).slice(3));
    if (na !== nb) return na - nb;
    return accVersion(b.acc) - accVersion(a.acc);
  });
}

export function overlapping(idx: RefSeqIndex, chrom: string, pos: number): Transcript[] {
  return (idx.byChrom.get(chrom) ?? []).filter((e) => e.start <= pos && pos <= e.end).map((e) => e.t);
}
