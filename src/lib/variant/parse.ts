import type { Assembly, CPos, ParsedQuery, QueryTarget, VarType } from "./types";
import { AA3_TO_1, normalizeAA } from "./codon";
import { ncToChrom } from "./chrom";

export class ParseError extends Error {}

const CPOS_RE = String.raw`[-*]?\d+(?:[+-]\d+)?`;
const MITO_LENGTH = 16569;

export function normalizeInput(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, "-")
    .replace(/[\u2192\u21D2]/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAssembly(s: string | undefined): Assembly | undefined {
  if (!s) return undefined;
  const v = s.toLowerCase();
  if (v === "hg38" || v === "grch38") return "hg38";
  if (v === "hg19" || v === "grch37") return "hg19";
  return undefined;
}

function chromName(s: string): string {
  const c = s.replace(/^chr/i, "").toUpperCase();
  if (c === "MT") return "chrM";
  return `chr${c}`;
}

export function parseCPos(s: string): CPos {
  const m = s.match(/^([-*]?)(\d+)(?:([+-])(\d+))?$/);
  if (!m) throw new ParseError(`c. の位置表記を解釈できません: ${s}`);
  const n = Number(m[2]);
  const offset = m[3] ? (m[3] === "+" ? 1 : -1) * Number(m[4]) : 0;
  if (m[1] === "*") return { base: n, utr3: true, offset };
  if (m[1] === "-") return { base: -n, utr3: false, offset };
  if (n === 0) throw new ParseError("c.0 という位置は存在しません");
  return { base: n, utr3: false, offset };
}

function classifyChange(change: string): {
  varType: VarType;
  refAllele?: string;
  altAllele?: string;
} {
  const c = change.toUpperCase();
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^([ACGTU]+)>([ACGTU]+)$/)))
    return { varType: "substitution", refAllele: m[1].replace(/U/g, "T"), altAllele: m[2].replace(/U/g, "T") };
  if ((m = c.match(/^DEL([ACGT]*)INS([ACGT]+|\d+)?$/)))
    return { varType: "delins", refAllele: m[1] || undefined, altAllele: m[2] };
  if ((m = c.match(/^DEL([ACGT]+|\d+)?$/)))
    return { varType: "deletion", refAllele: m[1] && /^[ACGT]+$/.test(m[1]) ? m[1] : undefined };
  if ((m = c.match(/^DUP([ACGT]+|\d+)?$/)))
    return { varType: "duplication", refAllele: m[1] && /^[ACGT]+$/.test(m[1]) ? m[1] : undefined };
  if ((m = c.match(/^INS([ACGT]+|\d+)?$/))) return { varType: "insertion", altAllele: m[1] };
  if (c.startsWith("INV")) return { varType: "inversion" };
  if (c === "=" || /^[ACGT]=$/.test(c)) return { varType: "identity", refAllele: c.length === 2 ? c[0] : undefined };
  if (c === "") return { varType: "position" };
  throw new ParseError(`変異の種類を解釈できません: ${change}`);
}

function parseTarget(id: string, paren?: string): QueryTarget {
  const acc = id.toUpperCase();
  if (/^N[MR]_\d+(\.\d+)?$/.test(acc)) return { type: "transcript", acc, gene: paren };
  if (/^NP_\d+(\.\d+)?$/.test(acc)) return { type: "protein", acc, gene: paren };
  if (/^(XM|XP|XR)_\d+/.test(acc))
    throw new ParseError("予測 RefSeq（XM_/XP_）には対応していません。NM_/NP_ 番号か遺伝子名を指定してください");
  if (/^ENS[TPG]\d+/.test(acc))
    throw new ParseError("Ensembl ID（ENST/ENSP）には対応していません。NM_/NP_ 番号か遺伝子名を指定してください");
  if (/^N[CG]_/.test(acc)) throw new ParseError("NC_/NG_ 番号の c./p. 表記には対応していません");
  if (/^[A-Za-z0-9][A-Za-z0-9\-.@]*$/.test(id)) return { type: "gene", symbol: acc };
  throw new ParseError(`遺伝子名または RefSeq 番号を解釈できません: ${id}`);
}

