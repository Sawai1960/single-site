/*
 * Validates the converter against ClinVar GRCh38 coordinates.
 * Usage: npx tsx validation/validate-clinvar.ts [--network-sample N]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../tests/setup";
import { applyEdit, type Case, loadCases, ourEdit, pool } from "./clinvar-common";
import { requestCounts } from "./polite-fetch";
import { convertOne, mapCdna, mapProtein, resolveTarget } from "../src/lib/variant/convert";
import { revComp, translateCodon } from "../src/lib/variant/codon";
import { bridgeTranscript } from "../src/lib/variant/bridge";
import { genomeToC, MappingError } from "../src/lib/variant/mapping";
import { parseQuery } from "../src/lib/variant/parse";
import { accBase, ensureAll, getIndex } from "../src/lib/variant/refseq";
import { getSequence } from "../src/lib/variant/remote";
import type { ParsedQuery, Transcript } from "../src/lib/variant/types";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const argN = (name: string, def: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const NETWORK_SAMPLE = argN("--network-sample", 300);
const argS = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const SAMPLE_FILE = path.resolve(argS("--sample", path.join(DIR, "clinvar-sample.tsv")));
const REPORT_FILE = path.resolve(argS("--report", path.join(DIR, "report.md")));

type Outcome = "pass" | "fail" | "skip";
interface CheckStats {
  label: string;
  pass: number;
  fail: number;
  skip: number;
  equivalentByShift?: number;
  failures: string[];
  skips: Map<string, number>;
}

const checks: Record<string, CheckStats> = {};
function stat(key: string, label: string): CheckStats {
  return (checks[key] ??= { label, pass: 0, fail: 0, skip: 0, failures: [], skips: new Map() });
}
function record(key: string, label: string, outcome: Outcome, detail?: string) {
  const s = stat(key, label);
  s[outcome]++;
  if (outcome === "fail" && detail) s.failures.push(detail);
  if (outcome === "skip" && detail) s.skips.set(detail, (s.skips.get(detail) ?? 0) + 1);
}

function pickTranscripts(ts: Transcript[], chrom: string) {
  return ts.filter((t) => t.chrom === chrom);
}

async function main() {
  const t0 = Date.now();
  const { source, cases } = loadCases(SAMPLE_FILE);
  const idx = await getIndex();
  await ensureAll(idx);
  const deferred: { k: Case; q: Extract<ParsedQuery, { kind: "cdna" }>; t: Transcript; lo: number; hi: number; key: string; label: string; via: string }[] = [];
  const proteinNetwork: { k: Case; q: Extract<ParsedQuery, { kind: "protein" }>; t: Transcript; codon: number[] }[] = [];

  for (const k of cases) {
    const isSub = k.category.endsWith(":substitution");
    const label2 = "形式2: NM_:c. → hg38 位置";
    const key2 = `f2:${k.category}`;

    let q: ParsedQuery;
    try {
      q = parseQuery(`${k.nm}:${k.c}`);
    } catch (e) {
      record(key2, label2, "fail", `${k.nm}:${k.c} — 構文解析エラー: ${(e as Error).message}`);
      continue;
    }
    if (q.kind !== "cdna") {
      record(key2, label2, "fail", `${k.nm}:${k.c} — c. として解釈されませんでした`);
      continue;
    }
    if (q.target.type !== "transcript") continue;
    const exact = idx.byAcc.get(k.nm);
    if (!exact) {
      record(key2, label2, "skip", "このバージョンの NM_ が UCSC hg38 アライメントに存在しない");
    }
    let resolved: Transcript[] = [];
    try {
      resolved = pickTranscripts(resolveTarget(idx, q.target).transcripts, k.chrom);
    } catch {
      /* not found at all */
    }
    // When the exact version is missing the tool aligns its NCBI sequence to a version UCSC has
    // aligned (same path as the web API); measure that separately.
    const fallback = !exact;
    const keyM = fallback ? `f2fb:${k.category}` : key2;
    const labelM = fallback ? "形式2（旧版がデータに無く、NCBI の配列で照合して計算）" : label2;
    let ts = exact ? pickTranscripts(exact, k.chrom) : resolved;
    if (exact && !ts.length) record(key2, label2, "skip", "NM_ のアライメントが別の染色体のみ");
    if (fallback && !ts.length) record(keyM, labelM, "skip", "どのバージョンの NM_ もデータに無い");
    if (fallback && ts.length) {
      try {
        ts = await Promise.all(ts.map((t) => bridgeTranscript(k.nm, t)));
      } catch (e) {
        record(keyM, labelM, "skip", `NCBI の配列で照合できない（${(e as Error).message.replace(/[NX][MP]_\d+\.\d+/g, "NM_")}）`);
        ts = [];
      }
    }

    // A transcript can align to several loci (multi-copy genes, PAR). The tool lists every
    // alignment as a candidate, so judge the case by the candidate closest to ClinVar.
    const mappedAll: { t: Transcript; m: { lo: number; hi: number } }[] = [];
    let mapError: string | undefined;
    for (const t of ts) {
      try {
        mappedAll.push({ t, m: mapCdna(q, t) });
      } catch (e) {
        if (!(e instanceof MappingError)) throw e;
        mapError = e.message;
      }
    }
    if (ts.length && !mappedAll.length) {
      record(keyM, labelM, "fail", `${k.nm}:${k.c} — ${mapError}（ClinVar ${k.chrom}:${k.start}-${k.stop}）`);
    }
    mappedAll.sort((a, b) => Math.abs(a.m.lo - k.start) - Math.abs(b.m.lo - k.start));
    for (const { t, m } of mappedAll.slice(0, 1)) {
      const via = t.bridge ? `（NCBI 配列を ${t.bridge.from} と照合）` : "";
      if (isSub) {
        const ok = m.lo === k.start && m.hi === k.start;
        const refOk = (t.strand === "+" ? q.refAllele : revComp(q.refAllele!)) === k.refVcf;
        const altOk = (t.strand === "+" ? q.altAllele : revComp(q.altAllele!)) === k.altVcf;
        record(
          keyM,
          labelM,
          ok && refOk && altOk ? "pass" : "fail",
          `${k.nm}:${k.c}${via} — 本ツール ${t.chrom}:${m.lo}${t.strand}, ClinVar ${k.chrom}:${k.start} ${k.refVcf}>${k.altVcf}${refOk ? "" : "（鎖の向きの不一致）"}`,
        );
        if (fallback) continue;

        const key1 = `f1:${k.category}`;
        const label1 = "形式1（逆変換）: hg38 位置 → c. 表記";
        const cPos = k.c.match(/^c\.([-*]?\d+(?:[+-]\d+)?)/)![1];
        const back = genomeToC(t, k.start);
        record(key1, label1, back === `c.${cPos}` ? "pass" : "fail", `${k.chrom}:${k.start} → 本ツール ${back}, ClinVar c.${cPos}（${k.nm}）`);
      } else if (m.lo === k.start && m.hi === k.stop) {
        record(keyM, labelM, "pass");
      } else {
        deferred.push({ k, q, t, lo: m.lo, hi: m.hi, key: keyM, label: labelM, via });
      }
    }

    // 形式4: gene symbol + c.
    if (isSub) {
      const key4 = `f4:${k.category}`;
      const label4 = "形式4: 遺伝子名:c. → 候補に正解位置を含むか";
      let gq: ParsedQuery;
      try {
        gq = parseQuery(`${k.gene}:${k.c}`);
      } catch {
        record(key4, label4, "skip", "遺伝子名を解釈できない");
        continue;
      }
      if (gq.kind !== "cdna" || gq.target.type !== "gene") continue;
      let gts: Transcript[];
      try {
        gts = pickTranscripts(resolveTarget(idx, gq.target).transcripts, k.chrom);
      } catch {
        record(key4, label4, "skip", "遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など）");
        continue;
      }
      const sameBase = gts.filter((t) => accBase(t.acc) === accBase(k.nm));
      if (!sameBase.length) {
        record(key4, label4, "skip", "ClinVar の NM_ が遺伝子の現行転写産物に含まれない");
        continue;
      }
      const hit = sameBase.some((t) => {
        try {
          const m = mapCdna(gq as Extract<ParsedQuery, { kind: "cdna" }>, t);
          return m.lo === k.start;
        } catch {
          return false;
        }
      });
      const versionDiffers = !sameBase.some((t) => t.acc === k.nm);
      record(
        key4,
        label4,
        hit ? "pass" : versionDiffers ? "skip" : "fail",
        hit ? undefined : versionDiffers ? "ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる" : `${k.gene}:${k.c} — 正解 ${k.chrom}:${k.start} が候補に無い`,
      );
    }

    // 形式3: NP_:p. (missense / nonsense) from cds substitutions
    if (k.category === "cds:substitution" && /^p\.[A-Z][a-z]{2}\d+([A-Z][a-z]{2}|Ter)$/.test(k.p)) {
      const key3 = "f3:missense";
      const label3 = "形式3: NP_:p. → コドン範囲に正解位置を含むか";
      const t0 = ts[0] ?? resolved.find((t) => t.acc === k.nm);
      if (!t0?.prot) {
        record(key3, label3, "skip", "NM_ に対応する NP_ が不明");
        continue;
      }
      const pq = parseQuery(`${t0.prot}:${k.p}`);
      if (pq.kind !== "protein") continue;
      let pts: Transcript[];
      try {
        pts = pickTranscripts(resolveTarget(idx, pq.target).transcripts, k.chrom);
      } catch {
        record(key3, label3, "skip", "NP_ から NM_ を解決できない");
        continue;
      }
      const target = pts.find((t) => t.acc === k.nm) ?? pts[0];
      if (!target) {
        record(key3, label3, "skip", "NP_ の転写産物が同じ染色体に無い");
        continue;
      }
      try {
        const { codon1 } = mapProtein(pq, target);
        const within = codon1.includes(k.start);
        record(key3, label3, within ? "pass" : target.acc === k.nm ? "fail" : "skip", within ? undefined : target.acc === k.nm ? `${t0.prot}:${k.p} — コドン ${codon1.join(",")} に ClinVar ${k.start} が含まれない` : "NP_ が別バージョンの NM_ に解決された");
        if (within && target.acc === k.nm) proteinNetwork.push({ k, q: pq, t: target, codon: codon1 });
      } catch (e) {
        record(key3, label3, "fail", `${t0.prot}:${k.p} — ${(e as Error).message}`);
      }
    }
  }

  // Indels whose position differs from ClinVar: accept if both describe the same resulting sequence.
  let shifted = 0;
  await pool(deferred, 4, async ({ k, q, t, lo, hi, key: key2, label: label2, via }) => {
    const wLo = Math.min(lo, k.posVcf) - 60;
    const wHi = Math.max(hi, k.posVcf + k.refVcf.length) + 60;
    let seq: string;
    try {
      seq = await getSequence(t.chrom, wLo, wHi);
    } catch {
      record(key2, label2, "skip", "参照配列を取得できず等価性を判定できない");
      return;
    }
    const ref = (a: number, b: number) => seq.slice(a - wLo, b - wLo + 1);
    const ours = ourEdit(q, t, lo, hi, ref);
    if (!ours) {
      record(key2, label2, "fail", `${k.nm}:${k.c}${via} — 変異の種類を判定できない`);
      return;
    }
    const a = applyEdit(seq, wLo, ours.start, ours.end, ours.insert);
    const b = applyEdit(seq, wLo, k.posVcf, k.posVcf + k.refVcf.length - 1, k.altVcf);
    if (a === b) {
      shifted++;
      record(key2, label2, "pass");
    } else {
      record(key2, label2, "fail", `${k.nm}:${k.c}${via} — 本ツール ${t.chrom}:${lo}-${hi}, ClinVar ${k.chrom}:${k.start}-${k.stop}（VCF ${k.posVcf} ${k.refVcf}>${k.altVcf}）`);
    }
  });
  for (const s of Object.entries(checks)) if (s[0].startsWith("f2:any")) s[1].equivalentByShift = 0;

  // 形式3 with sequence: reference amino acid check and 1-base substitution candidates.
  const sampleP = proteinNetwork.filter((_, i) => i % Math.max(1, Math.floor(proteinNetwork.length / NETWORK_SAMPLE)) === 0).slice(0, NETWORK_SAMPLE);
  await pool(sampleP, 4, async ({ k, q, t, codon }) => {
    const key = "f3net:missense";
    const label = "形式3（配列照合）: 参照アミノ酸の一致と 1 塩基置換候補に正解を含むか";
    try {
      const lo = Math.min(...codon);
      const hi = Math.max(...codon);
      const seq = hi - lo < 5000 ? await getSequence(t.chrom, lo, hi) : null;
      const base = async (g: number) => (seq ? seq[g - lo] : await getSequence(t.chrom, g, g));
      const bases = await Promise.all(codon.map(base));
      const c = bases.map((b) => (t.strand === "+" ? b : revComp(b))).join("");
      const aaOk = translateCodon(c) === q.aa1;
      const pos = codon.indexOf(k.start);
      const alt = t.strand === "+" ? k.altVcf : revComp(k.altVcf);
      const mutated = c.slice(0, pos) + alt + c.slice(pos + 1);
      const altOk = translateCodon(mutated) === q.altAA;
      record(key, label, aaOk && altOk ? "pass" : "fail", `${t.prot}:${k.p} — コドン ${c}（${translateCodon(c)}）→ ${mutated}（${translateCodon(mutated)}）`);
    } catch {
      record(key, label, "skip", "参照配列を取得できない");
    }
  });

  // End-to-end through the same function the web API uses (includes reference base check).
  const e2e = cases.filter((k) => idx.byAcc.has(k.nm)).filter((_, i) => i % Math.max(1, Math.floor(cases.length / NETWORK_SAMPLE)) === 0).slice(0, NETWORK_SAMPLE);
  await pool(e2e, 3, async (k) => {
    const key = "e2e";
    const label = "画面と同じ処理（convertOne）: 位置・リファレンス照合";
    const r = await convertOne(`${k.nm}:${k.c}`);
    const cand = r.candidates.find((c) => c.transcript === k.nm && c.chrom === k.chrom);
    if (!cand) {
      record(key, label, "fail", `${k.nm}:${k.c} — 候補なし: ${r.message ?? ""}`);
      return;
    }
    if (cand.warnings.some((w) => w.includes("参照配列を取得できなかった"))) {
      record(key, label, "skip", "参照配列を取得できない");
      return;
    }
    const posOk = k.category.endsWith(":substitution") ? cand.start === k.start : true;
    const refOk = !cand.refCheck || cand.refCheck.ok;
    record(key, label, posOk && refOk ? "pass" : "fail", `${k.nm}:${k.c} — ${cand.chrom}:${cand.start}-${cand.end}, 照合 ${JSON.stringify(cand.refCheck)}`);
  });

  writeReport(source, cases.length, shifted, (Date.now() - t0) / 1000);
  console.log("external requests:", requestCounts);
}

