/*
 * Coordinate regression tests. Expected hg38 positions come from ClinVar
 * (variant_summary GRCh38, VariationID in the comments) unless noted otherwise.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mapCdna, mapProtein, resolveTarget } from "../src/lib/variant/convert";
import { genomeToC } from "../src/lib/variant/mapping";
import { parseQuery } from "../src/lib/variant/parse";
import { ensureAll, getIndex, type RefSeqIndex } from "../src/lib/variant/refseq";
import type { ParsedQuery, Transcript } from "../src/lib/variant/types";

let idx: RefSeqIndex;
beforeAll(async () => {
  idx = await getIndex();
  await ensureAll(idx);
});

function transcriptFor(input: string, acc?: string): { q: ParsedQuery; t: Transcript } {
  const q = parseQuery(input);
  if (q.kind === "genomic") throw new Error("not a transcript query");
  const ts = resolveTarget(idx, q.target).transcripts;
  const t = acc ? ts.find((x) => x.acc === acc) : ts[0];
  if (!t) throw new Error(`transcript not found for ${input}`);
  return { q, t };
}

function map(input: string, acc?: string) {
  const { q, t } = transcriptFor(input, acc);
  if (q.kind !== "cdna") throw new Error("not c.");
  return { t, ...mapCdna(q, t) };
}

describe("置換: ClinVar の GRCh38 位置と一致する", () => {
  it.each([
    // [input, chrom, strand, position, ClinVar VariationID]
    ["NM_002253.2:c.889G>A", "chr4", "-", 55113391, "rs2305948"],
    ["NM_000179.3:c.1097A>G", "chr2", "+", 47799080, "628553"],
    ["NM_000251.3:c.1726G>C", "chr2", "+", 47471029, "90762"],
    ["NM_000051.4:c.2138A>C", "chr11", "+", 108256228, "629792"],
    ["NM_007294.4:c.135-5T>C", "chr17", "-", 43106538, "141658"],
    ["NM_000551.4:c.340+724G>C", "chr3", "+", 10142911, "864061"],
    ["NM_000038.6:c.-18-966G>T", "chr5", "+", 112753907, "82812"],
    ["NM_001042492.3:c.60+15G>A", "chr17", "+", 31095384, "1586346"],
    ["NM_005359.6:c.*3763C>T", "chr18", "+", 51082230, "327159"],
    ["NM_005359.6:c.*1G>C", "chr18", "+", 51078468, "630655"],
    ["NM_000546.6:c.*1132C>T", "chr17", "-", 7668477, "889286"],
    ["NM_000314.8:c.-821C>G", "chr10", "+", 87863649, "827509"],
    ["NM_000455.5:c.-49A>C", "chr19", "+", 1206865, "379512"],
    ["NM_000249.3:c.-206G>T", "chr3", "+", 36993342, "1785359"],
  ])("%s → %s:%i", (input, chrom, strand, pos) => {
    const m = map(input);
    expect(m.t.chrom).toBe(chrom);
    expect(m.t.strand).toBe(strand);
    expect([m.lo, m.hi]).toEqual([pos, pos]);
  });
});

describe("欠失・重複・挿入・欠失挿入", () => {
  it.each([
    // ClinVar の Start/Stop と完全一致
    ["NM_024675.4:c.1138_1139del", 23635407, 23635408],
    ["NM_020975.6:c.2712_2721del", 43120185, 43120194],
    ["NM_007294.4:c.5146_5148delinsAAA", 43063878, 43063880],
    ["NM_000314.8:c.635-1_636delinsTTTAA", 87957852, 87957854],
    ["NM_000059.4:c.995_996insA", 32332473, 32332474],
    // 反復配列内で ClinVar（VCF 左寄せ）と位置が異なるが、変異後の配列が同一であることを validate-clinvar で確認済み
    ["NM_001042492.3:c.1074del", 31201048, 31201048],
    ["NM_000546.6:c.323dup", 7676046, 7676046],
    ["NM_000546.6:c.934_992dup", 7673536, 7673594],
    ["NM_000051.4:c.7216_7217insTA", 108329147, 108329148],
  ])("%s → %i-%i", (input, lo, hi) => {
    const m = map(input);
    expect([m.lo, m.hi]).toEqual([lo, hi]);
  });
});

describe("検証で見つかり修正した不具合の再発防止", () => {
  it("転写開始点より上流の c.-N をゲノム上で延長して計算する", () => {
    const m = map("NM_022369.3:c.-5200G>A");
    expect([m.lo, m.hi]).toEqual([74207897, 74207897]);
    expect(m.warnings.join()).toContain("上流");
  });

  it("エクソン境界の挿入は 3' 側エクソンの直前に置く（+鎖）", () => {
    const m = map("NM_000260.4:c.849_850insA");
    expect([m.lo, m.hi]).toEqual([77158276, 77158277]);
    expect(m.warnings.join()).toContain("エクソン境界");
  });

  it("エクソン境界の挿入（別の遺伝子）", () => {
    const m = map("NM_001032221.6:c.1359_1360insC");
    expect([m.lo, m.hi]).toEqual([127678430, 127678431]);
  });

  it("末端の未整列部分の延長は c.→ゲノム とゲノム→c. で一致する（ACADS NM_000017.2:c.*573）", () => {
    const m = map("NM_000017.2:c.*573G>A");
    expect(m.lo).toBe(120740021);
    expect(genomeToC(m.t, 120740021)).toBe("c.*573");
  });

  it("転写産物末端のゲノムに整列していない部分も延長して計算する", () => {
    const m = map("NM_000328.2:c.*477_*497dup");
    expect(m.lo).toBe(38269129);
    expect(m.hi - m.lo + 1).toBe(21);
  });

  it("72 kb 上流の別プロモーター付近の c.-N も計算する（DMD NM_004006.2:c.-72567, ClinVar 137114）", () => {
    const m = map("NM_004006.2:c.-72567T>C");
    expect([m.lo, m.hi]).toEqual([33283879, 33283879]);
    expect(genomeToC(m.t, 33283879)).toBe("c.-72567");
  });

  it("100 kb を超える上流はエラーにする（入力ミス対策）", () => {
    expect(() => map("NM_004006.2:c.-150000T>C")).toThrow("離れすぎ");
  });
});

describe("形式1 の逆変換: hg38 位置 → c. 表記", () => {
  it.each([
    ["NM_002253.4", 55113391, "c.889"],
    ["NM_000546.6", 7675993, "c.375+1"],
    ["NM_000038.6", 112753907, "c.-18-966"],
    ["NM_000546.6", 7668477, "c.*1132"],
    ["NM_022369.3", 74207897, "c.-5200"],
  ])("%s %i → %s", (acc, pos, expected) => {
    const t = idx.byAcc.get(acc)![0];
    expect(genomeToC(t, pos)).toBe(expected);
  });
});

describe("形式3: p. → コドン位置", () => {
  it("NP_443086.1:p.Asp509 は NM_052854 のコドン c.1525-1527", () => {
    const { q, t } = transcriptFor("NP_443086.1:p.Asp509Glyfs");
    if (q.kind !== "protein") throw new Error();
    expect(t.acc.startsWith("NM_052854")).toBe(true);
    expect(mapProtein(q, t).codon1).toEqual([46320711, 46320712, 46320713]);
  });

  it("−鎖の KRAS p.Gly12 はゲノム上で逆順に並ぶ", () => {
    const { q, t } = transcriptFor("KRAS p.G12D");
    if (q.kind !== "protein") throw new Error();
    expect(t.mane).toBe("MANE Select");
    expect(mapProtein(q, t).codon1).toEqual([25245351, 25245350, 25245349]);
  });

  it("タンパク質の長さを超える位置はエラー", () => {
    const { q, t } = transcriptFor("KRAS p.G999D");
    if (q.kind !== "protein") throw new Error();
    expect(() => mapProtein(q, t)).toThrow(/長さ/);
  });
});

describe("転写産物の解決", () => {
  it("旧バージョン NM_002253.2 はそのバージョンのアライメントを使う", () => {
    const { t } = transcriptFor("NM_002253.2:c.889G>A");
    expect(t.acc).toBe("NM_002253.2");
    expect(t.hist).toBe(true);
  });

  it("遺伝子名では MANE Select を先頭にする", () => {
    const { t } = transcriptFor("BRCA1:c.68_69del");
    expect(t.acc).toBe("NM_007294.4");
  });

  it("遺伝子の別名を解決する（VEGFR2 → KDR）", () => {
    const { t } = transcriptFor("VEGFR2:c.889G>A");
    expect(t.gene).toBe("KDR");
  });

  it("バージョン未指定の NM_ は現行版を使う", () => {
    const { t } = transcriptFor("NM_007294:c.68_69del");
    expect(t.acc).toBe("NM_007294.4");
  });
});
