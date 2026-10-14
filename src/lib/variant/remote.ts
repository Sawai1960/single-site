const g = globalThis as unknown as { __seqCache?: Map<string, string> };
const cache = (g.__seqCache ??= new Map());
const MAX_CACHE = 5000;

const TIMEOUT_MS = 20000;

async function fetchJson(url: string, attempts = 2): Promise<unknown> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      lastError = new Error(`${new URL(url).host}: HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  throw lastError;
}

async function fetchText(url: string, attempts = 2): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return await res.text();
      lastError = new Error(`${new URL(url).host}: HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw lastError;
}

export interface RefSeqRecord {
  acc: string;
  seq: string;
  /** 1-based inclusive CDS range (NM_ only) */
  cds?: [number, number];
  /** NP_ encoded by this NM_ */
  protein?: string;
  /** NM_ that encodes this NP_ */
  mrna?: string;
  gene?: string;
}

const rg = globalThis as unknown as { __refseqRecords?: Map<string, Promise<RefSeqRecord>>; __ncbiQueue?: Promise<void> };
const records = (rg.__refseqRecords ??= new Map());

/** NCBI E-utilities allow 3 requests/s without an API key. */
async function ncbiSlot(): Promise<void> {
  const prev = rg.__ncbiQueue ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, 350)));
  rg.__ncbiQueue = next;
  await prev;
}

export function parseGenBank(text: string): RefSeqRecord {
  const acc = text.match(/^VERSION\s+(\S+)/m)?.[1];
  if (!acc) throw new Error("NCBI: レコードを解析できません");
  const cds = text.match(/^ {5}CDS\s+<?(\d+)\.\.>?(\d+)\s*$/m);
  const protein = text.match(/\/protein_id="([^"]+)"/)?.[1];
  const gene = text.match(/\/gene="([^"]+)"/)?.[1];
  const mrna = text.match(/^DBSOURCE\s+REFSEQ: accession (\S+)/m)?.[1];
  const origin = text.split(/^ORIGIN.*$/m)[1] ?? "";
  const seq = origin.replace(/\/\/[\s\S]*$/, "").replace(/[^a-zA-Z]/g, "").toUpperCase();
  if (!seq) throw new Error(`NCBI: ${acc} の配列がありません`);
  return { acc, seq, cds: cds ? [Number(cds[1]), Number(cds[2])] : undefined, protein, mrna, gene };
}

/** GenBank/GenPept record for an exact NM_/NP_ version from NCBI E-utilities. */
export async function getRefSeqRecord(acc: string): Promise<RefSeqRecord> {
  const hit = records.get(acc);
  if (hit) return hit;
  const p = (async () => {
    const isProtein = /^[NX]P_/.test(acc);
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
      `?db=${isProtein ? "protein" : "nuccore"}&id=${encodeURIComponent(acc)}&rettype=${isProtein ? "gp" : "gb"}&retmode=text`;
    await ncbiSlot();
    let text: string;
    try {
      text = await fetchText(url);
    } catch (e) {
      throw new Error(
        e instanceof Error && e.message.includes("HTTP 400")
          ? `NCBI に ${acc} が見つかりません`
          : `NCBI から ${acc} を取得できませんでした`,
      );
    }
    const rec = parseGenBank(text);
    if (rec.acc !== acc) throw new Error(`NCBI に ${acc} がありません（${rec.acc} が返されました）`);
    return rec;
  })();
  records.set(acc, p);
  p.catch(() => records.delete(acc));
  return p;
}

export interface MitoFeature {
  /** HGNC symbol, e.g. MT-TL1; "D-loop" for the control region */
  symbol: string;
  /** GenBank /gene, e.g. TRNL1 */
  name: string;
  kind: "tRNA" | "rRNA" | "protein" | "control";
  product: string;
  start: number;
  end: number;
  strand: "+" | "-";
}

