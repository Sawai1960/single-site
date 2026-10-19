import { describe, expect, it } from "vitest";
import { ParseError, expandShorthand, parseQuery, readReportLine, splitTrailingRemark } from "../src/lib/variant/parse";

describe("形式1: ゲノム位置", () => {
  it.each([
    ["hg38, chr1:195507262", "hg38", "chr1", 195507262, 195507262],
    ["hg38 chr1:195,507,262", "hg38", "chr1", 195507262, 195507262],
    ["GRCh37 chr7:55259515", "hg19", "chr7", 55259515, 55259515],
    ["chrX:100-200 (hg38)", "hg38", "chrX", 100, 200],
    ["ｈｇ３８，ｃｈｒ１：１９５５０７２６２", "hg38", "chr1", 195507262, 195507262],
    ["NC_000004.12:g.55113391C>T", "hg38", "chr4", 55113391, 55113391],
    ["NC_000007.13:g.55259515", "hg19", "chr7", 55259515, 55259515],
  ])("%s", (input, assembly, chrom, start, end) => {
    const q = parseQuery(input);
    expect(q).toMatchObject({ kind: "genomic", assembly, chrom, start, end });
  });

  it("バージョン未指定は hg38 として扱い、未指定であることを記録する", () => {
    expect(parseQuery("chr4:55113391")).toMatchObject({ assembly: "hg38", assemblyGiven: false });
  });

  it("参照塩基・変異塩基を読み取る", () => {
    expect(parseQuery("hg19 chr7:55259515 T>G")).toMatchObject({ change: "T>G" });
  });
});

describe("ミトコンドリア DNA の m. 表記", () => {
  it.each([
    ["m.3243A>G", 3243, 3243, "A>G", undefined],
    ["NC_012920.1:m.3243A>G", 3243, 3243, "A>G", undefined],
    ["chrM:m.8993T>G", 8993, 8993, "T>G", undefined],
    ["MT-TL1:m.3243A>G", 3243, 3243, "A>G", "MT-TL1"],
    ["MT-ND5 m.13513G>A", 13513, 13513, "G>A", "MT-ND5"],
    ["NC_012920.1(MT-ATP6):m.8993T>G", 8993, 8993, "T>G", "MT-ATP6"],
    ["m.8470_13446del", 8470, 13446, "DEL", undefined],
  ])("%s", (input, start, end, change, label) => {
    expect(parseQuery(input)).toMatchObject({
      kind: "genomic",
      assembly: "hg38",
      assemblyGiven: true,
      chrom: "chrM",
      start,
      end,
      change,
      mito: { label },
    });
  });

  it.each([
    ["m.16570A>G", /16,569 塩基/],
    ["NC_001807.4:m.3243A>G", /NC_001807/],
    ["NM_000546.6:m.100A>G", /ミトコンドリア DNA/],
  ])("%s はエラー", (input, message) => {
    expect(() => parseQuery(input)).toThrow(message);
  });
});

describe("形式2/4: c. 表記", () => {
  it.each([
    ["NM_002253.2:c.889G>A", { type: "transcript", acc: "NM_002253.2" }],
    ["NM_002253.2, c.889G>A", { type: "transcript", acc: "NM_002253.2" }],
    ["NM_002253.2(KDR):c.889G>A", { type: "transcript", acc: "NM_002253.2", gene: "KDR" }],
    ["KDR:c.889G>A", { type: "gene", symbol: "KDR" }],
    ["kdr c.889G>A", { type: "gene", symbol: "KDR" }],
  ])("%s", (input, target) => {
    const q = parseQuery(input);
    expect(q).toMatchObject({
      kind: "cdna",
      target,
      start: { base: 889, utr3: false, offset: 0 },
      varType: "substitution",
      refAllele: "G",
      altAllele: "A",
    });
  });

  it.each([
    ["NM_000546.6:c.375+1G>A", { base: 375, utr3: false, offset: 1 }],
    ["NM_000546.6:c.376-2A>G", { base: 376, utr3: false, offset: -2 }],
    ["NM_000546.6:c.-30C>T", { base: -30, utr3: false, offset: 0 }],
    ["NM_000546.6:c.*10C>T", { base: 10, utr3: true, offset: 0 }],
    ["NM_000038.6:c.-18-966G>T", { base: -18, utr3: false, offset: -966 }],
  ])("位置の種類 %s", (input, start) => {
    expect(parseQuery(input)).toMatchObject({ start });
  });

  it.each([
    ["NM_007294.4:c.68_69delAG", "deletion", "AG", undefined],
    ["NM_007294.4:c.68_69del", "deletion", undefined, undefined],
    ["NM_007294.4:c.5266dupC", "duplication", "C", undefined],
    ["NM_000059.4:c.995_996insA", "insertion", undefined, "A"],
    ["NM_007294.4:c.5146_5148delinsAAA", "delins", undefined, "AAA"],
    ["NM_007294.4:c.100_110inv", "inversion", undefined, undefined],
    ["NM_007294.4:c.100", "position", undefined, undefined],
  ])("変異の種類 %s", (input, varType, refAllele, altAllele) => {
    const q = parseQuery(input);
    if (q.kind !== "cdna") throw new Error("not c.");
    expect([q.varType, q.refAllele, q.altAllele]).toEqual([varType, refAllele, altAllele]);
  });
});