const AA_TOKEN = String.raw`(?:[A-Z][a-z]{2}|[A-Z*])`;

function parseProtein(rest: string, target: QueryTarget): ParsedQuery {
  let r = rest.trim();
  if (r.startsWith("(") && r.endsWith(")")) r = r.slice(1, -1);
  const m = r.match(new RegExp(String.raw`^(${AA_TOKEN})?(\d+)(?:_(${AA_TOKEN})?(\d+))?(.*)$`));
  if (!m) throw new ParseError(`p. 表記を解釈できません: p.${rest}`);
  const aa1 = m[1] ? normalizeAA(m[1]) : undefined;
  const aa2 = m[3] ? normalizeAA(m[3]) : undefined;
  if (m[1] && !aa1) throw new ParseError(`アミノ酸記号を解釈できません: ${m[1]}`);
  if (m[3] && !aa2) throw new ParseError(`アミノ酸記号を解釈できません: ${m[3]}`);
  const pos1 = Number(m[2]);
  const pos2 = m[4] ? Number(m[4]) : undefined;
  if (pos1 < 1) throw new ParseError("アミノ酸位置は 1 以上で指定してください");
  if (pos2 !== undefined && pos2 < pos1) throw new ParseError("アミノ酸範囲の終了位置が開始位置より前です");
  const change = m[5].trim();
  const frameshift = /fs/i.test(change);
  let altAA: string | undefined;
  if (!/^(fs|del|dup|ins|ext|=|\?)/i.test(change) && change) {
    const t3 = change.match(/^([A-Z][a-z]{2})/);
    if (t3 && AA3_TO_1[t3[1]]) altAA = AA3_TO_1[t3[1]];
    else {
      const t1 = change.match(/^([A-Z*])/);
      if (t1) altAA = normalizeAA(t1[1]);
    }
  }
  return { kind: "protein", target, aa1, pos1, aa2, pos2, change, altAA, frameshift };
}

const BARE_CDNA_RE = new RegExp(String.raw`^(${CPOS_RE}(?:_${CPOS_RE})?)((?:del|dup|ins|inv)[A-Za-z0-9]*|[ACGT]>[ACGT])$`, "i");
const AA = String.raw`(?:[A-Z][a-z]{2}|[A-Z*])`;
const BARE_PROTEIN_RE = new RegExp(
  String.raw`^${AA}\d+(?:_${AA}\d+)?(?:${AA}(?:fs(?:\*|Ter)?\d*)?|fs(?:\*|Ter)?\d*|delins[A-Za-z*]+|del|dup|ins[A-Za-z*]+|=|\?)$`,
);
const NOT_GENE = /^(exon|intron|splice|site|c|p)$/i;
const NOT_SINGLE_SITE =
  /\b(amplification|amplified|amp|loss|homozygous|deletion|deleted|duplication|fusion|rearrangement|rearranged|truncation|copy number|cnv)\b/i;

/** Drops a trailing allele fraction copied with the variant, e.g. "(VAF 45%)" or "45%". */
function stripAlleleFraction(s: string): string {
  return s.replace(/\s*[(（]?\s*(?:VAF|MAF|AF)?\s*[:=]?\s*\d+(?:\.\d+)?\s*[%％]\s*[)）]?\s*$/i, "");
}

function looksLikeVariant(part: string): boolean {
  return part
    .split(/[\s()]+/)
    .some((t) => BARE_CDNA_RE.test(t) || BARE_PROTEIN_RE.test(t) || /^[cpgm]\.\S/i.test(t));
}

/**
 * FoundationOne-style shorthand without "c." / "p.": "MET exon 14 splice site (2888-14_2888-4del11)" →
 * "MET c.2888-14_2888-4del11", "SOX9 E75K" → "SOX9 p.E75K". Undefined when the input is not of that form.
 * Genes with a legacy cDNA numbering (BIC, CFTR legacy names) are checked against it in convertOne.
 */
