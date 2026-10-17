/*
 * Fills the variant fields of a Kazusa request form (.xlsx) the user selects. Only the cells of the
 * variant section are rewritten in the sheet XML, so check boxes, validation lists, formulas and the
 * institution details already entered stay as they are.
 *   がん関連遺伝子のシングルサイト解析依頼書 2025 v2.1 (and its 再解析 version): 4 sites,
 *     gene name in B7/B9/B11/B13, the 9-digit position one digit per cell in B:J of the row below
 *   Sanger 検査依頼書 2023 v1.2: 5 sites, one line each in B11:B15
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { isCancer60, modeRank, requestText, sangerLine, type KazusaMode } from "./kazusa";
import { genomeToC } from "./mapping";
import { accBase, accVersion, ensureAccessions, getIndex } from "./refseq";
import type { ConversionResult, ResultCandidate } from "./types";

export type FormKind = "cancer" | "cancer-re" | "sanger";

export const FORM_LABEL: Record<FormKind, string> = {
  cancer: "がん関連遺伝子のシングルサイト解析依頼書",
  "cancer-re": "がん関連遺伝子のシングルサイト再解析依頼書",
  sanger: "Sanger 検査依頼書",
};

export const FORM_MODE: Record<FormKind, KazusaMode> = { cancer: "cancer60", "cancer-re": "cancer60", sanger: "sanger" };

const MAIN_SHEET = "医療機関情報";
const CANCER_ROWS = [7, 9, 11, 13];
const DIGIT_COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J"];
const SANGER_ROWS = [11, 12, 13, 14, 15];
/** Sample ID and institution / billing details, copied from the first form into 再解析 forms. */
const SHARED_CELLS = ["B6", "B18", "B19", "B20", "B21", "B22", "B23", "B30", "B31", "B32", "B33", "B34", "B35"];

export const FORM_CAPACITY: Record<FormKind, number> = { cancer: 4, "cancer-re": 4, sanger: 5 };

export class FormError extends Error {}