describe("形式3/4: p. 表記", () => {
  it.each([
    ["NP_443086.1:p.Asp509Glyfs", { aa1: "D", pos1: 509, frameshift: true, altAA: "G" }],
    ["NP_004976.2:p.G12D", { aa1: "G", pos1: 12, altAA: "D", frameshift: false }],
    ["KRAS p.Gly12Asp", { aa1: "G", pos1: 12, altAA: "D" }],
    ["TP53:p.(Arg175His)", { aa1: "R", pos1: 175, altAA: "H" }],
    ["BRCA1:p.Arg1443Ter", { aa1: "R", pos1: 1443, altAA: "*" }],
    ["BRCA1:p.R1443*", { aa1: "R", pos1: 1443, altAA: "*" }],
    ["EGFR:p.Glu746_Ala750del", { aa1: "E", pos1: 746, aa2: "A", pos2: 750 }],
  ])("%s", (input, expected) => {
    expect(parseQuery(input)).toMatchObject({ kind: "protein", ...expected });
  });

  it("欠失 p. 表記では変異後アミノ酸を持たない", () => {
    const q = parseQuery("EGFR:p.Glu746_Ala750del");
    expect(q.kind === "protein" && q.altAA).toBeFalsy();
  });
});

describe("「c.」「p.」が省かれた表記（FoundationOne の報告書など）", () => {
  it.each([
    ["SOX9 E75K", "SOX9 p.E75K"],
    ["KRAS G12D", "KRAS p.G12D"],
    ["BRCA1 R1443*", "BRCA1 p.R1443*"],
    ["SOX9 Glu75Lys", "SOX9 p.Glu75Lys"],
    ["EGFR exon 19 deletion (E746_A750del)", "EGFR p.E746_A750del"],
    ["APC Q1338fs*2", "APC p.Q1338fs*2"],
    ["PTEN M1?", "PTEN p.M1?"],
    ["TP53 R175H (VAF 45%)", "TP53 p.R175H"],
    ["TP53 R175H 45.2%", "TP53 p.R175H"],
    ["KMT2D (MLL2) P2354L", "KMT2D p.P2354L"],
    ["TERT promoter -124C>T", "TERT c.-124C>T"],
    ["MET exon 14 splice site (2888-14_2888-4del11)", "MET c.2888-14_2888-4del11"],
    ["MET 2888-14_2888-4del11", "MET c.2888-14_2888-4del11"],
    ["MET splice site 3028+1G>T", "MET c.3028+1G>T"],
    ["MET splice site (3028+1G>T)", "MET c.3028+1G>T"],
    ["BRCA2 6174delT", "BRCA2 c.6174delT"],
    ["NM_002253.2, c.889G>A", undefined],
    ["KRAS", undefined],
    ["KDR c.889G>A", undefined],
    ["EGFR p.Leu858Arg", undefined],
    ["hg38, chr1:195507262", undefined],
    ["chrX:100-200 (hg38)", undefined],
    ["hg19 chr7:55259515 T>G", undefined],
    ["NC_000004.12:g.55113391C>T", undefined],
  ])("%s", (input, expected) => {
    expect(expandShorthand(input)).toBe(expected);
  });

  it("c. 表記として変換する", () => {
    expect(parseQuery("MET exon 14 splice site (2888-14_2888-4del11)")).toMatchObject({
      kind: "cdna",
      target: { type: "gene", symbol: "MET" },
      start: { base: 2888, offset: -14 },
      end: { base: 2888, offset: -4 },
      varType: "deletion",
    });
  });

  it("p. 表記として変換する", () => {
    expect(parseQuery("SOX9 E75K")).toMatchObject({
      kind: "protein",
      target: { type: "gene", symbol: "SOX9" },
      aa1: "E",
      pos1: 75,
      altAA: "K",
    });
  });

  it.each([
    ["exon 14 splice site (2888-14_2888-4del11)", "遺伝子名 c.2888-14_2888-4del11"],
    ["(2888-14_2888-4del11)", "遺伝子名 c.2888-14_2888-4del11"],
    ["2888-14_2888-4del11", "遺伝子名 c.2888-14_2888-4del11"],
    ["E75K", "遺伝子名 p.E75K"],
  ])("遺伝子名がなければ、付けるよう案内する: %s", (input, hint) => {
    expect(() => parseQuery(input)).toThrow(/遺伝子名がないため変換できません/);
    expect(() => parseQuery(input)).toThrow(hint);
  });

  it("BRCA1/2 でも p. の省略は読む", () => {
    expect(expandShorthand("BRCA2 S1982fs*22")).toBe("BRCA2 p.S1982fs*22");
  });

  it.each([
    ["BRCA1 c.68_69delAG (p.Glu23Valfs*17)", "BRCA1 c.68_69delAG", "p.Glu23Valfs*17"],
    ["BRCA1 c.68_69delAG (185delAG)", "BRCA1 c.68_69delAG", "185delAG"],
    ["NM_000059.4:c.5946delT (p.Ser1982Argfs*22)", "NM_000059.4:c.5946delT", "p.Ser1982Argfs*22"],
    ["BRCA1 c.68_69delAG, p.Glu23Valfs*17", "BRCA1 c.68_69delAG", "p.Glu23Valfs*17"],
  ])("c. 表記の後ろの括弧書きは読み飛ばす: %s", (input, main, remark) => {
    expect(splitTrailingRemark(input)).toEqual({ main, remark });
    expect(parseQuery(input)).toMatchObject({ kind: "cdna", varType: "deletion" });
  });

  it.each(["NM_002253.2(KDR):c.889G>A", "TP53:p.(Arg175His)", "chrX:100-200 (hg38)", "NM_000546.6:c.375+1G>A"])(
    "括弧書きのない入力はそのまま: %s",
    (input) => {
      expect(splitTrailingRemark(input)).toBeUndefined();
    },
  );

  it.each(["BRCA2 R2336H, splice site 7976-1G>A", "TP53 c.524G>A; c.743G>A", "KRAS G12D、G13D"])(
    "1 行に複数の変異があれば止める: %s",
    (input) => {
      expect(() => parseQuery(input)).toThrow(/1 行に複数の変異/);
    },
  );

  it.each([
    "hg38, chr1:195507262",
    "hg38 chr1:195,507,262",
    "chr4:55,000,000-55,000,010",
    "NM_002253.2, c.889G>A",
    "hg19, chr17:7578406 T>G",
  ])("カンマを含む 1 件の入力は止めない: %s", (input) => {
    expect(() => parseQuery(input)).not.toThrow();
  });

  it.each([
    "ERBB2 amplification",
    "CDKN2A/B loss",
    "EML4-ALK fusion",
    "BRCA2 rearrangement intron 2",
    "APC truncation exon 16",
    "MLH1 loss exons 1-19",
    "BRCA1 exon 11 deletion",
  ])("位置を 1 点に指定できない変化は理由を示す: %s", (input) => {
    expect(() => parseQuery(input)).toThrow(/シングルサイト検査の対象外/);
  });
});