export function expandShorthand(raw: string): string | undefined {
  const s = normalizeInput(stripAlleleFraction(normalizeInput(raw)));
  const variants = s.split(/[,;、]/).filter(looksLikeVariant);
  const cWithP = variants.length === 2 && /\bc\s*\./i.test(variants[0]) && /^\s*p\s*\./i.test(variants[1]);
  if (variants.length > 1 && !cWithP) {
    throw new ParseError("1 行に複数の変異が書かれています。1 行に 1 件ずつ、改行して入力してください");
  }
  if (/\b[cpgm]\s*\./i.test(s)) return undefined;
  const paren = s.match(/\(([^()]+)\)\s*$/);
  const tokens = (paren ? s.slice(0, paren.index) : s).trim().split(" ").filter(Boolean);
  const variant = paren ? paren[1].replace(/\s/g, "") : tokens.pop();
  const type = !variant ? undefined : BARE_CDNA_RE.test(variant) ? "c" : BARE_PROTEIN_RE.test(variant) ? "p" : undefined;
  if (!type) return undefined;
  const gene = tokens[0];
  if (!gene || NOT_GENE.test(gene) || /^\d/.test(gene)) {
    throw new ParseError(`遺伝子名がないため変換できません。報告書の遺伝子名を先頭に付けて「遺伝子名 ${type}.${variant}」の形で入力してください`);
  }
  const multiDel = type === "c" ? variant!.match(/^(\d+)del([ACGT]{2,})$/i) : null;
  if (multiDel) {
    const from = Number(multiDel[1]);
    return `${gene} c.${from}_${from + multiDel[2].length - 1}del${multiDel[2]}`;
  }
  return `${gene} ${type}.${variant}`;
}

/**
 * A c. notation followed by a remark copied from the report: "c.68_69delAG (p.Glu23Valfs*17)",
 * "c.68_69delAG (185delAG)", "c.68_69delAG, p.Glu23Valfs*17". Undefined when there is none.
 */
export function splitTrailingRemark(raw: string): { main: string; remark: string } | undefined {
  const s = normalizeInput(stripAlleleFraction(normalizeInput(raw)));
  const m = s.match(/^(.*\bc\s*\.\s*[^\s(),;]+)\s*(?:\(([^()]*)\)|[,;]\s*(p\s*\.\s*\S+))\s*$/i);
  if (!m) return undefined;
  return { main: m[1], remark: (m[2] ?? m[3]).trim() };
}

const REPORT_CDNA = /^(?:(N[MR]_\d+(?:\.\d+)?):)?(c\.\S+)$/i;
const REPORT_NM = /^N[MR]_\d+(?:\.\d+)?$/i;
const REPORT_CHR = /^chr([0-9]{1,2}|X|Y|M|MT):(\d[\d,]*)$/i;
const REPORT_ALLELES = /^([ACGT]+)\/([ACGT]+)$/i;
const REPORT_NOT_GENE = /^(hetero|homo|hemi)(zygous)?$|^(exon|intron)\d*$/i;

/**
 * A row copied from a Kazusa-style report, e.g. "1 BRCA2 NM_000059.4 heterozygous stop_gained c.6768T>A
 * p.Cys2256Ter chr13:32341123 T/A", "BRCA2 exon11 c.6768T>A" or "chr13:32341123 T/A", rewritten as one
 * notation the parser reads. Undefined when the input is already in such a form.
 */
