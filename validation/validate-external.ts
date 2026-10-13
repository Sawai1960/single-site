/*
 * Measures how well the external cross-check (NCBI Variation Services / Ensembl VEP) flags
 * conversions that disagree with ClinVar.
 * Usage: npx tsx validation/validate-external.ts [--sample validation/clinvar-sample-historical.tsv]
 *        [--normal 150] [--ensembl] [--report validation/report-external.md]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { convertOne } from "../src/lib/variant/convert";
import { sameVariant, verifyItems, type VerifyItem } from "../src/lib/variant/verify";
import type { CheckOutcome, ResultCandidate, SourceChecks, VerifySource } from "../src/lib/variant/types";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const SAMPLE_FILE = path.resolve(arg("--sample", path.join(DIR, "clinvar-sample-historical.tsv")));
const REPORT_FILE = path.resolve(arg("--report", path.join(DIR, "report-external.md")));
const NORMAL = Number(arg("--normal", "150"));
const PER_GROUP = Number(arg("--per-group", "120"));
let groupSizes = new Map<string, number>();
const SOURCES: VerifySource[] = process.argv.includes("--ensembl") ? ["ncbi", "ensembl"] : ["ncbi"];

const WARNED = [
  ["NCBI の配列を", "UCSC に無い版を NCBI の配列で計算"],
  ["分節重複", "分節重複（多コピー）"],
  ["挿入・欠失の差", "近傍にアライメントのインデル"],
  ["完全には一致しません", "転写産物とゲノムの配列が不一致"],
] as const;

interface Case {
  id: string;
  category: string;
  nm: string;
  c: string;
  chrom: string;
  start: number;
  posVcf: number;
  refVcf: string;
  altVcf: string;
}

function loadCases(): Case[] {
  return readFileSync(SAMPLE_FILE, "utf8")
    .split("\n")
    .slice(2)
    .filter(Boolean)
    .map((l) => {
      const f = l.split("\t");
      return { id: f[0], category: f[1], nm: f[2], c: f[4], chrom: `chr${f[6]}`, start: Number(f[7]), posVcf: Number(f[9]), refVcf: f[10], altVcf: f[11] };
    });
}

/** Deterministic shuffle so reruns pick the same "normal" cases. */
function shuffled<T>(xs: T[], seed = 7): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = (s >>> 8) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k], k);
      }
    }),
  );
}

interface Row {
  k: Case;
  cand?: ResultCandidate;
  group: string;
  toolOk?: boolean;
  checks: Partial<Record<VerifySource, SourceChecks>>;
}

function verdict(checks: SourceChecks | undefined): CheckOutcome["status"] {
  const s = [checks?.forward?.status, checks?.reverse?.status];
  if (s.includes("mismatch")) return "mismatch";
  if (s.includes("match")) return "match";
  return "unavailable";
}

async function main() {
  const t0 = Date.now();
  const cases = loadCases();
  const rows: Row[] = [];
  let done = 0;

  // Pass 1: convert everything (local, fast) and classify.
  await pool(cases, 6, async (k) => {
    const r = await convertOne(`${k.nm}:${k.c}`);
    const cands = r.candidates.filter((c) => c.chrom === k.chrom && c.transcript === k.nm);
    cands.sort((a, b) => Math.abs(a.start - k.start) - Math.abs(b.start - k.start));
    const cand = cands[0];
    const warned = cand ? WARNED.find(([needle]) => cand.warnings.some((w) => w.includes(needle))) : undefined;
    let toolOk: boolean | undefined;
    if (cand?.verify?.forward[0]) {
      try {
        toolOk = await sameVariant(k.chrom, cand.verify.forward[0].edit, { from: k.posVcf, to: k.posVcf + k.refVcf.length - 1, alt: k.altVcf });
      } catch {
        toolOk = undefined;
      }
    }
    const group = toolOk === false ? "本ツールが ClinVar と不一致" : warned ? `警告あり: ${warned[1]}` : "通常";
    rows.push({ k, cand, group, toolOk, checks: {} });
    if (++done % 500 === 0) console.log(`converted ${done}/${cases.length}`);
  });

  const usable = rows.filter((r) => r.cand && r.toolOk !== undefined);
  const groups = new Map<string, Row[]>();
  for (const r of usable) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const target: Row[] = [];
  for (const [g, rs] of groups) {
    const cap = g === "本ツールが ClinVar と不一致" ? Infinity : g === "通常" ? NORMAL : PER_GROUP;
    target.push(...shuffled(rs).slice(0, cap));
    console.log(`${g}: ${rs.length} 件 → ${Math.min(cap, rs.length)} 件を照合`);
  }
  groupSizes = new Map([...groups].map(([g, rs]) => [g, rs.length]));
  console.log(`cross-checking ${target.length} cases with ${SOURCES.join(", ")}`);

  // Pass 2: external checks, batched so Ensembl sees few large requests.
  for (const source of SOURCES) {
    const size = source === "ensembl" ? 40 : 8;
    for (let i = 0; i < target.length; i += size) {
      const chunk = target.slice(i, i + size);
      const items: VerifyItem[] = chunk.map((r) => ({ transcript: r.cand!.transcript, chrom: r.cand!.chrom, plan: r.cand!.verify! }));
      const res = await verifyItems(source, items);
      chunk.forEach((r, j) => (r.checks[source] = res[j]));
      console.log(`${source}: ${Math.min(i + size, target.length)}/${target.length}`);
    }
  }

  writeReport(cases.length, target, (Date.now() - t0) / 1000);
}

