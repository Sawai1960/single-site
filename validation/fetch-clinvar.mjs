#!/usr/bin/env node
// Streams ClinVar variant_summary.txt.gz and writes a stratified, reproducible sample of
// GRCh38 variants described on NM_ transcripts to validation/clinvar-sample.tsv.
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import path from "node:path";

const URL_SUMMARY = "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "clinvar-sample.tsv");

const CAPS = {
  "cds:substitution": 3000,
  "intron:substitution": 1500,
  "utr5:substitution": 500,
  "utr3:substitution": 500,
  "any:deletion": 1500,
  "any:duplication": 1000,
  "any:insertion": 500,
  "any:delins": 500,
};

// Deterministic PRNG so the sample is reproducible for the same ClinVar release.
let seed = 20231009;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function categorize(c) {
  const m = c.match(/^c\.([-*]?\d+(?:[+-]\d+)?)(?:_([-*]?\d+(?:[+-]\d+)?))?(.*)$/);
  if (!m) return undefined;
  const change = m[3];
  let type;
  if (/^[ACGT]>[ACGT]$/.test(change)) type = "substitution";
  else if (/^delins[ACGT]+$/.test(change)) type = "delins";
  else if (/^del[ACGT]*$/.test(change)) type = "deletion";
  else if (/^dup[ACGT]*$/.test(change)) type = "duplication";
  else if (/^ins[ACGT]+$/.test(change)) type = "insertion";
  else return undefined;
  if (type !== "substitution") return `any:${type}`;
  const pos = m[1];
  if (/\d[+-]\d/.test(pos)) return "intron:substitution";
  if (pos.startsWith("-")) return "utr5:substitution";
  if (pos.startsWith("*")) return "utr3:substitution";
  return "cds:substitution";
}

const header =
  "variation_id\tcategory\tnm\tgene\tc\tp\tchrom\tstart\tstop\tpos_vcf\tref_vcf\talt_vcf\treview_status";

async function main() {
  const res = await fetch(URL_SUMMARY);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lastModified = res.headers.get("last-modified") ?? "";
  const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });

  const reservoirs = Object.fromEntries(Object.keys(CAPS).map((k) => [k, { seen: 0, rows: [] }]));
  let cols;
  let n = 0;
  for await (const line of rl) {
    if (!cols) {
      cols = Object.fromEntries(line.replace(/^#/, "").split("\t").map((c, i) => [c, i]));
      continue;
    }
    n++;
    const f = line.split("\t");
    if (f[cols.Assembly] !== "GRCh38") continue;
    const chrom = f[cols.Chromosome];
    if (!/^([0-9]{1,2}|X|Y)$/.test(chrom)) continue;
    const name = f[cols.Name];
    const m = name.match(/^(NM_\d+\.\d+)\(([^)]+)\):(c\.\S+)(?: \((p\.[^)]+)\))?$/);
    if (!m) continue;
    const posVcf = f[cols.PositionVCF];
    if (!posVcf || posVcf === "-1" || f[cols.ReferenceAlleleVCF] === "na") continue;
    const category = categorize(m[3]);
    if (!category) continue;
    const r = reservoirs[category];
    const row = [
      f[cols.VariationID],
      category,
      m[1],
      m[2],
      m[3],
      m[4] ?? "",
      chrom,
      f[cols.Start],
      f[cols.Stop],
      posVcf,
      f[cols.ReferenceAlleleVCF],
      f[cols.AlternateAlleleVCF],
      f[cols.ReviewStatus],
    ].join("\t");
    r.seen++;
    if (r.rows.length < CAPS[category]) r.rows.push(row);
    else {
      const j = Math.floor(rand() * r.seen);
      if (j < CAPS[category]) r.rows[j] = row;
    }
    if (n % 1_000_000 === 0) process.stderr.write(`  ${n.toLocaleString()} rows scanned\n`);
  }

  const out = createWriteStream(OUT);
  out.write(`# source: ${URL_SUMMARY} (Last-Modified: ${lastModified})\n`);
  out.write(header + "\n");
  for (const [k, r] of Object.entries(reservoirs)) {
    console.log(`${k.padEnd(22)} ${String(r.rows.length).padStart(5)} sampled / ${r.seen.toLocaleString()} eligible`);
    for (const row of r.rows) out.write(row + "\n");
  }
  out.end();
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