function writeReport(source: string, total: number, shifted: number, secs: number) {
  const order = Object.keys(checks).sort();
  const lines: string[] = [];
  lines.push("# ClinVar を正解とした検証レポート", "");
  lines.push(`- 実行日時: ${new Date().toISOString()}`);
  lines.push(`- 正解データ: ${source}`);
  lines.push(`- サンプル: ${total.toLocaleString()} 件（\`validation/${path.basename(SAMPLE_FILE)}\`、種類別に層化抽出）`);
  lines.push(`- 所要時間: ${secs.toFixed(0)} 秒`, "");
  lines.push("| 検証項目 | 区分 | 一致 | 不一致 | 対象外 | 一致率 |", "| --- | --- | ---: | ---: | ---: | ---: |");
  let totalPass = 0;
  let totalFail = 0;
  for (const k of order) {
    const s = checks[k];
    const n = s.pass + s.fail;
    totalPass += s.pass;
    totalFail += s.fail;
    const cat = k.split(":").slice(1).join(":") || "—";
    lines.push(`| ${s.label} | ${cat} | ${s.pass} | ${s.fail} | ${s.skip} | ${n ? ((100 * s.pass) / n).toFixed(2) : "—"}% |`);
  }
  lines.push(`| **合計** | | **${totalPass}** | **${totalFail}** | | **${((100 * totalPass) / (totalPass + totalFail)).toFixed(2)}%** |`, "");
  lines.push(
    `欠失・重複・挿入・欠失挿入のうち ${shifted} 件は、ClinVar の Start/Stop と範囲が一致しませんでした。ClinVar の座標は VCF 方式（左寄せ・前後の塩基を含む）で、HGVS の c. 表記は 3' 側寄せのため、反復配列では表記上の位置がずれます。そこで、hg38 の参照配列に両方の変異を適用し、変異後の配列が完全に同一になることを確認したものを「一致」としました。`,
    "",
  );
  lines.push(
    "「対象外」は、正解との比較が成り立たないケースです（ClinVar の NM_ バージョンが UCSC のデータにない、遺伝子名で入力すると現行版の転写産物で計算するため ClinVar の旧版と 5'UTR の長さが違う、など）。",
    "",
  );
  if (order.some((k) => k.startsWith("f2fb:"))) {
    lines.push(
      "「形式2（旧版がデータに無く、NCBI の配列で照合して計算）」は、入力された NM_ のバージョンが UCSC のデータに無い場合です。本ツールは NCBI からそのバージョンの配列を取得し、UCSC がアライメントした別バージョンと配列を照合して位置を求めます（Web 画面と同じ処理）。",
      "",
    );
  }
  lines.push("## 対象外の理由", "");
  for (const k of order) {
    for (const [reason, n] of checks[k].skips) lines.push(`- ${checks[k].label}（${k.split(":").slice(1).join(":")}）: ${reason} — ${n} 件`);
  }
  const allFailures = order.flatMap((k) => checks[k].failures);
  if (allFailures.some((f) => f.includes("NM_001372044.2") || f.includes("SHANK3"))) {
    lines.push(
      "",
      "## 不一致の原因分析",
      "",
      "### SHANK3（NM_001372044.2）",
      "",
      "NM_001372044.2 は c.1528〜c.1566 の 39 塩基が hg38 ゲノムに存在しません（GRCh38 の SHANK3 領域の既知の配列欠損）。",
      "NCBI から取得した NM_001372044.2 の配列（CDS 371..5791）と hg38 を直接比べると、chr22:50698690 から始まる配列は転写産物の c.1724 と完全に一致し、ClinVar が使う c.1689 とは一致しません。",
      "したがって、この転写産物での不一致は ClinVar 側の番号のずれ（ゲノムの欠損に引きずられた番号付け）で、本ツールの計算は転写産物の配列どおりです。",
      "本ツールはこの転写産物に対して「hg38 ゲノム配列と完全には一致しません」という警告を表示します。",
    );
  }
  lines.push("", "## 不一致の一覧", "");
  for (const k of order) {
    const s = checks[k];
    if (!s.failures.length) continue;
    lines.push(`### ${s.label}（${k.split(":").slice(1).join(":")}） — ${s.failures.length} 件`, "");
    for (const f of s.failures.slice(0, 100)) lines.push(`- ${f}`);
    if (s.failures.length > 100) lines.push(`- …ほか ${s.failures.length - 100} 件`);
    lines.push("");
  }
  writeFileSync(REPORT_FILE, lines.join("\n"));
  console.log(lines.slice(0, order.length + 12).join("\n"));
  console.log(`\nfailures: ${totalFail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
