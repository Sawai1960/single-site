import type { Assembly, CPos, ParsedQuery, QueryTarget, VarType } from "./types";
import { AA3_TO_1, normalizeAA } from "./codon";
import { ncToChrom } from "./chrom";

export class ParseError extends Error {}

const CPOS_RE = String.raw`[-*]?\d+(?:[+-]\d+)?`;

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

function parseCPos(s: string): CPos {
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

export function parseQuery(raw: string): ParsedQuery {
  const s = normalizeInput(raw);
  if (!s) throw new ParseError("入力が空です");

  // NC_000004.12:g.55106686G>A
  let m = s.match(/^(NC_\d+\.\d+)\s*:\s*g\.(\d+)(?:_(\d+))?(.*)$/i);
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
  throw new ParseError("入力形式を判別できません。下の「対応している入力形式」を参照してください");
}
