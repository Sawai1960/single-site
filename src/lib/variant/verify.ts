/*
 * Cross-checks this tool's conversions against databases that do not use the UCSC alignments:
 * NCBI Variation Services (NCBI's own transcript–genome alignments, including old NM_ versions)
 * and Ensembl VEP with RefSeq transcripts (current versions only).
 */
import { revComp } from "./codon";
import { chromToNC } from "./chrom";
import {
  ensemblVepHgvs,
  ensemblVepRegion,
  ExternalError,
  ncbiEquivalents,
  ncbiHgvsContextual,
  type Spdi,
} from "./external-api";
import { formatPos } from "./format";
import { accBase } from "./refseq";
import { getRefSeqRecord, getSequence } from "./remote";
import type { CheckOutcome, ForwardCheck, GenomicEdit, SourceChecks, VerifyPlan, VerifySource } from "./types";

export interface VerifyItem {
  transcript: string;
  chrom: string;
  plan: VerifyPlan;
}

const match = (detail: string): CheckOutcome => ({ status: "match", detail });
const mismatch = (detail: string): CheckOutcome => ({ status: "mismatch", detail });
const unavailable = (detail: string): CheckOutcome => ({ status: "unavailable", detail });

const INTRONIC = /^c\.[-*]?\d+[+-]\d+$/;

export function describeEdit(chrom: string, e: GenomicEdit): string {
  if (e.to < e.from) return `${chrom}:${formatPos(e.to)}^${formatPos(e.from)} 挿入 ${e.alt}`;
  const at = `${chrom}:${formatPos(e.from)}${e.to > e.from ? `-${formatPos(e.to)}` : ""}`;
  return e.alt ? `${at} → ${e.alt}` : `${at} 欠失`;
}

function applyEdit(seq: string, offset: number, e: GenomicEdit): string {
  return seq.slice(0, e.from - offset) + e.alt + seq.slice(e.to - offset + 1);
}

/** Two edits are the same variant when they produce the same sequence (indels in repeats can be written at different positions). */
export async function sameVariant(chrom: string, a: GenomicEdit, b: GenomicEdit): Promise<boolean> {
  if (a.from === b.from && a.to === b.to && a.alt === b.alt) return true;
  const lo = Math.min(a.from, b.from) - 30;
  const hi = Math.max(a.to, b.to, a.from, b.from) + 30;
  if (hi - lo > 5000) return false;
  const seq = await getSequence(chrom, lo, hi);
  return applyEdit(seq, lo, a) === applyEdit(seq, lo, b);
}

function spdiToEdit(s: Spdi): GenomicEdit {
  return { from: s.position + 1, to: s.position + s.deleted_sequence.length, alt: s.inserted_sequence };
}

function spdiText(s: Spdi): string {
  return `${s.seq_id}:${s.position}:${s.deleted_sequence}:${s.inserted_sequence}`;
}

/** c. position from a 1-based transcript position and the CDS range of that exact version. */
export function txToCText(tx: number, cds: [number, number]): string {
  if (tx < cds[0]) return `c.-${cds[0] - tx}`;
  if (tx > cds[1]) return `c.*${tx - cds[1]}`;
  return `c.${tx - cds[0] + 1}`;
}

function combine(outcomes: CheckOutcome[]): CheckOutcome | undefined {
  if (!outcomes.length) return undefined;
  const pick = (s: CheckOutcome["status"]) => [...new Set(outcomes.filter((o) => o.status === s).map((o) => o.detail))];
  const bad = pick("mismatch");
  if (bad.length) return mismatch(bad.join(" / "));
  const ok = pick("match");
  const na = pick("unavailable");
  if (ok.length) return match(ok.join(" / ") + (na.length ? `（ほか ${na.length} 件は確認不可: ${na[0]}）` : ""));
  return unavailable(na.join(" / "));
}

function ncbiReason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Intronic variants are not yet supported/i.test(m)) return "NCBI はイントロン内の変異の変換に対応していません";
  if (/does not agree with the actual reference|not equal to variant's asserted reference/i.test(m)) {
    return "入力の参照塩基が NCBI の転写産物配列と一致しません";
  }
  if (e instanceof ExternalError) return `NCBI: ${m.slice(0, 160)}`;
  return "NCBI に接続できませんでした";
}

