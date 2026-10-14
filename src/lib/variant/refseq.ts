import type { QueryTarget, Transcript } from "./types";

/**
 * Transcripts are loaded on demand: the maps below hold only the buckets loaded so far.
 * Call the ensure* functions before looking anything up.
 */
export interface RefSeqIndex {
  builtAt: string;
  sources: { ucsc: string; mane: string; maneVersion: string };
  lookup: Lookup;
  loaded: Map<number, Promise<void>>;
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

/** Which bucket files hold the transcripts for an accession, gene, synonym or region. */
interface Lookup {
  buckets: number;
  /** NM_ accession without version → bucket */
  acc: Record<string, number>;
  /** NP_ accession without version → buckets */
  prot: Record<string, number[]>;
  /** upper-case gene symbol → buckets */
  gene: Record<string, number[]>;
  /** upper-case gene synonym → buckets */
  syn: Record<string, number[]>;
  /** per chrom, sorted by start: [start (1-based), end, bucket] of current transcripts */
  spans: Map<string, [number, number, number][]>;
}

/** Reads a file under the data directory (public/data/ when built). */
export type DataReader = (file: string) => Promise<ArrayBuffer>;

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const fetchReader: DataReader = async (file) => {
  const res = await fetch(`${BASE_PATH}/data/${file}`);
  if (!res.ok) throw new Error(`転写産物データ（${file}）を読み込めませんでした: HTTP ${res.status}`);
  return res.arrayBuffer();
};

const g = globalThis as unknown as { __refseqIndex?: Promise<RefSeqIndex>; __refseqReader?: DataReader };

export function setDataReader(reader: DataReader) {
  g.__refseqReader = reader;
  g.__refseqIndex = undefined;
}

/** The web server may already have undone the gzip (Content-Encoding), so check the magic bytes. */
async function readJson<T>(file: string): Promise<T> {
  const buf = await (g.__refseqReader ?? fetchReader)(file);
  const bytes = new Uint8Array(buf);
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

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
  const json = await readJson<
    Omit<Lookup, "spans"> & {
      builtAt: string;
      sources: RefSeqIndex["sources"];
      count: number;
      spans: [string, number, number, number][];
      segdups?: [string, number, number, string, number, number, number, string][];
    }
  >("index.json.gz");
  const spans = new Map<string, [number, number, number][]>();
  for (const [chrom, start, end, bucket] of json.spans) push(spans, chrom, [start, end, bucket]);
  const idx: RefSeqIndex = {
    builtAt: json.builtAt,
    sources: json.sources,
    lookup: { buckets: json.buckets, acc: json.acc, prot: json.prot, gene: json.gene, syn: json.syn, spans },
    loaded: new Map(),
    byAcc: new Map(),
    byBase: new Map(),
    byProt: new Map(),
    byProtBase: new Map(),
    byGene: new Map(),
    bySynonym: new Map(),
    byChrom: new Map(),
    segdups: new Map(),
    count: json.count,
  };
  for (const [chrom, start, end, otherChrom, otherStart, otherEnd, identity, strand] of json.segdups ?? []) {
    push(idx.segdups, chrom, { start, end, otherChrom, otherStart, otherEnd, identity, reversed: strand === "-" });
  }
  for (const arr of idx.segdups.values()) arr.sort((a, b) => a.start - b.start);
  return idx;
}

function addTranscripts(idx: RefSeqIndex, transcripts: Transcript[]) {
  for (const t of transcripts) {
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
}

function ensureBuckets(idx: RefSeqIndex, buckets: Iterable<number>): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const b of new Set(buckets)) {
    let p = idx.loaded.get(b);
    if (!p) {
      p = readJson<Transcript[]>(`b/${String(b).padStart(4, "0")}.json.gz`).then((ts) => addTranscripts(idx, ts));
      p.catch(() => idx.loaded.delete(b));
      idx.loaded.set(b, p);
    }
    pending.push(p);
  }
  return Promise.all(pending).then(() => undefined);
}

/** Loads every version of these NM_ accessions (with or without version). */
export function ensureAccessions(idx: RefSeqIndex, accs: string[]): Promise<void> {
  return ensureBuckets(
    idx,
    accs.map((a) => idx.lookup.acc[accBase(a)]).filter((b) => b !== undefined),
  );
}

/** Loads everything resolveTarget may look at for this target. */
export function ensureTarget(idx: RefSeqIndex, target: QueryTarget): Promise<void> {
  const { lookup } = idx;
  if (target.type === "transcript") return ensureAccessions(idx, [target.acc]);
  if (target.type === "protein") return ensureBuckets(idx, lookup.prot[accBase(target.acc)] ?? []);
  const key = target.symbol.toUpperCase();
  return ensureBuckets(idx, [...(lookup.gene[key] ?? []), ...(lookup.syn[key] ?? [])]);
}

/** Loads the current transcripts overlapping chrom:start-end (1-based inclusive). */
export function ensureRegion(idx: RefSeqIndex, chrom: string, start: number, end: number): Promise<void> {
  const spans = idx.lookup.spans.get(chrom) ?? [];
  return ensureBuckets(
    idx,
    spans.filter(([s, e]) => s <= end && e >= start).map(([, , b]) => b),
  );
}

/** Loads the genes near the other copies of these transcripts' segmental duplications. */
export function ensureDuplicateContext(idx: RefSeqIndex, ts: Transcript[]): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const t of ts) {
    const coding = codingIntervals(t);
    for (const d of idx.segdups.get(t.chrom) ?? []) {
      if (!coding.some(([a, b]) => d.start < b && d.end > a)) continue;
      const { start, end } = projectIntoCopy(coding, d);
      loads.push(ensureRegion(idx, d.otherChrom, start - DUP_SLACK, end + DUP_SLACK));
    }
  }
  return Promise.all(loads).then(() => undefined);
}

/** For offline validation: loads every bucket. */
export function ensureAll(idx: RefSeqIndex): Promise<void> {
  return ensureBuckets(idx, Array.from({ length: idx.lookup.buckets }, (_, i) => i));
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
/** genes this close to the projected copy are named in the warning */
const DUP_SLACK = 2000;

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
 * Projects a gene's coding span into the other copy of a duplication (approximate: ignores
 * indels, so it can extend past the other copy when the two copies differ in length).
 */
function projectIntoCopy(coding: [number, number][], d: SegDup): { start: number; end: number } {
  const geneStart = Math.min(...coding.map((c) => c[0]));
  const geneEnd = Math.max(...coding.map((c) => c[1]));
  const a = Math.max(geneStart, d.start) - d.start;
  const b = Math.min(geneEnd, d.end) - d.start;
  return {
    start: d.reversed ? d.otherEnd - b : d.otherStart + a,
    end: d.reversed ? d.otherEnd - a : d.otherStart + b,
  };
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
      const copies = new Map<string, { chrom: string; start: number; end: number; genes: string[] }>();
      for (const d of sds) {
        const { start, end } = projectIntoCopy(coding, d);
        const genes = new Set(
          (idx.byChrom.get(d.otherChrom) ?? [])
            .filter((e) => !e.t.hist && e.start <= end + DUP_SLACK && e.end > start - DUP_SLACK && e.t.gene !== t.gene)
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
