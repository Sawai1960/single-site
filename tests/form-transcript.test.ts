import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cPosToGenome, genomeToC } from "../src/lib/variant/mapping";
import { checkFormTranscripts, readForm, type PlannedEntry, type RequestForm } from "../src/lib/variant/request-form";
import { ensureAll, getIndex, type RefSeqIndex } from "../src/lib/variant/refseq";

const FORM = path.resolve(__dirname, "../../かずさDNA研究所仕様書/がん関連遺伝子のSingleSite解析依頼書2025v2.1.xlsx");

let idx: RefSeqIndex;
let genes: RequestForm["genes"];
beforeAll(async () => {
  idx = await getIndex();
  await ensureAll(idx);
  if (existsSync(FORM)) genes = readForm(readFileSync(FORM)).genes;
});

const entry = (gene: string, transcript: string, pos: number): PlannedEntry => ({
  input: gene,
  gene,
  pos,
  text: "",
  review: [],
  notes: [],
  index: 0,
  transcript,
});

describe.skipIf(!existsSync(FORM))("依頼書に表示される転写産物との比較", () => {
  it("同じ NM_ なら何も出さない", async () => {
    const [r] = await checkFormTranscripts([entry("TP53", "NM_000546.6", 7675088)], genes);
    expect(r).toEqual({ note: "", review: false });
  });

  it("NM_ が違っても対象範囲内なら、依頼書の転写産物での c. 表記を知らせる", async () => {
    const t = idx.byAcc.get("NM_001370259.2")![0];
    const pos = cPosToGenome(t, { base: 100, utr3: false, offset: 0 }).genomic;
    const [r] = await checkFormTranscripts([entry("MEN1", t.acc, pos)], genes);
    expect(r.review).toBe(false);
    expect(r.note).toContain("NM_130799");
    expect(r.note).toContain("問題ありません");
    expect(r.note).toMatch(/では c\.\d+ にあたる/);
  });

  it("依頼書の転写産物にないエクソンなら、対象範囲外の可能性として要確認にする", async () => {
    const mane = idx.byAcc.get("NM_001042492.3")![0];
    const form = idx.byBase.get("NM_000267")!.find((x) => !x.hist)!;
    let pos: number | undefined;
    for (let c = 1; c < mane.cds[1] - mane.cds[0] && pos === undefined; c += 3) {
      const g = cPosToGenome(mane, { base: c, utr3: false, offset: 0 }).genomic;
      const fc = genomeToC(form, g);
      if (!fc || /[+-]\d+$/.test(fc.slice(3)) && Math.abs(Number(fc.match(/([+-]\d+)$/)![1])) > 10) pos = g;
    }
    expect(pos).toBeDefined();
    const [r] = await checkFormTranscripts([entry("NF1", mane.acc, pos!)], genes);
    expect(r.review).toBe(true);
    expect(r.note).toContain("対象範囲");
  });
});