async function ncbiForwardOne(chrom: string, f: ForwardCheck): Promise<CheckOutcome> {
  const nc = chromToNC(chrom);
  if (!nc) return unavailable("この染色体は照合できません");
  let edit = f.edit;
  let suffix = "";
  let ctx: Spdi[];
  try {
    ctx = await ncbiHgvsContextual(f.hgvs);
  } catch (e) {
    const reason = ncbiReason(e);
    if (!reason.startsWith("入力の参照塩基")) return unavailable(reason);
    try {
      ctx = await ncbiHgvsContextual(`${f.at.hgvs}del`);
    } catch (e2) {
      return unavailable(ncbiReason(e2));
    }
    edit = { from: f.at.from, to: f.at.to, alt: "" };
    suffix = `（${reason}。位置のみ照合）`;
  }
  if (!ctx.length) return unavailable("NCBI が結果を返しませんでした");
  let eq: Spdi[];
  try {
    eq = await ncbiEquivalents(spdiText(ctx[0]));
  } catch (e) {
    return unavailable(ncbiReason(e));
  }
  const onGenome = eq.find((s) => s.seq_id === nc);
  if (!onGenome) return unavailable(`NCBI に ${f.hgvs.split(":")[0]} の hg38 上の対応位置がありません`);
  const ext = spdiToEdit(onGenome);
  try {
    return (await sameVariant(chrom, ext, edit))
      ? match(`NCBI: ${describeEdit(chrom, ext)}${suffix}`)
      : mismatch(`NCBI: ${describeEdit(chrom, ext)}／本ツール: ${describeEdit(chrom, edit)}${suffix}`);
  } catch {
    return unavailable("参照配列を取得できず、一致を判定できませんでした");
  }
}

async function genomeBase(chrom: string, pos: number): Promise<{ ref: string; alt: string }> {
  const ref = (await getSequence(chrom, pos, pos)).toUpperCase();
  return { ref, alt: ref === "A" ? "C" : "A" };
}

async function ncbiReverseOne(item: VerifyItem, p: { pos: number; c: string }): Promise<CheckOutcome> {
  if (INTRONIC.test(p.c)) return unavailable("イントロン内の位置は NCBI の対応表に無いため照合できません");
  const nc = chromToNC(item.chrom);
  if (!nc) return unavailable("この染色体は照合できません");
  let eq: Spdi[];
  try {
    const { ref, alt } = await genomeBase(item.chrom, p.pos);
    eq = await ncbiEquivalents(`${nc}:${p.pos - 1}:${ref}:${alt}`);
  } catch (e) {
    return unavailable(ncbiReason(e));
  }
  const hit = eq.find((s) => s.seq_id === item.transcript);
  const others = eq.filter((s) => accBase(s.seq_id) === accBase(item.transcript));
  if (!hit) {
    return unavailable(
      others.length
        ? `NCBI の対応表に ${item.transcript} がありません（${others.map((s) => s.seq_id).join("、")} はあり）`
        : `NCBI の対応表では、この位置に ${item.transcript} がありません`,
    );
  }
  let cds: [number, number] | undefined;
  try {
    cds = (await getRefSeqRecord(item.transcript)).cds;
  } catch {
    return unavailable(`NCBI から ${item.transcript} のコード領域を取得できませんでした`);
  }
  if (!cds) return unavailable(`${item.transcript} のコード領域が NCBI のレコードにありません`);
  const c = txToCText(hit.position + 1, cds);
  const at = `${item.chrom}:${formatPos(p.pos)}`;
  return c === p.c ? match(`${at} → NCBI ${c}`) : mismatch(`${at} → NCBI ${c}／本ツール ${p.c}`);
}

async function verifyNcbi(items: VerifyItem[]): Promise<SourceChecks[]> {
  return Promise.all(
    items.map(async (item) => {
      const forward = await Promise.all(item.plan.forward.map((f) => ncbiForwardOne(item.chrom, f)));
      const reverse = await Promise.all(item.plan.points.map((p) => ncbiReverseOne(item, p)));
      return { forward: combine(forward), reverse: combine(reverse) };
    }),
  );
}

const vepChrom = (chrom: string) => chrom.replace(/^chr/, "").replace(/^M$/, "MT");

function ensemblReason(e: unknown, acc: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/transcript|Could not get|Unable to parse|not found|Invalid/i.test(m)) {
    return `Ensembl の RefSeq データに ${acc} がありません（Ensembl は現行版のみ収録）`;
  }
  if (/does not match|reference allele|Reference allele/i.test(m)) return "入力の参照塩基が Ensembl の配列と一致しません";
  return e instanceof ExternalError ? `Ensembl: ${m.slice(0, 160)}` : "Ensembl に接続できませんでした（混雑時は時間をおいて再実行してください）";
}