export function readReportLine(raw: string): { line: string; dropped: string[] } | undefined {
  const tokens = normalizeInput(raw)
    .split(" ")
    .map((t) => t.replace(/^[,;]+|[,;:]+$/g, ""))
    .filter(Boolean);
  const cIdx = tokens.flatMap((t, i) => (REPORT_CDNA.test(t) ? [i] : []));
  if (cIdx.length > 1) return undefined;
  const used = new Set<number>();
  let line: string;
  if (cIdx.length === 1) {
    const [, nmInline, c] = tokens[cIdx[0]].match(REPORT_CDNA)!;
    used.add(cIdx[0]);
    const nmIdx = nmInline ? -1 : tokens.findIndex((t) => REPORT_NM.test(t));
    if (nmIdx >= 0) used.add(nmIdx);
    const nm = nmInline ?? (nmIdx >= 0 ? tokens[nmIdx] : undefined);
    const geneIdx = tokens.findIndex(
      (t, i) => i < cIdx[0] && !used.has(i) && /^[A-Z][A-Za-z0-9-]+$/.test(t) && !REPORT_NOT_GENE.test(t),
    );
    if (geneIdx >= 0) used.add(geneIdx);
    const gene = geneIdx >= 0 ? tokens[geneIdx] : undefined;
    if (!nm && !gene) return undefined;
    line = `${nm ? (gene ? `${nm.toUpperCase()}(${gene})` : nm.toUpperCase()) : gene}:${c}`;
  } else {
    const chrIdx = tokens.findIndex((t) => REPORT_CHR.test(t));
    const alIdx = tokens.findIndex((t) => REPORT_ALLELES.test(t));
    if (chrIdx < 0 || alIdx < 0) return undefined;
    used.add(chrIdx).add(alIdx);
    const [, ref, alt] = tokens[alIdx].match(REPORT_ALLELES)!;
    line = `${tokens[chrIdx]}${ref.length === 1 && alt.length === 1 ? `${ref.toUpperCase()}>${alt.toUpperCase()}` : ""}`;
  }
  const dropped = tokens.filter((_, i) => !used.has(i));
  const standard = cIdx.length === 1 && used.size < 3 && dropped.every((t) => /^\(.*\)$/.test(t));
  return standard ? undefined : { line, dropped };
}