function writeReport(total: number, target: Row[], secs: number) {
  const L: string[] = [];
  L.push("# 外部データベース照合の検証レポート", "");
  L.push(`- 実行日時: ${new Date().toISOString()}`);
  L.push(
    `- サンプル: \`validation/${path.basename(SAMPLE_FILE)}\`（${total.toLocaleString()} 件）。本ツールが ClinVar と不一致のケースは全件、注意表示のある区分は各 ${PER_GROUP} 件まで、通常ケースは ${NORMAL} 件を無作為に選びました`,
  );
  L.push(`- 照合先: ${SOURCES.map((s) => (s === "ncbi" ? "NCBI Variation Services" : "Ensembl VEP（RefSeq）")).join("、")}`);
  L.push(`- 所要時間: ${secs.toFixed(0)} 秒`, "");
  L.push(
    "正解は ClinVar の GRCh38 座標です（インデルは参照配列に適用した結果が同じなら一致）。",
    "「外部照合」は順変換・逆変換のどちらかが不一致なら「不一致」、どちらかが一致なら「一致」、両方とも照合できなければ「確認不可」です。",
    "",
  );

  for (const source of SOURCES) {
    const name = source === "ncbi" ? "NCBI" : "Ensembl";
    L.push(`## ${name}`, "");
    L.push("| 区分 | サンプル中 | 照合件数 | 外部照合: 一致 | 外部照合: 不一致 | 確認不可 |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    const groups = [...new Set(target.map((r) => r.group))].sort();
    for (const g of groups) {
      const rs = target.filter((r) => r.group === g);
      const n = (s: string) => rs.filter((r) => verdict(r.checks[source]) === s).length;
      L.push(`| ${g} | ${groupSizes.get(g) ?? ""} | ${rs.length} | ${n("match")} | ${n("mismatch")} | ${n("unavailable")} |`);
    }
    const wrong = target.filter((r) => r.toolOk === false);
    const right = target.filter((r) => r.toolOk === true);
    const caught = wrong.filter((r) => verdict(r.checks[source]) === "mismatch").length;
    const missed = wrong.filter((r) => verdict(r.checks[source]) === "match").length;
    const falseAlarm = right.filter((r) => verdict(r.checks[source]) === "mismatch").length;
    L.push(
      "",
      `- 本ツールが ClinVar と不一致の ${wrong.length} 件のうち、外部照合で「不一致」になったもの: ${caught} 件、「一致」になったもの（見逃し）: ${missed} 件、確認不可: ${wrong.length - caught - missed} 件`,
      `- 本ツールが ClinVar と一致した ${right.length} 件のうち、外部照合で「不一致」になったもの（誤警報）: ${falseAlarm} 件`,
      "",
    );
    const reasons = new Map<string, number>();
    for (const r of target) {
      for (const o of [r.checks[source]?.forward, r.checks[source]?.reverse]) {
        if (o?.status !== "unavailable") continue;
        const key = o.detail.replace(/N[MRCG]_\d+\.\d+/g, "NM_").replace(/chr\w+:[\d,]+/g, "chr:位置");
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
    }
    L.push("### 確認不可の理由（順変換・逆変換の延べ数）", "");
    for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) L.push(`- ${k} — ${n}`);
    L.push("");
    const notable = target.filter(
      (r) => (r.toolOk === false && verdict(r.checks[source]) !== "mismatch") || (r.toolOk === true && verdict(r.checks[source]) === "mismatch"),
    );
    if (notable.length) {
      L.push("### 見逃し・誤警報の一覧", "");
      for (const r of notable) {
        const c = r.checks[source];
        L.push(
          `- ${r.k.nm}:${r.k.c}（${r.group}）— 本ツール ${r.cand!.chrom}:${r.cand!.start}、ClinVar ${r.k.chrom}:${r.k.start}。順変換: ${c?.forward?.detail ?? "—"}／逆変換: ${c?.reverse?.detail ?? "—"}`,
        );
      }
      L.push("");
    }
  }
  writeFileSync(REPORT_FILE, L.join("\n"));
  console.log(L.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