function vepToEdit(h: { start: number; end: number; allele_string: string; strand: number }): GenomicEdit | undefined {
  let [ref, alt] = h.allele_string.split("/");
  if (ref === undefined || alt === undefined) return undefined;
  if (h.strand === -1) {
    ref = ref === "-" ? ref : revComp(ref);
    alt = alt === "-" ? alt : revComp(alt);
  }
  if (ref === "-") return { from: h.start, to: h.start - 1, alt };
  return { from: h.start, to: h.end, alt: alt === "-" ? "" : alt };
}

async function verifyEnsembl(items: VerifyItem[]): Promise<SourceChecks[]> {
  const notations = [...new Set(items.flatMap((i) => i.plan.forward.map((f) => f.hgvs)))];
  const points = new Map<string, string>();
  await Promise.all(
    items.flatMap((i) =>
      i.plan.points.map(async (p) => {
        const k = `${i.chrom}:${p.pos}`;
        if (points.has(k)) return;
        points.set(k, "");
        try {
          const { ref, alt } = await genomeBase(i.chrom, p.pos);
          points.set(k, `${vepChrom(i.chrom)} ${p.pos} . ${ref} ${alt} . . .`);
        } catch {
          points.delete(k);
        }
      }),
    ),
  );

  const [fwd, rev] = await Promise.all([
    notations.length ? ensemblVepHgvs(notations).catch((e: unknown) => e) : Promise.resolve(new Map()),
    points.size ? ensemblVepRegion([...points.values()]).catch((e: unknown) => e) : Promise.resolve(new Map()),
  ]);

  return Promise.all(
    items.map(async (item) => {
      const forward = await Promise.all(
        item.plan.forward.map(async (f): Promise<CheckOutcome> => {
          if (!(fwd instanceof Map)) return unavailable(ensemblReason(fwd, item.transcript));
          const hit = fwd.get(f.hgvs);
          if (!hit || hit instanceof Error) return unavailable(ensemblReason(hit, item.transcript));
          if (`chr${hit.seq_region_name}`.replace(/^chrMT$/, "chrM") !== item.chrom) {
            return mismatch(`Ensembl: chr${hit.seq_region_name}:${formatPos(hit.start)}／本ツール: ${describeEdit(item.chrom, f.edit)}`);
          }
          const ext = vepToEdit(hit);
          if (!ext) return unavailable("Ensembl の結果を解釈できませんでした");
          try {
            return (await sameVariant(item.chrom, ext, f.edit))
              ? match(`Ensembl: ${describeEdit(item.chrom, ext)}`)
              : mismatch(`Ensembl: ${describeEdit(item.chrom, ext)}／本ツール: ${describeEdit(item.chrom, f.edit)}`);
          } catch {
            return unavailable("参照配列を取得できず、一致を判定できませんでした");
          }
        }),
      );
      const reverse = item.plan.points.map((p): CheckOutcome => {
        if (!(rev instanceof Map)) return unavailable(ensemblReason(rev, item.transcript));
        const line = points.get(`${item.chrom}:${p.pos}`);
        const hits = line ? rev.get(line) : undefined;
        if (!hits) return unavailable("参照配列を取得できなかったため照合していません");
        const hit = hits.find((h: { transcript_id: string }) => h.transcript_id === item.transcript);
        if (!hit) {
          const others = [...new Set(hits.map((h: { transcript_id: string }) => h.transcript_id).filter((t: string) => accBase(t) === accBase(item.transcript)))];
          return unavailable(
            others.length
              ? `Ensembl の RefSeq データは ${others.join("、")} のみです（${item.transcript} は未収録）`
              : `Ensembl では、この位置に ${item.transcript} がありません`,
          );
        }
        const c = hit.hgvsc?.match(/:(c\.[-*]?\d+(?:[+-]\d+)?)/)?.[1];
        if (!c) return unavailable("Ensembl が c. 表記を返しませんでした（転写産物の範囲外など）");
        const at = `${item.chrom}:${formatPos(p.pos)}`;
        return c === p.c ? match(`${at} → Ensembl ${c}`) : mismatch(`${at} → Ensembl ${c}／本ツール ${p.c}`);
      });
      return { forward: combine(forward), reverse: combine(reverse) };
    }),
  );
}

export function verifyItems(source: VerifySource, items: VerifyItem[]): Promise<SourceChecks[]> {
  return source === "ncbi" ? verifyNcbi(items) : verifyEnsembl(items);
}
