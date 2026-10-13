#!/usr/bin/env node
// Builds data/refseq-hg38.json.gz from UCSC hg38 RefSeq alignment tables
// (current + historical versions), the NCBI MANE summary, and UCSC segmental
// duplications (genomicSuperDups) for multi-copy gene warnings.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RAW = path.join(ROOT, "data", "raw");
const OUT = path.join(ROOT, "data", "refseq-hg38.json.gz");

const UCSC = "https://hgdownload.soe.ucsc.edu/goldenPath/hg38/database";
const MANE_DIR = "https://ftp.ncbi.nlm.nih.gov/refseq/MANE/MANE_human/current/";

const PRIMARY = new Set([
  ...Array.from({ length: 22 }, (_, i) => `chr${i + 1}`),
  "chrX",
  "chrY",
  "chrM",
]);

// Bump when the payload shape changes so `--if-missing` rebuilds stale files.
const DATA_VERSION = 4;
// Segmental duplications at least this identical are treated as copies a database may confuse.
// Identity is averaged over the whole duplicated block, so tandem arrays such as GAGE
// (exons near-identical, block identity ~96–97%) need a threshold below 0.97.
const SEGDUP_MIN_IDENTITY = 0.95;

if (process.argv.includes("--if-missing") && existsSync(OUT)) {
  try {
    const cur = JSON.parse(gunzipSync(readFileSync(OUT)).toString("utf8"));
    if (cur.version === DATA_VERSION) process.exit(0);
    console.log("Data file is from an older build; rebuilding...");
  } catch {
    console.log("Data file is unreadable; rebuilding...");
  }
}

async function download(url, file) {
  const dest = path.join(RAW, file);
  if (existsSync(dest) && !process.argv.includes("--refresh")) return dest;
  process.stdout.write(`  downloading ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

function readTsv(file) {
  return gunzipSync(readFileSync(file))
    .toString("utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));
}

async function findManeFile() {
  const html = await (await fetch(MANE_DIR)).text();
  const m = html.match(/MANE\.GRCh38\.v[\d.]+\.summary\.txt\.gz/);
  if (!m) throw new Error("MANE summary file not found");
  return m[0];
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  console.log("Fetching RefSeq / MANE source tables...");
  const tables = [
    "ncbiRefSeqPsl",
    "ncbiRefSeqPslHistorical",
    "ncbiRefSeqCds",
    "ncbiRefSeqCdsHistorical",
    "ncbiRefSeqLink",
    "ncbiRefSeqLinkHistorical",
    "genomicSuperDups",
  ];
  const files = {};
  await Promise.all(
    tables.map(async (t) => {
      files[t] = await download(`${UCSC}/${t}.txt.gz`, `${t}.txt.gz`);
    }),
  );
  const maneName = await findManeFile();
  files.mane = await download(MANE_DIR + maneName, maneName);

  const cds = new Map();
  for (const t of ["ncbiRefSeqCds", "ncbiRefSeqCdsHistorical"]) {
    for (const [id, range] of readTsv(files[t])) {
      const nums = range.match(/\d+/g);
      if (!nums) continue;
      cds.set(id, [Number(nums[0]), Number(nums[nums.length - 1])]);
    }
  }

  // ncbiRefSeqLink columns: id status name product mrnaAcc protAcc ...
  const link = new Map();
  for (const t of ["ncbiRefSeqLink", "ncbiRefSeqLinkHistorical"]) {
    for (const r of readTsv(files[t])) {
      if (!r[0].startsWith("NM_")) continue;
      link.set(r[0], { gene: r[2], prot: r[5] || "", synonyms: r[14] || "" });
    }
  }

  const mane = new Map();
  let maneVersion = maneName.match(/v[\d.]+(?=\.summary)/)?.[0] ?? "";
  for (const r of readTsv(files.mane)) {
    if (r[5]?.startsWith("NM_")) mane.set(r[5], r[9]);
  }

  const transcripts = [];
  for (const [t, historical] of [
    ["ncbiRefSeqPsl", false],
    ["ncbiRefSeqPslHistorical", true],
  ]) {
    for (const r of readTsv(files[t])) {
      const strand = r[9];
      const acc = r[10];
      const chrom = r[14];
      if (!acc.startsWith("NM_") || !PRIMARY.has(chrom)) continue;
      const c = cds.get(acc);
      if (!c) continue;
      const qSize = Number(r[11]);
      const sizes = r[19].split(",").filter(Boolean).map(Number);
      const qStarts = r[20].split(",").filter(Boolean).map(Number);
      const tStarts = r[21].split(",").filter(Boolean).map(Number);
      // blocks: [transcript 0-based start (forward orientation), genome 0-based start, size]
      const blocks = sizes.map((size, i) => [
        strand === "+" ? qStarts[i] : qSize - qStarts[i] - size,
        tStarts[i],
        size,
      ]);
      blocks.sort((a, b) => a[0] - b[0]);
      const info = link.get(acc) ?? { gene: "", prot: "", synonyms: "" };
      transcripts.push({
        acc,
        gene: info.gene,
        prot: info.prot,
        syn: info.synonyms,
        chrom,
        strand,
        len: qSize,
        cds: c,
        blocks,
        hist: historical,
        mane: mane.get(acc) ?? "",
        mm: Number(r[2]),
      });
    }
  }

  // genomicSuperDups columns: bin chrom chromStart chromEnd name score strand(6) otherChrom(7) otherStart otherEnd ... fracMatch(26)
  // [chrom, start0, end, otherChrom, otherStart0, otherEnd, fracMatch, strand]
  const segdups = [];
  for (const r of readTsv(files.genomicSuperDups)) {
    const frac = Number(r[26]);
    if (frac < SEGDUP_MIN_IDENTITY || !PRIMARY.has(r[1]) || !PRIMARY.has(r[7])) continue;
    segdups.push([r[1], Number(r[2]), Number(r[3]), r[7], Number(r[8]), Number(r[9]), Math.round(frac * 1000) / 1000, r[6]]);
  }

  const payload = {
    version: DATA_VERSION,
    builtAt: new Date().toISOString(),
    sources: {
      ucsc: UCSC,
      mane: maneName,
      maneVersion,
    },
    transcripts,
    segdups,
  };
  writeFileSync(OUT, gzipSync(JSON.stringify(payload)));
  console.log(`Wrote ${transcripts.length} alignments to ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