/** Genes of the mitochondrial genome (rCRS, NC_012920.1 = hg38 chrM) from its GenBank record. */
export function parseMitoGenBank(text: string): MitoFeature[] {
  const features = text.split(/^ {5}(?=\S)/m).slice(1);
  const out: MitoFeature[] = [];
  const productOf = new Map<string, { kind: MitoFeature["kind"]; product: string }>();
  for (const f of features) {
    const kind = f.match(/^(tRNA|rRNA|CDS)\s/)?.[1];
    const name = f.match(/\/gene="([^"]+)"/)?.[1];
    if (!kind || !name) continue;
    const product = f.match(/\/product="([^"]+)"/)?.[1]?.replace(/\s+/g, " ") ?? "";
    productOf.set(name, { kind: kind === "CDS" ? "protein" : (kind as "tRNA" | "rRNA"), product });
  }
  for (const f of features) {
    const head = f.match(/^(gene|D-loop)\s+(.+)$/m);
    if (!head) continue;
    const loc = head[2].trim();
    const strand = loc.startsWith("complement") ? "-" : "+";
    const ranges = [...loc.matchAll(/(\d+)\.\.(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    if (head[1] === "D-loop") {
      for (const [start, end] of ranges) {
        out.push({ symbol: "D-loop", name: "D-loop", kind: "control", product: "制御領域", start, end, strand: "+" });
      }
      continue;
    }
    const name = f.match(/\/gene="([^"]+)"/)?.[1];
    if (!name || !ranges.length) continue;
    const symbol = f.replace(/\s+/g, " ").match(/Official Symbol: (\S+)/)?.[1] ?? name;
    const p = productOf.get(name);
    out.push({ symbol, name, kind: p?.kind ?? "protein", product: p?.product ?? "", start: ranges[0][0], end: ranges[ranges.length - 1][1], strand });
  }
  return out;
}

const mg = globalThis as unknown as { __mitoGenes?: Promise<MitoFeature[]> };

export function getMitoGenes(): Promise<MitoFeature[]> {
  if (mg.__mitoGenes) return mg.__mitoGenes;
  const p = (async () => {
    await ncbiSlot();
    const text = await fetchText(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=NC_012920.1&rettype=gb&retmode=text",
    );
    const genes = parseMitoGenBank(text);
    if (genes.length < 30) throw new Error("NCBI: ミトコンドリアの遺伝子情報を解析できません");
    return genes;
  })();
  mg.__mitoGenes = p;
  p.catch(() => (mg.__mitoGenes = undefined));
  return p;
}

async function fromUcsc(chrom: string, start: number, end: number): Promise<string> {
  const url = `https://api.genome.ucsc.edu/getData/sequence?genome=hg38;chrom=${chrom};start=${start - 1};end=${end}`;
  const j = (await fetchJson(url)) as { dna?: string };
  if (!j.dna) throw new Error("UCSC: empty sequence");
  return j.dna.toUpperCase();
}

async function fromEnsembl(chrom: string, start: number, end: number): Promise<string> {
  const c = chrom.replace(/^chr/, "").replace(/^M$/, "MT");
  const url = `https://rest.ensembl.org/sequence/region/human/${c}:${start}..${end}:1?content-type=application/json`;
  const j = (await fetchJson(url)) as { seq?: string };
  if (!j.seq) throw new Error("Ensembl: empty sequence");
  return j.seq.toUpperCase();
}

/** hg38 reference sequence for 1-based inclusive range on + strand */
export async function getSequence(chrom: string, start: number, end: number): Promise<string> {
  const key = `${chrom}:${start}-${end}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let seq: string;
  try {
    seq = await fromUcsc(chrom, start, end);
  } catch {
    seq = await fromEnsembl(chrom, start, end);
  }
  if (cache.size > MAX_CACHE) cache.clear();
  cache.set(key, seq);
  return seq;
}

/** Converts a GRCh37 (hg19) region to GRCh38 using the Ensembl assembly mapping service. */
export async function liftHg19ToHg38(
  chrom: string,
  start: number,
  end: number,
): Promise<{ chrom: string; start: number; end: number }> {
  const c = chrom.replace(/^chr/, "").replace(/^M$/, "MT");
  const path = `/map/human/GRCh37/${c}:${start}..${end}:1/GRCh38?content-type=application/json`;
  type MapResponse = { mappings?: { mapped: { seq_region_name: string; start: number; end: number } }[] };
  let j: MapResponse;
  try {
    j = (await fetchJson(`https://rest.ensembl.org${path}`)) as MapResponse;
  } catch {
    try {
      j = (await fetchJson(`https://grch37.rest.ensembl.org${path}`)) as MapResponse;
    } catch {
      throw new Error("hg19→hg38 変換サービス（Ensembl）に接続できませんでした。時間をおいて再実行してください");
    }
  }
  const maps = j.mappings ?? [];
  if (maps.length !== 1) {
    throw new Error(
      maps.length === 0
        ? "hg19 の位置を hg38 に変換できませんでした（対応領域がありません）"
        : "hg19 の範囲が hg38 上で分断されるため、一意に変換できません",
    );
  }
  const m = maps[0].mapped;
  const mc = m.seq_region_name === "MT" ? "chrM" : `chr${m.seq_region_name}`;
  return { chrom: mc, start: m.start, end: m.end };
}
