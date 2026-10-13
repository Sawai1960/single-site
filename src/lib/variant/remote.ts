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