export function parseQuery(raw: string): ParsedQuery {
  const report = readReportLine(raw);
  if (report) return parseQuery(report.line);
  const expanded = expandShorthand(raw);
  if (expanded) return parseQuery(expanded);
  const remark = splitTrailingRemark(raw);
  if (remark) return parseQuery(remark.main);
  const s = normalizeInput(stripAlleleFraction(normalizeInput(raw)));
  if (!s) throw new ParseError("入力が空です");

  // m.3243A>G, NC_012920.1:m.3243A>G, MT-TL1:m.3243A>G
  let m = s.match(/^(?:([A-Za-z0-9_.\-]+)\s*(?:\(([^)]+)\))?\s*[:,;\s]\s*)?m\.\s*(\d+)(?:_(\d+))?(.*)$/i);
  if (m) {
    const prefix = m[1];
    let label: string | undefined = m[2]?.trim();
    if (prefix && !/^(NC_012920(\.1)?|chrM|chrMT|M|MT|rCRS)$/i.test(prefix)) {
      if (/^NC_001807/i.test(prefix)) {
        throw new ParseError("NC_001807（UCSC hg19 の chrM）の m. 表記には対応していません。rCRS（NC_012920.1）の番号で入力してください");
      }
      if (/^(N[CGMRP]_|X[MPR]_|ENS)/i.test(prefix)) {
        throw new ParseError("m. 表記はミトコンドリア DNA（NC_012920.1）にのみ使えます");
      }
      if (/^(hg19|hg38|grch37|grch38)$/i.test(prefix)) label = undefined;
      else label = prefix;
    }
    const start = Number(m[3]);
    const end = m[4] ? Number(m[4]) : start;
    if (!start) throw new ParseError("m. の位置は 1 以上で指定してください");
    if (end < start) throw new ParseError("終了位置が開始位置より前です");
    if (end > MITO_LENGTH) throw new ParseError(`ミトコンドリア DNA（rCRS）は ${MITO_LENGTH.toLocaleString("en-US")} 塩基です。位置を確認してください`);
    return {
      kind: "genomic",
      assembly: "hg38",
      assemblyGiven: true,
      chrom: "chrM",
      start,
      end,
      change: m[5].replace(/\s/g, "").toUpperCase(),
      mito: { label },
    };
  }

  // NC_000004.12:g.55106686G>A
  m = s.match(/^(NC_\d+\.\d+)\s*:\s*g\.(\d+)(?:_(\d+))?(.*)$/i);
  if (m) {
    const nc = ncToChrom(m[1].toUpperCase());
    if (!nc) throw new ParseError(`対応していない NC_ 番号です: ${m[1]}`);
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    return { kind: "genomic", assembly: nc.assembly, assemblyGiven: true, chrom: nc.chrom, start, end, change: m[4].trim() };
  }

  // hg38, chr1:195507262 / GRCh37 chr4:55,000,000-55,000,010 / chr1:195507262 (hg38)
  m = s.match(
    /^(?:(hg38|hg19|grch38|grch37)\s*[,:;]?\s*)?(?:chr)?([0-9]{1,2}|X|Y|M|MT)\s*:\s*(?:g\.)?([\d,]+)(?:\s*[-_]\s*([\d,]+))?\s*([ACGTacgt]*\s*>?\s*[ACGTacgt]*)?\s*(?:[(,\s]\s*(hg38|hg19|grch38|grch37)\)?)?$/i,
  );
  if (m && (m[1] || /^chr/i.test(s) || m[6])) {
    const asmGiven = parseAssembly(m[1]) ?? parseAssembly(m[6]);
    const chrom = chromName(m[2]);
    const start = Number(m[3].replace(/,/g, ""));
    const end = m[4] ? Number(m[4].replace(/,/g, "")) : start;
    if (!start) throw new ParseError("ゲノム位置は 1 以上で指定してください");
    if (end < start) throw new ParseError("終了位置が開始位置より前です");
    const n = Number(chrom.slice(3));
    if (!Number.isNaN(n) && (n < 1 || n > 22)) throw new ParseError(`染色体番号が不正です: ${m[2]}`);
    return {
      kind: "genomic",
      assembly: asmGiven ?? "hg38",
      assemblyGiven: Boolean(asmGiven),
      chrom,
      start,
      end,
      change: (m[5] ?? "").replace(/\s/g, "").toUpperCase(),
    };
  }

  // NM_002253.2:c.889G>A, NM_002253.2(KDR):c.889G>A, NM_002253.2, c.889G>A, KDR c.889G>A
  m = s.match(/^([A-Za-z0-9_.\-@]+?)\s*(?:\(([^)]+)\))?\s*[:,;\s]\s*([cpCP])\s*\.\s*(.+)$/);
  if (m) {
    const target = parseTarget(m[1], m[2]?.trim());
    const type = m[3].toLowerCase();
    const rest = m[4].replace(/\s/g, "");
    if (type === "p") {
      if (target.type === "transcript")
        throw new ParseError("p. 表記には NP_ 番号か遺伝子名を指定してください（NM_ 番号の場合は c. 表記）");
      return parseProtein(rest, target);
    }
    if (target.type === "protein") throw new ParseError("c. 表記には NM_ 番号か遺伝子名を指定してください");
    const cm = rest.match(new RegExp(`^(${CPOS_RE})(?:_(${CPOS_RE}))?(.*)$`));
    if (!cm) throw new ParseError(`c. 表記を解釈できません: c.${rest}`);
    const start = parseCPos(cm[1]);
    const end = cm[2] ? parseCPos(cm[2]) : start;
    const change = cm[3];
    const cls = classifyChange(change);
    return { kind: "cdna", target, start, end, change, ...cls };
  }

  if (/^[cp]\./i.test(s))
    throw new ParseError("遺伝子名または NM_/NP_ 番号を先頭に付けてください（例: KDR:c.889G>A）");
  if (NOT_SINGLE_SITE.test(s))
    throw new ParseError(
      "増幅・欠失（loss）・融合遺伝子・再構成など、位置を 1 点に指定できない変化は、シングルサイト検査の対象外です。c. 表記や p. 表記のある変異を入力してください",
    );
  throw new ParseError("入力形式を判別できません。下の「対応している入力形式」を参照してください");
}
