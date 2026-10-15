/*
 * Validates the converter against ClinVar the way the published (static) site runs it:
 * every query goes through convertOne with a cold, lazily loaded index, so only the data
 * buckets that the query itself asks for are present.
 *
 * Reference-sequence requests are offline during the main pass (positions do not depend on
 * them); sequences already cached by validate-clinvar.ts are reused. Indel equivalence and a
 * small end-to-end sample with the live reference check go out at the services' rate limits.
 *
 * Usage: npx tsx validation/validate-browser.ts [--network-sample N] [--sample file] [--report file]
 */
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdit, type Case, loadCases, ourEdit, pool } from "./clinvar-common";
import { requestCounts, saveSequenceCache, setSequenceOffline } from "./polite-fetch";
import { convertOne } from "../src/lib/variant/convert";
import { parseQuery } from "../src/lib/variant/parse";
import { accBase, ensureAccessions, getIndex, setDataReader } from "../src/lib/variant/refseq";
import { getSequence } from "../src/lib/variant/remote";
import type { ConversionResult, ParsedQuery, ResultCandidate } from "../src/lib/variant/types";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(DIR, "..", "public", "data");
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const NETWORK_SAMPLE = Number(arg("--network-sample", "300"));
const SAMPLE_FILE = path.resolve(arg("--sample", path.join(DIR, "clinvar-sample.tsv")));
const REPORT_FILE = path.resolve(arg("--report", path.join(DIR, "report-browser.md")));

