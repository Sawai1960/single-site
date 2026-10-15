import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { filledVariantCells, fillForm, planEntries, readForm, type FormEntry } from "@/lib/variant/request-form";
import type { ConversionResult, ResultCandidate } from "@/lib/variant/types";

const FORMS = path.resolve(__dirname, "../../かずさDNA研究所仕様書");
const form = (name: string) => readFileSync(path.join(FORMS, name));
const CANCER = "がん関連遺伝子のSingleSite解析依頼書2025v2.1.xlsx";
const CANCER_RE = "がん関連遺伝子のSingleSite再解析依頼書（5つ以上の遺伝子用）2025v2.1.xlsx";
const SANGER = "sanger検査依頼書2023v1.2.xlsx";

const entry = (gene: string, pos: number, text = ""): FormEntry => ({ input: gene, gene, pos, text });

/** Cell → displayed text of the main sheet, read back from the written file. */
function cells(bytes: Uint8Array): (ref: string) => string {
  const f = readForm(bytes);
  const sheet = strFromU8(f.files[f.sheetPath]);
  return (ref) => {
    const m = sheet.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
    const inner = m?.[1] ?? "";
    return inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  };
}

describe.skipIf(!existsSync(FORMS))("かずさ遺伝子検査室の依頼書への記入", () => {
  it("依頼書の種類を見分ける", () => {
    expect(readForm(form(CANCER)).kind).toBe("cancer");
    expect(readForm(form(CANCER_RE)).kind).toBe("cancer-re");
    expect(readForm(form(SANGER)).kind).toBe("sanger");
    expect(readForm(form(CANCER)).genes?.size).toBe(60);
  });

  it("がん関連: 遺伝子名と 9 桁を 1 桁ずつ記入し、他の部分はそのまま残す", () => {
    const src = form(CANCER);
    const out = fillForm(readForm(src), [entry("TP53", 7675088), entry("BRCA1", 43106487)]);
    const c = cells(out);
    expect(c("B7")).toBe("TP53");
    expect(["B8", "C8", "D8", "E8", "F8", "G8", "H8", "I8", "J8"].map(c).join("")).toBe("007675088");
    expect(c("B9")).toBe("BRCA1");
    expect(["B10", "C10", "D10", "E10", "F10", "G10", "H10", "I10", "J10"].map(c).join("")).toBe("043106487");
    expect(c("B11")).toBe("");

    const before = unzipSync(src);
    const after = unzipSync(out);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before).filter((n) => !/sheet1\.xml$|workbook\.xml$/.test(n))) {
      expect(after[name], name).toEqual(before[name]);
    }
    expect(strFromU8(after["xl/workbook.xml"])).toContain('fullCalcOnLoad="1"');
  });

  it("既に記入された変異の欄を見つけ、記入し直すと前の内容は消える", () => {
    const re = readForm(form(CANCER_RE));
    const once = fillForm(re, [entry("TP53", 7675088)]);
    expect(filledVariantCells(readForm(once)).length).toBe(10);
    const twice = fillForm(readForm(once), [entry("APC", 112838220)]);
    expect(cells(twice)("B7")).toBe("APC");
    expect(cells(twice)("G14")).toBe("");
  });

  it("再解析依頼書には、空欄の匿名化 ID と医療機関情報を最初の依頼書から写す", () => {
    const first = readForm(fillForm(readForm(form(CANCER)), [entry("TP53", 7675088)]));
    const firstSheet = strFromU8(first.files[first.sheetPath]).replace(
      /<c r="B6"([^>]*?)\/>/,
      '<c r="B6"$1 t="inlineStr"><is><t>AB1234</t></is></c>',
    );
    first.files[first.sheetPath] = new TextEncoder().encode(firstSheet);
    const out = fillForm(readForm(form(CANCER_RE)), [entry("APC", 112838220)], first);
    expect(cells(out)("B6")).toBe("AB1234");
  });

  it("Sanger: 1 か所 1 行で記入する", () => {
    const line = "CYBB chrX:37783542 NM_000397.4 c.194T>G p.Met65Arg";
    const c = cells(fillForm(readForm(form(SANGER)), [entry("CYBB", 37783542, line)]));
    expect(c("B11")).toBe(line.replace(">", "&gt;"));
    expect(c("B12")).toBe("");
  });

  it("依頼書でないファイルは読み込まない", () => {
    expect(() => readForm(new Uint8Array([1, 2, 3]))).toThrow(/xlsx/);
  });
});

const cand = (over: Partial<ResultCandidate>): ResultCandidate => ({
  transcript: "NM_000546.6",
  gene: "TP53",
  protein: "",
  mane: "",
  historical: false,
  chrom: "chr17",
  strand: "-",
  start: 7675088,
  end: 7675088,
  hgvsC: "NM_000546.6:c.524G>A",
  warnings: [],
  ucscUrl: "",
  ...over,
});
const res = (candidates: ResultCandidate[], over: Partial<ConversionResult> = {}): ConversionResult => ({
  input: "x",
  status: "ok",
  format: 2,
  candidates,
  notes: [],
  ...over,
});
const none = { warning: false, mismatch: false };

describe("依頼書に書く内容の決め方", () => {
  it("ゲノム位置の入力は MANE Select を代表にする", () => {
    const p = planEntries(
      [res([cand({ transcript: "NM_1.1" }), cand({ transcript: "NM_000546.6", mane: "MANE Select" })], { format: 1 })],
      "sanger",
      [none],
    );
    expect(p.entries[0].text).toContain("NM_000546.6");
  });

  it("位置が 1 つに決まらない結果・対象外の遺伝子・エラーは記入しない", () => {
    const p = planEntries(
      [
        res([cand({}), cand({ transcript: "NM_2.1", start: 7675100, end: 7675100 })]),
        res([cand({ gene: "KRAS" })]),
        res([], { status: "error" }),
      ],
      "cancer60",
      [none, none, none],
    );
    expect(p.entries).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining("1 つに決まらない"),
      expect.stringContaining("60 遺伝子"),
      expect.stringContaining("変換できなかった"),
    ]);
  });

  it("要確認・不一致・欠失の範囲を知らせる", () => {
    const p = planEntries(
      [res([cand({})]), res([cand({ start: 7675090, end: 7675093 })])],
      "cancer60",
      [{ warning: true, mismatch: true }, none],
    );
    expect(p.entries[0].review).toEqual(["外部データベースと不一致"]);
    expect(p.entries[1].notes[0]).toContain("特記事項");
  });

  it("p. 表記のコドンは中央の塩基を記入する", () => {
    const p = planEntries(
      [res([cand({ start: 7675087, end: 7675089, hgvsC: "NM_000546.6:c.523_525（コドン 175）" })], { format: 4 })],
      "cancer60",
      [none],
    );
    expect(p.entries[0].pos).toBe(7675088);
    expect(p.entries[0].notes[0]).toContain("コドン");
  });

  it("同じ位置は重ねて記入しない", () => {
    const p = planEntries([res([cand({})], { input: "a", format: 1 }), res([cand({})], { input: "b" })], "cancer60", [none, none]);
    expect(p.entries.map((e) => e.input)).toEqual(["a"]);
    expect(p.skipped[0].reason).toContain("「a」と同じ位置");
  });
});
