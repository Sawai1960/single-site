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

/** NCBI E-utilities allow 3 requests/s without an API key (10/s with NCBI_API_KEY). */
async function ncbiSlot(): Promise<void> {
  const gap = process.env.NCBI_API_KEY ? 110 : 350;
  const prev = rg.__ncbiQueue ?? Promise.resolve();
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)));
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
    const key = process.env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(process.env.NCBI_API_KEY)}` : "";
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
      `?db=${isProtein ? "protein" : "nuccore"}&id=${encodeURIComponent(acc)}&rettype=${isProtein ? "gp" : "gb"}&retmode=text${key}`;
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