describe("かずさ遺伝子検査室の報告書から写した書き方", () => {
  it.each([
    ["BRCA2 NM_000059.4 c.6768T>A p.Cys2256Ter", "NM_000059.4(BRCA2):c.6768T>A", ["p.Cys2256Ter"]],
    [
      "1\tBRCA2\tNM_000059.4\theterozygous\tstop_gained\tc.6768T>A\tp.Cys2256Ter\tchr13:32341123\tT/A",
      "NM_000059.4(BRCA2):c.6768T>A",
      ["1", "heterozygous", "stop_gained", "p.Cys2256Ter", "chr13:32341123", "T/A"],
    ],
    ["NM_000059.4:c.6768T>A p.Cys2256Ter", "NM_000059.4:c.6768T>A", ["p.Cys2256Ter"]],
    ["BRCA2 c.6768T>A p.Cys2256Ter", "BRCA2:c.6768T>A", ["p.Cys2256Ter"]],
    ["BRCA2 exon11 c.6768T>A", "BRCA2:c.6768T>A", ["exon11"]],
    ["chr13:32341123 T/A", "chr13:32341123T>A", []],
  ])("%s", (input, line, dropped) => {
    expect(readReportLine(input)).toEqual({ line, dropped });
    expect(() => parseQuery(input)).not.toThrow();
  });

  it.each(["KDR c.889G>A", "NM_002253.2, c.889G>A", "BRCA2 c.6768T>A (p.Cys2256*)", "NM_002253.2(KDR):c.889G>A", "hg38, chr1:195507262"])(
    "これまでの書き方には使わない: %s",
    (input) => {
      expect(readReportLine(input)).toBeUndefined();
    },
  );
});

describe("入力エラー", () => {
  it.each([
    ["c.889G>A", /遺伝子名または NM_\/NP_ 番号/],
    ["NM_002253.2:p.Val297Ile", /NP_ 番号か遺伝子名/],
    ["NP_443086.1:c.100A>G", /NM_ 番号か遺伝子名/],
    ["ENST00000263923:c.889G>A", /Ensembl ID/],
    ["XM_011534.1:c.1A>G", /予測 RefSeq/],
    ["hg38, chr23:100", /染色体番号/],
    ["NM_002253.2:c.0A>G", /c\.0/],
    ["何かの文字列", /入力形式を判別できません/],
  ])("%s", (input, message) => {
    expect(() => parseQuery(input)).toThrow(ParseError);
    expect(() => parseQuery(input)).toThrow(message);
  });
});
