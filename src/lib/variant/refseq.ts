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
  /** near-identical segmental duplications, by chrom, sorted by start */
  segdups: Map<string, SegDup[]>;
  count: number;
}

export interface SegDup {
  /** 0-based half-open on this chrom */
  start: number;
  end: number;
  otherChrom: string;
  otherStart: number;
  otherEnd: number;
  identity: number;
  /** the other copy is in reverse orientation */
  reversed: boolean;
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
    segdups?: [string, number, number, string, number, number, number, string][];
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
    segdups: new Map(),
    count: json.transcripts.length,
  };
  for (const [chrom, start, end, otherChrom, otherStart, otherEnd, identity, strand] of json.segdups ?? []) {
    push(idx.segdups, chrom, { start, end, otherChrom, otherStart, otherEnd, identity, reversed: strand === "-" });
  }
  for (const arr of idx.segdups.values()) arr.sort((a, b) => a.start - b.start);
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

export interface DuplicatedCopies {
  /** fraction of coding bases inside near-identical segmental duplications */
  coverage: number;
  identity: number;
  copies: { chrom: string; start: number; end: number; genes: string[] }[];
}

const dupCache = new WeakMap<Transcript, DuplicatedCopies | null>();

/** Coding regions in genome coordinates (0-based half-open). */
function codingIntervals(t: Transcript): [number, number][] {
  const out: [number, number][] = [];
  const c0 = t.cds[0] - 1;
  const c1 = t.cds[1];
  for (const [qs, gs, size] of t.blocks) {
    const a = Math.max(qs, c0);
    const b = Math.min(qs + size, c1);
    if (a >= b) continue;
    out.push(t.strand === "+" ? [gs + (a - qs), gs + (b - qs)] : [gs + (qs + size - b), gs + (qs + size - a)]);
  }
  return out;
}

/**
 * Other loci that are ≥98% identical to most of this transcript's coding region
 * (UCSC genomicSuperDups). Alignments of such genes may land on a different copy
 * than NCBI/ClinVar chose, and reference-base checks cannot tell the copies apart.
 */
export function duplicatedCopies(idx: RefSeqIndex, t: Transcript): DuplicatedCopies | undefined {
  const hit = dupCache.get(t);
  if (hit !== undefined) return hit ?? undefined;
  const coding = codingIntervals(t);
  const total = coding.reduce((s, [a, b]) => s + b - a, 0);
  const sds = (idx.segdups.get(t.chrom) ?? []).filter((d) => coding.some(([a, b]) => d.start < b && d.end > a));
  let result: DuplicatedCopies | null = null;
  if (total > 0 && sds.length) {
    let covered = 0;
    for (const [a, b] of coding) {
      const parts = sds
        .map((d) => [Math.max(a, d.start), Math.min(b, d.end)] as const)
        .filter(([x, y]) => x < y)
        .sort((p, q) => p[0] - q[0]);
      let end = a;
      for (const [x, y] of parts) {
        if (y <= end) continue;
        covered += y - Math.max(x, end);
        end = y;
      }
    }
    const coverage = covered / total;
    if (coverage >= 0.5) {
      const geneStart = Math.min(...coding.map((c) => c[0]));
      const geneEnd = Math.max(...coding.map((c) => c[1]));
      const copies = new Map<string, { chrom: string; start: number; end: number; genes: string[] }>();
      for (const d of sds) {
        // Project this gene's coding span into the other copy (approximate: ignores indels).
        const a = Math.max(geneStart, d.start) - d.start;
        const b = Math.min(geneEnd, d.end) - d.start;
        const start = d.reversed ? d.otherEnd - b : d.otherStart + a;
        const end = d.reversed ? d.otherEnd - a : d.otherStart + b;
        const slack = 2000;
        const genes = new Set(
          (idx.byChrom.get(d.otherChrom) ?? [])
            .filter((e) => !e.t.hist && e.start <= end + slack && e.end > start - slack && e.t.gene !== t.gene)
            .map((e) => e.t.gene),
        );
        const key = `${d.otherChrom}:${Math.round(start / 2e4)}`;
        const cur = copies.get(key);
        if (cur) {
          cur.start = Math.min(cur.start, start);
          cur.end = Math.max(cur.end, end);
          cur.genes = [...new Set([...cur.genes, ...genes])];
        } else {
          copies.set(key, { chrom: d.otherChrom, start, end, genes: [...genes] });
        }
      }
      result = { coverage, identity: Math.max(...sds.map((d) => d.identity)), copies: [...copies.values()] };
    }
  }
  dupCache.set(t, result);
  return result ?? undefined;
}

export function overlapping(idx: RefSeqIndex, chrom: string, pos: number): Transcript[] {
  return (idx.byChrom.get(chrom) ?? []).filter((e) => e.start <= pos && pos <= e.end).map((e) => e.t);
}