const files = new Map<string, Promise<ArrayBuffer>>();
const reader = (file: string) => {
  let p = files.get(file);
  if (!p) {
    p = readFile(path.join(DATA_DIR, file)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    files.set(file, p);
  }
  return p;
};
/** Drops the parsed index so the next query starts with no buckets loaded, as a fresh page does. */
const coldStart = () => setDataReader(reader);

type Outcome = "pass" | "fail" | "skip";
interface Stats {
  label: string;
  pass: number;
  fail: number;
  skip: number;
  failures: string[];
  skips: Map<string, number>;
}
const stats: Record<string, Stats> = {};
function record(key: string, label: string, outcome: Outcome, detail?: string) {
  const s = (stats[key] ??= { label, pass: 0, fail: 0, skip: 0, failures: [], skips: new Map() });
  s[outcome]++;
  if (outcome === "fail" && detail) s.failures.push(detail);
  if (outcome === "skip" && detail) s.skips.set(detail, (s.skips.get(detail) ?? 0) + 1);
}

const isSub = (k: Case) => k.category.endsWith(":substitution");
const cPosOf = (s: string | undefined) => s?.match(/:c\.([-*]?\d+(?:[+-]\d+)?)/)?.[1];
function closest(cands: ResultCandidate[], k: Case) {
  return [...cands].sort((a, b) => Math.abs(a.start - k.start) - Math.abs(b.start - k.start))[0];
}

interface Deferred {
  k: Case;
  q: Extract<ParsedQuery, { kind: "cdna" }>;
  cand: ResultCandidate;
}

async function checkCase(k: Case, deferred: Deferred[]) {
  coldStart();
  const label2 = "形式2: NM_:c. → hg38 位置";
  const key2 = `f2:${k.category}`;
  const r2 = await convertOne(`${k.nm}:${k.c}`);
  const own = r2.candidates.filter((c) => c.transcript === k.nm && c.chrom === k.chrom);
  const cand = own.length ? closest(own, k) : undefined;
  if (!cand) {
    record(key2, label2, "fail", `${k.nm}:${k.c} — 候補なし: ${r2.message ?? r2.notes.join(" ")}`);
  } else if (isSub(k)) {
    record(key2, label2, cand.start === k.start && cand.end === k.start ? "pass" : "fail", `${k.nm}:${k.c} — 本ツール ${cand.chrom}:${cand.start}, ClinVar ${k.chrom}:${k.start}`);
  } else if (cand.start === k.start && cand.end === k.stop) {
    record(key2, label2, "pass");
  } else {
    const q = parseQuery(`${k.nm}:${k.c}`);
    if (q.kind === "cdna") deferred.push({ k, q, cand });
  }
  if (!isSub(k)) return;

  coldStart();
  const label1 = "形式1（逆変換）: hg38 位置 → c. 表記";
  const key1 = `f1:${k.category}`;
  const want = k.c.match(/^c\.([-*]?\d+(?:[+-]\d+)?)/)![1];
  const r1 = await convertOne(`hg38, ${k.chrom}:${k.start}`);
  // A genomic query lists current transcripts only, so an old ClinVar version is judged by its current version.
  const back = r1.candidates.find((c) => c.transcript === k.nm) ?? r1.candidates.find((c) => accBase(c.transcript) === accBase(k.nm));
  if (!back) {
    const idx = await getIndex();
    await ensureAccessions(idx, [k.nm]);
    const covers = (t: { chrom: string; blocks: [number, number, number][] }) =>
      t.chrom === k.chrom && Math.min(...t.blocks.map((b) => b[1] + 1)) <= k.start && k.start <= Math.max(...t.blocks.map((b) => b[1] + b[2]));
    const versions = idx.byBase.get(accBase(k.nm)) ?? [];
    if (!versions.some((t) => !t.hist && covers(t))) {
      const own = versions.find((t) => t.acc === k.nm);
      record(
        key1,
        label1,
        "skip",
        own?.hist
          ? "ClinVar の NM_ は旧版で、その位置は現行版の転写範囲の外（ゲノム位置からの入力では現行版だけを表示）"
          : "ClinVar の位置が NM_ の転写範囲の外（遠い上流・下流）にあり、ゲノム位置から入力すると候補に出ない",
      );
    } else if (r1.candidates.length >= 20) {
      record(key1, label1, "skip", "重なる転写産物が表示上限（20 件）を超え、ClinVar の NM_ が一覧に入らない");
    } else {
      record(key1, label1, "fail", `${k.chrom}:${k.start} — ${k.nm} が候補に無い`);
    }
  } else {
    const got = cPosOf(back.hgvsC);
    if (got === want) record(key1, label1, "pass");
    else if (back.transcript !== k.nm) record(key1, label1, "skip", "ClinVar の NM_ は旧版で、現行版とは c. 番号が異なる（ゲノム位置からの入力では現行版を表示）");
    else record(key1, label1, "fail", `${k.chrom}:${k.start} → 本ツール c.${got}, ClinVar c.${want}（${k.nm}）`);
  }

  coldStart();
  const label4 = "形式4: 遺伝子名:c. → 候補に正解位置を含むか";
  const key4 = `f4:${k.category}`;
  const r4 = await convertOne(`${k.gene}:${k.c}`);
  const sameBase = r4.candidates.filter((c) => accBase(c.transcript) === accBase(k.nm) && c.chrom === k.chrom);
  if (!r4.candidates.length) {
    record(key4, label4, "skip", "遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など）");
  } else if (!sameBase.length) {
    record(key4, label4, "skip", "ClinVar の NM_ が遺伝子の現行転写産物に含まれない");
  } else if (sameBase.some((c) => c.start === k.start)) {
    record(key4, label4, "pass");
  } else if (!sameBase.some((c) => c.transcript === k.nm)) {
    record(key4, label4, "skip", "ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる");
  } else {
    record(key4, label4, "fail", `${k.gene}:${k.c} — 正解 ${k.chrom}:${k.start} が候補に無い`);
  }

  if (k.category !== "cds:substitution" || !/^p\.[A-Z][a-z]{2}\d+([A-Z][a-z]{2}|Ter)$/.test(k.p)) return;
  const label3 = "形式3: NP_:p. → コドン範囲に正解位置を含むか";
  const prot = cand?.protein;
  if (!prot) {
    record("f3:missense", label3, "skip", "NM_ に対応する NP_ が不明");
    return;
  }
  coldStart();
  const r3 = await convertOne(`${prot}:${k.p}`);
  const pc = r3.candidates.find((c) => c.transcript === k.nm && c.chrom === k.chrom);
  if (!pc) {
    record("f3:missense", label3, r3.candidates.length ? "skip" : "fail", r3.candidates.length ? "NP_ が別バージョンの NM_ に解決された" : `${prot}:${k.p} — 候補なし: ${r3.message ?? ""}`);
    return;
  }
  const codon = (pc.verify?.points ?? []).map((x) => x.pos);
  record("f3:missense", label3, codon.includes(k.start) ? "pass" : "fail", `${prot}:${k.p} — 本ツール コドン ${codon.join(",")}, ClinVar ${k.start}`);
}

async function checkEquivalent({ k, q, cand }: Deferred) {
  const key = `f2:${k.category}`;
  const label = "形式2: NM_:c. → hg38 位置";
  const wLo = Math.min(cand.start, k.posVcf) - 60;
  const wHi = Math.max(cand.end, k.posVcf + k.refVcf.length) + 60;
  let seq: string;
  try {
    seq = await getSequence(cand.chrom, wLo, wHi);
  } catch {
    record(key, label, "skip", "参照配列を取得できず等価性を判定できない");
    return false;
  }
  const ref = (a: number, b: number) => seq.slice(a - wLo, b - wLo + 1);
  const ours = ourEdit(q, cand, cand.start, cand.end, ref);
  const same =
    ours !== undefined &&
    applyEdit(seq, wLo, ours.start, ours.end, ours.insert) === applyEdit(seq, wLo, k.posVcf, k.posVcf + k.refVcf.length - 1, k.altVcf);
  record(key, label, same ? "pass" : "fail", `${k.nm}:${k.c} — 本ツール ${cand.chrom}:${cand.start}-${cand.end}, ClinVar ${k.chrom}:${k.start}-${k.stop}（VCF ${k.posVcf} ${k.refVcf}>${k.altVcf}）`);
  return same;
}

async function checkLive(k: Case) {
  coldStart();
  const key = "e2e";
  const label = "画面と同じ処理（参照配列の照合を含む）";
  const r: ConversionResult = await convertOne(`${k.nm}:${k.c}`);
  const cand = r.candidates.find((c) => c.transcript === k.nm && c.chrom === k.chrom);
  if (!cand) {
    record(key, label, "fail", `${k.nm}:${k.c} — 候補なし: ${r.message ?? ""}`);
    return;
  }
  if (cand.warnings.some((w) => w.includes("参照配列を取得できなかった"))) {
    record(key, label, "skip", "参照配列を取得できない");
    return;
  }
  const posOk = isSub(k) ? cand.start === k.start : true;
  record(key, label, posOk && (!cand.refCheck || cand.refCheck.ok) ? "pass" : "fail", `${k.nm}:${k.c} — ${cand.chrom}:${cand.start}-${cand.end}, 照合 ${JSON.stringify(cand.refCheck)}`);
}

async function main() {
  const t0 = Date.now();
  const { source, cases } = loadCases(SAMPLE_FILE);
  const deferred: Deferred[] = [];

  setSequenceOffline(true);
  let done = 0;
  // One query at a time: concurrent queries would share whichever index the first one loaded.
  await pool(cases, 1, async (k) => {
    await checkCase(k, deferred);
    if (++done % 500 === 0) console.log(`${done}/${cases.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  });

  setSequenceOffline(false);
  console.log(`indel equivalence: ${deferred.length}`);
  let shifted = 0;
  await pool(deferred, 2, async (d) => {
    if (await checkEquivalent(d)) shifted++;
  });
  saveSequenceCache();

  const step = Math.max(1, Math.floor(cases.length / NETWORK_SAMPLE));
  const live = cases.filter((_, i) => i % step === 0).slice(0, NETWORK_SAMPLE);
  console.log(`live sample: ${live.length}`);
  await pool(live, 2, checkLive);
  saveSequenceCache();

  const idx = await getIndex();
  writeReport(source, cases.length, shifted, (Date.now() - t0) / 1000, idx.loaded.size);
  console.log("external requests:", requestCounts);
}

function writeReport(source: string, total: number, shifted: number, secs: number, lastBuckets: number) {
  const order = Object.keys(stats).sort();
  const lines: string[] = [];
  lines.push("# ClinVar を正解とした検証レポート（公開版と同じ読み込み方式）", "");
  lines.push(`- 実行日時: ${new Date().toISOString()}`);
  lines.push(`- 正解データ: ${source}`);
  lines.push(`- サンプル: ${total.toLocaleString()} 件（\`validation/${path.basename(SAMPLE_FILE)}\`）`);
  lines.push(`- 所要時間: ${secs.toFixed(0)} 秒`);
  lines.push(`- 外部への問い合わせ回数: ${Object.entries(requestCounts).map(([h, n]) => `${h} ${n} 回`).join("、") || "なし"}`, "");
  lines.push(
    "公開版（UMIN SQUARE）は、ブラウザが目次を読み込んだあと、入力に必要なデータの束だけを取り寄せて計算します。この検証では、入力 1 件ごとにデータを空の状態に戻し（ページを開き直したのと同じ状態）、画面と同じ処理（`convertOne`）で換算しました。",
    "",
    `参考: 最後の入力 1 件で読み込まれた束は 1,024 個中 ${lastBuckets} 個でした。`,
    "",
    "位置の計算は手元のデータだけで行うため、大量に換算する部分では参照配列の問い合わせを送っていません（インターネットに接続できないときと同じ動作）。参照配列が必要な欠失・挿入の等価判定と、参照配列の照合を含む抜き取り確認だけを、各サービスの公表している上限（UCSC 1 秒に 1 回、Ensembl 1 秒に約 15 回、NCBI 1 秒に 3 回）を下回る間隔で問い合わせました。",
    "",
  );
  lines.push("| 検証項目 | 区分 | 一致 | 不一致 | 対象外 | 一致率 |", "| --- | --- | ---: | ---: | ---: | ---: |");
  let totalPass = 0;
  let totalFail = 0;
  for (const k of order) {
    const s = stats[k];
    const n = s.pass + s.fail;
    totalPass += s.pass;
    totalFail += s.fail;
    const cat = k.split(":").slice(1).join(":") || "—";
    lines.push(`| ${s.label} | ${cat} | ${s.pass} | ${s.fail} | ${s.skip} | ${n ? ((100 * s.pass) / n).toFixed(2) : "—"}% |`);
  }
  lines.push(`| **合計** | | **${totalPass}** | **${totalFail}** | | **${((100 * totalPass) / (totalPass + totalFail)).toFixed(2)}%** |`, "");
  lines.push(
    `欠失・重複・挿入・欠失挿入のうち ${shifted} 件は、ClinVar の Start/Stop と範囲が一致しませんでしたが、hg38 の参照配列に両方の変異を適用した結果が完全に同一だったため「一致」としました（VCF の左寄せと HGVS の 3' 側寄せの違い）。`,
    "",
    "## 対象外の理由",
    "",
  );
  for (const k of order) for (const [reason, n] of stats[k].skips) lines.push(`- ${stats[k].label}（${k.split(":").slice(1).join(":") || "—"}）: ${reason} — ${n} 件`);
  lines.push("", "## 不一致の一覧", "");
  for (const k of order) {
    const s = stats[k];
    if (!s.failures.length) continue;
    lines.push(`### ${s.label}（${k.split(":").slice(1).join(":") || "—"}） — ${s.failures.length} 件`, "");
    for (const f of s.failures.slice(0, 100)) lines.push(`- ${f}`);
    if (s.failures.length > 100) lines.push(`- …ほか ${s.failures.length - 100} 件`);
    lines.push("");
  }
  writeFileSync(REPORT_FILE, lines.join("\n"));
  console.log(lines.slice(0, order.length + 16).join("\n"));
  console.log(`\nfailures: ${totalFail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
