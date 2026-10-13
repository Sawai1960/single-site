/*
 * Clients for the independent databases used to cross-check conversions.
 * NCBI Variation Services: https://api.ncbi.nlm.nih.gov/variation/v0/
 * Ensembl VEP (RefSeq transcripts): https://rest.ensembl.org/documentation/info/vep_hgvs_post
 */

export class ExternalError extends Error {}

export interface Spdi {
  seq_id: string;
  position: number;
  deleted_sequence: string;
  inserted_sequence: string;
}

export interface VepHgvsHit {
  seq_region_name: string;
  start: number;
  end: number;
  allele_string: string;
  strand: number;
}

export interface VepTranscriptHit {
  transcript_id: string;
  hgvsc?: string;
}

const g = globalThis as unknown as {
  __extCache?: Map<string, Promise<unknown>>;
  __variationQueue?: Promise<void>;
};
const cache = (g.__extCache ??= new Map());
const MAX_CACHE = 5000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  if (cache.size > MAX_CACHE) cache.clear();
  const p = fn();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** NCBI asks for no more than 3 requests per second without an API key. */
async function variationSlot(): Promise<void> {
  const prev = g.__variationQueue ?? Promise.resolve();
  const next = prev.then(() => sleep(350));
  g.__variationQueue = next;
  await prev;
}

async function ncbiVariation(path: string): Promise<Spdi[]> {
  return cached(`ncbi:${path}`, async () => {
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      await variationSlot();
      try {
        const res = await fetch(`https://api.ncbi.nlm.nih.gov/variation/v0${path}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        const body = (await res.json().catch(() => ({}))) as { data?: { spdis?: Spdi[] }; error?: { message?: string } };
        if (res.ok) return body.data?.spdis ?? [];
        if (res.status < 500 && res.status !== 429) throw new ExternalError(body.error?.message ?? `HTTP ${res.status}`);
        last = new Error(`NCBI: HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof ExternalError) throw e;
        last = e;
      }
      await sleep(1000 * (i + 1));
    }
    throw last;
  });
}

/** HGVS → SPDI on the sequence named in the HGVS (no projection). Throws ExternalError with NCBI's reason. */
export function ncbiHgvsContextual(hgvs: string): Promise<Spdi[]> {
  return ncbiVariation(`/hgvs/${encodeURIComponent(hgvs)}/contextuals`);
}

/** The same allele on every sequence NCBI has aligned (NC_ for GRCh37/38, NM_ versions, NG_ …). */
export function ncbiEquivalents(spdi: string): Promise<Spdi[]> {
  return ncbiVariation(`/spdi/${encodeURIComponent(spdi)}/all_equivalent_contextual`);
}

const ENSEMBL_DEADLINE_MS = 150000;

/**
 * Ensembl's REST servers intermittently answer 500/503 within a second while others take
 * 15–40 s to run VEP, so retry quickly until a deadline.
 */
async function ensemblPost<T>(path: string, body: unknown): Promise<T> {
  const deadline = Date.now() + ENSEMBL_DEADLINE_MS;
  let last: unknown;
  for (let i = 0; Date.now() < deadline; i++) {
    try {
      const res = await fetch(`https://rest.ensembl.org${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1000, Math.min(90000, deadline - Date.now()))),
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      if (res.status === 400) {
        let msg = text;
        try {
          msg = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {}
        throw new ExternalError(msg.slice(0, 300));
      }
      last = new Error(`Ensembl: HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof ExternalError) throw e;
      last = e;
    }
    await sleep(Math.min(5000, 800 * (i + 1)));
  }
  throw last ?? new Error("Ensembl: timeout");
}

/** c. HGVS (RefSeq) → genomic allele via VEP. Each notation maps to its hit or an error. */
export async function ensemblVepHgvs(notations: string[]): Promise<Map<string, VepHgvsHit | ExternalError>> {
  const out = new Map<string, VepHgvsHit | ExternalError>();
  const todo = notations.filter((n) => {
    const hit = cache.get(`vephgvs:${n}`);
    return !hit;
  });
  type Row = VepHgvsHit & { input: string };
  if (todo.length) {
    const batch = (list: string[]) =>
      ensemblPost<Row[]>("/vep/human/hgvs?refseq=1", { hgvs_notations: list }).then((rows) => {
        for (const n of list) {
          const row = rows.find((r) => r.input === n);
          const v = row ?? new ExternalError("Ensembl が結果を返しませんでした");
          cache.set(`vephgvs:${n}`, Promise.resolve(v));
        }
      });
    try {
      await batch(todo);
    } catch (e) {
      if (!(e instanceof ExternalError) || todo.length === 1) {
        if (e instanceof ExternalError) cache.set(`vephgvs:${todo[0]}`, Promise.resolve(e));
        else throw e;
      } else {
        // One bad notation fails the whole batch; ask individually so the rest still get answers.
        await Promise.all(
          todo.map((n) =>
            batch([n]).catch((err) => {
              if (err instanceof ExternalError) cache.set(`vephgvs:${n}`, Promise.resolve(err));
              else throw err;
            }),
          ),
        );
      }
    }
  }
  for (const n of notations) out.set(n, (await cache.get(`vephgvs:${n}`)) as VepHgvsHit | ExternalError);
  return out;
}

/** VCF-style lines ("4 55113391 . C A . . .") → RefSeq transcript consequences with HGVS c. */
export async function ensemblVepRegion(variants: string[]): Promise<Map<string, VepTranscriptHit[]>> {
  const out = new Map<string, VepTranscriptHit[]>();
  const todo = variants.filter((v) => !cache.get(`vepregion:${v}`));
  type Row = { input: string; transcript_consequences?: VepTranscriptHit[] };
  if (todo.length) {
    const rows = await ensemblPost<Row[]>("/vep/human/region?refseq=1&hgvs=1", { variants: todo });
    for (const v of todo) {
      const row = rows.find((r) => r.input === v);
      cache.set(`vepregion:${v}`, Promise.resolve(row?.transcript_consequences ?? []));
    }
  }
  for (const v of variants) out.set(v, (await cache.get(`vepregion:${v}`)) as VepTranscriptHit[]);
  return out;
}
