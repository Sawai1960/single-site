/*
 * Request rules of the Kazusa DNA Research Institute genetic testing lab (かずさ遺伝子検査室):
 *   K110-40 Ver 8 (2026-06-01) がん関連遺伝子のシングルサイト解析 — NGS, the 60 genes below
 *   K110-6 Ver 9 ヒト遺伝子単一エクソン受託解析 — Sanger, any other gene (sanger検査依頼書2023v1.2.xlsx)
 */
import type { ResultCandidate } from "./types";

const nine = (n: number) => String(n).padStart(9, "0");

export type KazusaMode = "cancer60" | "sanger";

export const MODE_LABEL: Record<KazusaMode, string> = {
  cancer60: "がん関連60遺伝子",
  sanger: "それ以外（Sanger 単一エクソン）",
};

export const CANCER60_GENES: ReadonlySet<string> = new Set([
  "APC", "ATM", "AXIN2", "BMPR1A", "BRCA1", "BRCA2", "BRIP1", "CDH1", "CDKN2A", "CHEK2",
  "DDX41", "DICER1", "EPCAM", "ETV6", "FANCA", "FANCB", "FANCC", "FANCG", "FLCN", "GREM1",
  "MEN1", "MLH1", "MSH2", "MSH3", "MSH6", "MUTYH", "NBN", "NF1", "NF2", "NTHL1",
  "PALB2", "PMS2", "POLD1", "POLE", "PTEN", "RAD51C", "RAD51D", "RB1", "RET", "RUNX1",
  "SAMD9", "SAMD9L", "SDHAF2", "SDHB", "SDHC", "SDHD", "SMAD3", "SMAD4", "STK11", "TGFBR1",
  "TGFBR2", "TP53", "TSC1", "TSC2", "VHL", "WT1", "FH", "MAX", "SDHA", "TMEM127",
]);

const CANCER60_INDEL_LIMIT = 10;
const CANCER60_INTRON_LIMIT = 10;
export const SANGER_SITES_PER_FORM = 5;

export function isCancer60(gene: string): boolean {
  return CANCER60_GENES.has(gene.toUpperCase());
}

/** The c. description without the accession, e.g. "c.194T>G"; undefined for a p. query's codon range. */
function cPart(c: ResultCandidate): string | undefined {
  if (!c.hgvsC || c.hgvsC.includes("（")) return undefined;
  const i = c.hgvsC.indexOf(":");
  return i < 0 ? c.hgvsC : c.hgvsC.slice(i + 1);
}

interface CPoint {
  utr5: boolean;
  utr3: boolean;
  offset: number;
}

function cPoints(c: string): CPoint[] {
  const m = c.match(/^c\.([-*]?)(\d+)([+-]\d+)?(?:_([-*]?)(\d+)([+-]\d+)?)?/);
  if (!m) return [];
  const pt = (sign: string, off?: string): CPoint => ({ utr5: sign === "-", utr3: sign === "*", offset: off ? Number(off) : 0 });
  return m[5] ? [pt(m[1], m[3]), pt(m[4], m[6])] : [pt(m[1], m[3])];
}

/** Size of a deletion/duplication/insertion in bases; undefined for substitutions and unknown sizes. */
export function indelSize(c: ResultCandidate): number | undefined {
  const d = cPart(c);
  if (!d) return undefined;
  const span = c.end - c.start + 1;
  const inserted = d.match(/ins([ACGT]+)$/)?.[1].length ?? Number(d.match(/ins(\d+)$/)?.[1] ?? NaN);
  if (/delins/.test(d)) return Number.isNaN(inserted) ? span : Math.max(span, inserted);
  if (/(del|dup)$/.test(d) || /(del|dup)[ACGT]+$/.test(d)) return span;
  if (/ins/.test(d)) return Number.isNaN(inserted) ? undefined : inserted;
  return undefined;
}

export interface KazusaCheck {
  /** whether the gene is one of the 60 genes; undefined when no gene is assigned */
  cancer60?: boolean;
  issues: string[];
}

export function kazusaCheck(c: ResultCandidate, mode: KazusaMode): KazusaCheck {
  const issues: string[] = [];
  if (c.chrom === "chrM") {
    if (mode === "cancer60") issues.push("ミトコンドリア DNA はがん関連60遺伝子の検査の対象外です");
    return { issues };
  }
  if (!c.gene) {
    issues.push("遺伝子に重ならない位置のため、依頼書の区分を判定できません");
    return { issues };
  }
  const cancer60 = isCancer60(c.gene);
  const size = indelSize(c);
  if (mode === "cancer60") {
    if (!cancer60) {
      issues.push(`${c.gene} はがん関連60遺伝子に含まれません。それ以外（Sanger 単一エクソン）の依頼書をご利用ください`);
    }
    const d = cPart(c);
    const pts = d ? cPoints(d) : [];
    if (pts.some((p) => p.utr5 || p.utr3)) {
      issues.push("UTR（c.- や c.* の位置）は検査の対象外です。対象はたんぱく質コード領域のエクソンと、イントロン側 10 塩基以内です");
    }
    const deep = Math.max(0, ...pts.map((p) => Math.abs(p.offset)));
    if (deep > CANCER60_INTRON_LIMIT) {
      issues.push(`エクソン境界からイントロン側へ ${deep} 塩基の位置です。検査の対象はイントロン側 ${CANCER60_INTRON_LIMIT} 塩基以内です`);
    }
    if (size !== undefined && size > CANCER60_INDEL_LIMIT) {
      issues.push(`${size} 塩基の欠失・挿入です。検査の対象は ${CANCER60_INDEL_LIMIT} 塩基以内です`);
    }
  } else {
    if (cancer60) {
      issues.push(`${c.gene} はがん関連60遺伝子です。がん関連遺伝子のシングルサイト解析の依頼書をご利用ください`);
    }
    if (size !== undefined) {
      issues.push("欠失・挿入の変異です。大きな欠失・挿入は別途かずさ遺伝子検査室に相談するよう、依頼書に記載されています");
    }
  }
  return { cancer60, issues };
}

/** Candidates of the chosen request type first, keeping the original order otherwise. */
export function modeRank(c: ResultCandidate, mode: KazusaMode | undefined): number {
  if (mode !== "cancer60") return 0;
  return isCancer60(c.gene) ? 0 : 1;
}

export interface SangerLine {
  text: string;
  /** items the user still has to fill in by hand */
  missing: string[];
}

/** One line for the Sanger request form, e.g. "CYBB chrX:37783542 NM_000397.4 c.194T>G p.Met65Arg". */
export function sangerLine(c: ResultCandidate): SangerLine | undefined {
  if (!c.transcript || !c.gene) return undefined;
  const missing: string[] = [];
  const d = cPart(c);
  if (!d) missing.push("c. 表記");
  else if (/\d$/.test(d)) missing.push("c. 表記の配列の変化");
  const p = c.hgvsP?.slice(c.hgvsP.indexOf(":") + 1);
  const locus = c.start === c.end ? `${c.chrom}:${c.start}` : `${c.chrom}:${c.start}-${c.end}`;
  const text = [c.gene, locus, c.transcript, d, p].filter(Boolean).join(" ");
  return { text, missing };
}

/** What goes into the request form for this candidate. */
export function requestText(c: ResultCandidate, mode: KazusaMode): string {
  if (mode === "sanger") return sangerLine(c)?.text ?? "";
  if (!c.gene) return "";
  return c.start === c.end ? `${c.gene} ${nine(c.start)}` : `${c.gene} ${nine(c.start)}-${nine(c.end)}`;
}