export interface RequestForm {
  kind: FormKind;
  files: Record<string, Uint8Array>;
  sheetPath: string;
  strings: string[];
  /** gene names the form's own list accepts, with the NM_ it shows for each; null when the list could not be read */
  genes: Map<string, { transcript: string }> | null;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text of a <si>/<is> element, leaving out the phonetic (furigana) runs. */
const richText = (xml: string) =>
  [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

const cellPattern = (ref: string) => new RegExp(`<c r="${ref}"(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);

interface CellValue {
  text: string;
  numeric: boolean;
}

function readCell(sheet: string, strings: string[], ref: string): CellValue {
  const m = sheet.match(cellPattern(ref));
  if (!m) return { text: "", numeric: false };
  const [, attrs, inner = ""] = m;
  const type = attrs.match(/\st="([^"]+)"/)?.[1];
  if (type === "inlineStr") return { text: richText(inner), numeric: false };
  const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v === undefined) return { text: "", numeric: false };
  if (type === "s") return { text: strings[Number(v)] ?? "", numeric: false };
  return { text: decode(v), numeric: !type || type === "n" };
}

function colIndex(col: string): number {
  return [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function writeCell(sheet: string, ref: string, value: string | number | null): string {
  const attrsOf = (a: string) => a.replace(/\s(t|cm|vm)="[^"]*"/g, "");
  const xml = (attrs: string) =>
    value === null || value === ""
      ? `<c r="${ref}"${attrs}/>`
      : typeof value === "number"
        ? `<c r="${ref}"${attrs}><v>${value}</v></c>`
        : `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${encode(value)}</t></is></c>`;
  const re = cellPattern(ref);
  const m = sheet.match(re);
  if (m) return sheet.replace(re, () => xml(attrsOf(m[1])));
  if (value === null || value === "") return sheet;

  const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/)!;
  const rowRe = new RegExp(`<row r="${row}"(?=[\\s>/])([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const rm = sheet.match(rowRe);
  if (!rm) throw new FormError("依頼書の様式が想定と違うため記入できません（記入欄の行が見つかりません）");
  const cells = rm[3] ?? "";
  const after = [...cells.matchAll(/<c r="([A-Z]+)\d+"/g)].find((c) => colIndex(c[1]) > colIndex(col));
  const cell = xml("");
  const body = after ? cells.slice(0, after.index) + cell + cells.slice(after.index) : cells + cell;
  return sheet.replace(rowRe, () => `<row r="${row}"${rm[1]}>${body}</row>`);
}

function sheetPathByName(files: Record<string, Uint8Array>, name: string): string | undefined {
  const wb = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!wb || !rels) return undefined;
  const sheet = [...strFromU8(wb).matchAll(/<sheet\s[^>]*>/g)]
    .map((m) => m[0])
    .find((tag) => decode(tag.match(/name="([^"]*)"/)?.[1] ?? "") === name);
  const id = sheet?.match(/r:id="([^"]+)"/)?.[1];
  if (!id) return undefined;
  const rel = [...strFromU8(rels).matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes(`Id="${id}"`));
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  if (!target) return undefined;
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/** The hidden "secret" sheet the form's own VLOOKUPs read: gene (E), NM_ (F), chromosome (G). */
function formGenes(files: Record<string, Uint8Array>, strings: string[]): RequestForm["genes"] {
  const path = sheetPathByName(files, "secret");
  const xml = path && files[path] ? strFromU8(files[path]) : undefined;
  if (!xml) return null;
  const genes: NonNullable<RequestForm["genes"]> = new Map();
  for (let r = 2; r <= 200; r++) {
    const g = readCell(xml, strings, `E${r}`).text.trim();
    if (/^[A-Z][A-Z0-9-]*$/.test(g)) genes.set(g, { transcript: readCell(xml, strings, `F${r}`).text.trim() });
  }
  return genes.size ? genes : null;
}

export function readForm(bytes: Uint8Array): RequestForm {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new FormError("Excel（.xlsx）ファイルとして読み込めませんでした。古い形式（.xls）の場合は .xlsx で保存し直してください");
  }
  const sheetPath = sheetPathByName(files, MAIN_SHEET);
  if (!sheetPath || !files[sheetPath]) throw new FormError("かずさ遺伝子検査室の検査依頼書ではないようです（「医療機関情報」のシートがありません）");
  const ss = files["xl/sharedStrings.xml"];
  const strings = ss ? [...strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1])) : [];
  const sheet = strFromU8(files[sheetPath]);
  const text = (ref: string) => readCell(sheet, strings, ref).text;

  let kind: FormKind | undefined;
  if (text("A3").startsWith("がん関連遺伝子のシングルサイト解析依頼書")) {
    const layout =
      CANCER_ROWS.every((r, i) => text(`A${r}`).startsWith(`遺伝子名${i + 1}箇所目`)) &&
      CANCER_ROWS.every((r, i) => text(`A${r + 1}`).startsWith(`position(hg38)${i + 1}箇所目`));
    if (!layout) throw new FormError("がん関連遺伝子の依頼書ですが、様式が想定（2025 v2.1）と違うため記入できません。かずさ遺伝子検査室のサイトで最新の依頼書を確認してください");
    kind = text("A3").includes("（再）") || text("A6").startsWith("元の検体") ? "cancer-re" : "cancer";
  } else if (text("B3").startsWith("Sanger法による単一エクソン解析検査依頼書")) {
    const layout = text("B10").startsWith("解析箇所") && SANGER_ROWS.every((r, i) => text(`A${r}`) === String(i + 1));
    if (!layout) throw new FormError("Sanger の依頼書ですが、様式が想定（2023 v1.2）と違うため記入できません。かずさ遺伝子検査室のサイトで最新の依頼書を確認してください");
    kind = "sanger";
  }
  if (!kind) throw new FormError("かずさ遺伝子検査室のがん関連遺伝子シングルサイト解析依頼書、または Sanger 検査依頼書ではないようです");
  return { kind, files, sheetPath, strings, genes: kind === "sanger" ? null : formGenes(files, strings) };
}

function variantCells(kind: FormKind): string[] {
  if (kind === "sanger") return SANGER_ROWS.map((r) => `B${r}`);
  return CANCER_ROWS.flatMap((r) => [`B${r}`, `C${r}`, ...DIGIT_COLS.map((c) => `${c}${r + 1}`)]);
}

/** Variant cells that already hold something. */
export function filledVariantCells(form: RequestForm): string[] {
  const sheet = strFromU8(form.files[form.sheetPath]);
  return variantCells(form.kind).filter((ref) => readCell(sheet, form.strings, ref).text.trim() !== "");
}

export interface FormEntry {
  input: string;
  gene: string;
  /** hg38 position written as 9 digits on the cancer forms */
  pos: number;
  /** line written on the Sanger form */
  text: string;
}

/**
 * Writes `entries` (at most the form's capacity) into a copy of `form`. For a 再解析 form, the sample ID
 * and institution details still empty are taken from `copyFrom`.
 */
export function fillForm(form: RequestForm, entries: FormEntry[], copyFrom?: RequestForm): Uint8Array {
  if (entries.length > FORM_CAPACITY[form.kind]) throw new Error("too many entries for the form");
  let sheet = strFromU8(form.files[form.sheetPath]);
  for (const ref of variantCells(form.kind)) sheet = writeCell(sheet, ref, null);

  if (form.kind === "sanger") {
    entries.forEach((e, i) => (sheet = writeCell(sheet, `B${SANGER_ROWS[i]}`, e.text)));
  } else {
    entries.forEach((e, i) => {
      const r = CANCER_ROWS[i];
      sheet = writeCell(sheet, `B${r}`, e.gene);
      String(e.pos)
        .padStart(9, "0")
        .split("")
        .forEach((d, j) => (sheet = writeCell(sheet, `${DIGIT_COLS[j]}${r + 1}`, Number(d))));
    });
  }

  if (copyFrom && copyFrom !== form) {
    const src = strFromU8(copyFrom.files[copyFrom.sheetPath]);
    for (const ref of SHARED_CELLS) {
      if (readCell(sheet, form.strings, ref).text.trim()) continue;
      const v = readCell(src, copyFrom.strings, ref);
      if (!v.text.trim()) continue;
      sheet = writeCell(sheet, ref, v.numeric && /^\d+(\.\d+)?$/.test(v.text) ? Number(v.text) : v.text);
    }
  }

  let wb = strFromU8(form.files["xl/workbook.xml"]);
  // Excel recalculates the gene → NM number lookups and the required-field check on opening.
  if (/<calcPr\b/.test(wb)) {
    wb = wb.replace(/<calcPr\b([^>]*?)(\/?)>/, (_, a: string, close: string) =>
      `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${close}>`,
    );
  } else {
    wb = wb.replace(/(<\/definedNames>|<\/sheets>)(?![\s\S]*(<\/definedNames>|<\/sheets>))/, '$1<calcPr fullCalcOnLoad="1"/>');
  }

  return zipSync({ ...form.files, [form.sheetPath]: strToU8(sheet), "xl/workbook.xml": strToU8(wb) }, { level: 6 });
}

export interface PlannedEntry extends FormEntry {
  /** reasons to look again before sending: 要確認, external mismatch, things to add by hand */
  review: string[];
  notes: string[];
  /** position of the source result in the list passed to planEntries */
  index: number;
  /** NM_ the position was computed on */
  transcript: string;
  point: RequestPoint;
  /** neutral remarks that need no action */
  info?: string[];
  /** must be settled with Kazusa before sending */
  alerts?: string[];
}

export interface RequestPoint {
  chrom: string;
  /** the single base to ask for */
  pos: number;
  /** set when the variant spans more than one base; protein: codon range from p. input */
  span?: { start: number; end: number; codon: boolean; protein: boolean };
}

/** The single position used for a request: the middle base of a codon from p. input, otherwise the first base. */
export function requestPoint(c: ResultCandidate): RequestPoint {
  if (c.end === c.start) return { chrom: c.chrom, pos: c.start };
  const protein = !c.hgvsC || c.hgvsC.includes("（");
  const codon = protein && c.end - c.start === 2;
  return { chrom: c.chrom, pos: codon ? c.start + 1 : c.start, span: { start: c.start, end: c.end, codon, protein } };
}

export function spanText(p: RequestPoint): string {
  if (!p.span) return "";
  return `${p.span.codon ? "コドン 3 塩基" : "範囲"}: ${p.chrom}:${p.span.start}-${p.span.end}`;
}

/** Why a position not written into the form is the one shown, for p. input. */
export function pointNote(p: RequestPoint): string {
  if (!p.span?.protein) return "";
  const at = `${p.chrom}:${p.span.start}-${p.span.end}`;
  return `${p.span.codon ? `p. 表記の入力のため、コドン 3 塩基（${at}）の中央` : `p. 表記の範囲（${at}）の先頭`}を示しています。1 塩基を指定するには、c. 表記がわかればそちらで入力してください`;
}

export interface EntryPlan {
  entries: PlannedEntry[];
  skipped: { input: string; reason: string; index: number }[];
}

/**
 * One request entry per result, from the candidate shown first on its card. Results whose candidates
 * lead to different request entries are left out rather than guessed.
 */
export function planEntries(
  results: ConversionResult[],
  mode: KazusaMode,
  review: { warning: boolean; mismatch: boolean; unverified?: boolean }[],
): EntryPlan {
  const plan: EntryPlan = { entries: [], skipped: [] };
  results.forEach((r, i) => {
    const skip = (reason: string) => plan.skipped.push({ input: r.input, reason, index: i });
    if (r.status === "error") return skip("変換できなかったため記入しません");
    const ok = r.candidates.filter((c) => !c.refCheck || c.refCheck.ok);
    let pool = (ok.length ? ok : r.candidates).filter((c) => c.chrom !== "chrM" && c.gene);
    if (mode === "cancer60") pool = pool.filter((c) => isCancer60(c.gene));
    pool = [...pool].sort((a, b) => modeRank(a, mode) - modeRank(b, mode));
    if (!pool.length) {
      return skip(
        mode === "cancer60"
          ? "がん関連遺伝子のシングルサイト解析の対象（60 遺伝子）に含まれないため記入しません"
          : "遺伝子に重ならない位置のため記入しません",
      );
    }

    let c: ResultCandidate;
    if (r.format === 1) {
      if (new Set(pool.map((x) => x.gene)).size > 1) {
        return skip(`複数の遺伝子（${[...new Set(pool.map((x) => x.gene))].join("・")}）に重なる位置のため記入しません。依頼書に手で記入してください`);
      }
      c = pool.find((x) => x.mane) ?? pool[0];
    } else {
      if (new Set(pool.map((x) => requestText(x, mode))).size > 1) {
        return skip("候補が複数あり、依頼書に書く位置が 1 つに決まらないため記入しません。NM 番号付きの c. 表記で入力し直してください");
      }
      c = pool[0];
    }

    const flags: string[] = [];
    if (review[i]?.mismatch) flags.push("外部データベースと不一致");
    else if (review[i]?.warning) flags.push("要確認");
    if (review[i]?.unverified) flags.push("外部照合が済んでいない");
    const notes: string[] = [];
    let text = "";
    const point = requestPoint(c);
    const pos = point.pos;
    if (mode === "sanger") {
      const line = sangerLine(c);
      if (!line) return skip("依頼書に書く内容を作れないため記入しません");
      text = line.text;
      if (line.missing.length) flags.push(`${line.missing.join("・")}を手で追記`);
    } else if (point.span?.codon) {
      notes.push(
        `p. 表記の入力のため、コドン 3 塩基（${c.chrom}:${c.start}-${c.end}）の中央を記入しました。報告範囲（前後 2 塩基）にコドン全体が入りますが、c. 表記がわかればそちらで入力してください`,
      );
    } else if (c.end > c.start) {
      notes.push(`範囲の先頭（${c.chrom}:${c.start}）を記入しました。特記事項欄に欠失・挿入の内容を記入してください`);
    }
    const dup = plan.entries.find((e) => (mode === "sanger" ? e.text === text : e.gene === c.gene && e.pos === pos));
    if (dup) return skip(`「${dup.input}」と同じ位置のため、重ねて記入しません`);
    plan.entries.push({ input: r.input, gene: c.gene, pos, text, review: flags, notes, index: i, transcript: c.transcript, point });
  });
  return plan;
}

/** Inside the cancer test's target: coding exons and up to 10 intronic bases from them. */
function inCodingTarget(c: string): boolean {
  const m = c.match(/^c\.(\d+)([+-]\d+)?$/);
  return Boolean(m) && Math.abs(Number(m![2] ?? 0)) <= 10;
}

/**
 * Compares each entry with the NM_ the form itself shows for its gene. The position written is the
 * same either way, but Kazusa reports c. on its own NM_, and a base inside the target on one
 * transcript can fall outside it on another.
 */
export async function checkFormTranscripts(
  entries: PlannedEntry[],
  genes: RequestForm["genes"],
): Promise<{ note: string; review: boolean }[]> {
  const idx = await getIndex();
  const formAccs = entries.map((e) => genes?.get(e.gene)?.transcript ?? "");
  await ensureAccessions(idx, formAccs.filter(Boolean));
  return entries.map((e, i) => {
    const formAcc = formAccs[i];
    if (!formAcc || accBase(formAcc) === accBase(e.transcript)) return { note: "", review: false };
    const t = (idx.byBase.get(accBase(formAcc)) ?? [])
      .filter((x) => !x.bridge)
      .sort((a, b) => Number(a.hist) - Number(b.hist) || accVersion(b.acc) - accVersion(a.acc))[0];
    const c = t ? genomeToC(t, e.pos) : undefined;
    if (c && inCodingTarget(c)) {
      return {
        note: `依頼書に表示される転写産物（${formAcc}）は計算に使った ${e.transcript} と異なりますが、記入した位置（9 桁）は同じで、解析の対象範囲内です。問題ありません（${formAcc} では ${c} にあたるため、報告書の c. 表記が入力と違うことがあります）`,
        review: false,
      };
    }
    return {
      note: `依頼書に表示される転写産物 ${formAcc} では、この位置は ${c ?? "転写産物の範囲外"} にあたり、解析の対象範囲（コード領域のエクソンとイントロン側 10 塩基以内）から外れる可能性があります。送付前に、かずさ遺伝子検査室に解析できるか確認してください`,
      review: true,
    };
  });
}
