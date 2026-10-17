/*
 * End-to-end tests through convertOne, loading transcript buckets on demand as the browser does.
 * Remote calls are replaced by recorded responses in tests/fixtures/remote.json.
 * Re-record with: RECORD_FIXTURES=1 npx vitest run tests/convert.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const FIXTURE = path.join(__dirname, "fixtures", "remote.json");
const RECORD = process.env.RECORD_FIXTURES === "1";
const recorded: Record<string, unknown> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};

vi.mock("../src/lib/variant/remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/variant/remote")>();
  const replay =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const key = `${name}:${args.join(":")}`;
      if (key in recorded) return recorded[key] as R;
      if (!RECORD) throw new Error(`fixture missing: ${key}（RECORD_FIXTURES=1 で記録してください）`);
      const v = await fn(...args);
      recorded[key] = v;
      return v;
    };
  return {
    getSequence: replay("seq", actual.getSequence),
    liftHg19ToHg38: replay("lift", actual.liftHg19ToHg38),
    getRefSeqRecord: replay("refseq", actual.getRefSeqRecord),
    getMitoGenes: replay("mito", actual.getMitoGenes),
  };
});

const { convertOne, shiftGenomic3 } = await import("../src/lib/variant/convert");
const { kazusaCheck, needsReview, requestText, sangerLine } = await import("../src/lib/variant/kazusa");

afterAll(() => {
  if (RECORD) writeFileSync(FIXTURE, JSON.stringify(recorded, null, 1) + "\n");
});

describe("資料の入力例", () => {
  it("形式2: NM_002253.2, c.889G>A", async () => {
    const r = await convertOne("NM_002253.2, c.889G>A");
    expect(r.status).toBe("ok");
    expect(r.format).toBe(2);
    const c = r.candidates[0];
    expect(c).toMatchObject({ transcript: "NM_002253.2", gene: "KDR", chrom: "chr4", start: 55113391, end: 55113391 });
    expect(c.refCheck).toMatchObject({ expected: "G", observed: "G", ok: true });
    expect(c.hgvsG).toBe("NC_000004.12:g.55113391C>T");
    expect(c.warnings.join()).toContain("旧バージョン");
  });

  it("形式3: NP_443086.1:p.Asp509Glyfs", async () => {
    const r = await convertOne("NP_443086.1:p.Asp509Glyfs");
    expect(r.format).toBe(3);
    const c = r.candidates[0];
    expect(c).toMatchObject({ gene: "CREB3L1", chrom: "chr11", start: 46320711, end: 46320713, codon: "GAT" });
    expect(c.refCheck?.ok).toBe(true);
    expect(c.warnings.join()).toContain("フレームシフト");
    expect(r.notes.join()).toContain("シグナル配列");
  });

  it("形式1: hg38, chr1:195507262（重なる転写産物なし）", async () => {
    const r = await convertOne("hg38, chr1:195507262");
    expect(r.format).toBe(1);
    expect(r.candidates[0]).toMatchObject({ chrom: "chr1", start: 195507262, transcript: "" });
    expect(r.notes.join()).toContain("遺伝子間領域");
  });
});

describe("バージョン番号なしの NM_/NP_", () => {
  it("KDR NM_002253 は全バージョンで同じ位置なので変換成功", async () => {
    const r = await convertOne("NM_002253:c.889G>A");
    expect(r.status).toBe("ok");
    expect(r.versions?.map((v) => v.transcript)).toEqual(["NM_002253.4", "NM_002253.3", "NM_002253.2", "NM_002253.1"]);
    expect(r.versions?.every((v) => v.same)).toBe(true);
    expect(r.notes[0]).toContain("どのバージョンでも同じゲノム位置");
  });

  it("BRAF NM_004333 は .1 だけ位置が 3 塩基ずれるので要確認", async () => {
    const r = await convertOne("NM_004333:c.100G>A");
    expect(r.status).toBe("warning");
    expect(r.candidates[0].transcript).toBe("NM_004333.6");
    const v1 = r.versions?.find((v) => v.transcript === "NM_004333.1");
    expect(v1).toMatchObject({ same: false, loci: [{ chrom: "chr7", start: 140924601 }] });
    expect(r.notes[0]).toContain("2 通りに分かれました");
  });

  it("ARID1A NM_006015 は UCSC に無い .2 を NCBI の配列で補って比べる", async () => {
    const r = await convertOne("NM_006015:c.100");
    const v2 = r.versions?.find((v) => v.transcript === "NM_006015.2");
    expect(v2).toMatchObject({ bridged: true, same: true });
    expect(r.versions).toHaveLength(6);
  });

  it("NP_004976（KRAS）は NP_/NM_ の組み合わせごとに比べる", async () => {
    const r = await convertOne("NP_004976:p.Gly12Asp");
    expect(r.status).toBe("ok");
    expect(r.versions?.length).toBeGreaterThan(1);
    expect(r.notes[0]).toContain("NP_ と NM_ の組み合わせ");
  });
});

describe("外部照合用のデータ", () => {
  it("c. 置換は HGVS と本ツールのゲノム上の編集を持つ", async () => {
    const r = await convertOne("NM_002253.2:c.889G>A");
    expect(r.candidates[0].verify).toEqual({
      forward: [
        {
          hgvs: "NM_002253.2:c.889G>A",
          edit: { from: 55113391, to: 55113391, alt: "T" },
          at: { hgvs: "NM_002253.2:c.889", from: 55113391, to: 55113391 },
        },
      ],
      points: [{ pos: 55113391, c: "c.889" }],
    });
  });

  it("形式1 は重なる転写産物ごとに c. 位置を照合する", async () => {
    const r = await convertOne("hg38, chr4:55113391");
    const c = r.candidates.find((x) => x.transcript === "NM_002253.4");
    expect(c?.verify?.points).toEqual([{ pos: 55113391, c: "c.889" }]);
    expect(c?.verify?.forward[0].hgvs).toBe("NM_002253.4:c.889del");
  });
});

describe("形式4: スプライシング型不明", () => {
  it("KDR:c.889G>A は MANE Select を先頭に返す", async () => {
    const r = await convertOne("KDR:c.889G>A");
    expect(r.format).toBe(4);
    expect(r.candidates[0]).toMatchObject({ transcript: "NM_002253.4", mane: "MANE Select", start: 55113391 });
  });

  it("KRAS p.G12D は 1 塩基置換候補 c.35G>A（chr12:25245350 C>T）を返す", async () => {
    const r = await convertOne("KRAS p.G12D");
    const c = r.candidates[0];
    expect(c.mane).toBe("MANE Select");
    expect(c.codon).toBe("GGT");
    expect(c.snvCandidates).toEqual([
      expect.objectContaining({ hgvsC: "c.35G>A", genomicPos: 25245350, genomicRef: "C", genomicAlt: "T" }),
    ]);
  });

  it("EGFR p.Leu858Arg: リファレンスが一致しない転写産物は末尾に回す", async () => {
    const r = await convertOne("EGFR p.Leu858Arg");
    expect(r.candidates[0]).toMatchObject({ transcript: "NM_005228.5", start: 55191821 });
    const firstMismatch = r.candidates.findIndex((c) => c.refCheck && !c.refCheck.ok);
    const lastMatch = r.candidates.map((c) => c.refCheck?.ok).lastIndexOf(true);
    expect(firstMismatch).toBeGreaterThan(lastMatch);
  });
});

describe("c. のない番号と旧来の番号", () => {
  it.each([
    ["MET exon 14 splice site (2888-14_2888-4del11)", "MET c.2888-14_2888-4del11"],
    ["BRCA1 68_69delAG", "BRCA1 c.68_69delAG"],
  ])("旧来の番号のない遺伝子・旧来の番号では成り立たない番号は c. として変換する: %s", async (input, read) => {
    const r = await convertOne(input);
    expect(r.status).not.toBe("error");
    expect(r.notes).toContain(`「c.」が省かれた表記として、${read} と読み取りました`);
  });

  it("今の番号でだけ合えば、旧来の番号では一致しないことを添えて変換する", async () => {
    const r = await convertOne("BRCA2 5946delT");
    expect(r.status).toBe("ok");
    expect(r.notes.join()).toContain("旧来の番号とみなすと一致しないため、現在の記載方法（c. 表記）と判断しました");
  });

  it("旧来の番号でだけ合えば止め、現在の c. 表記を示す", async () => {
    const r = await convertOne("CFTR 621+1G>T");
    expect(r.status).toBe("error");
    expect(r.message).toContain("旧来の記載方法（旧来の CFTR 表記）のようです");
    expect(r.message).toContain("（現在の番号では一致しません）");
    expect(r.message).toContain("現在の記載方法に従った c. 表記「CFTR c.489+1G>T」で入力しなおしてください");
  });

  it.each([
    ["BRCA2 6174delT", "どちらとみなしても塩基が一致する", "「BRCA2 c.6174delT」", "「BRCA2 c.5946delT」"],
    ["BRCA1 185delAG", "どちらとみなしても塩基が一致する", "「BRCA1 c.185_186delAG」", "「BRCA1 c.66_67delAG」"],
    ["BRCA1 5382insC", "入力に塩基の情報がなく照合できない", "「BRCA1 c.5382insC」", "「BRCA1 c.5263insC」"],
  ])("どちらの番号でも成り立てば止め、両方の形を示す: %s", async (input, reason, current, legacy) => {
    const r = await convertOne(input);
    expect(r.status).toBe("error");
    expect(r.message).toContain("旧来の記載なのか、現在の記載方法（c. で始まる表記）なのか分かりません");
    expect(r.message).toContain(reason);
    expect(r.message).toContain(`現在の記載なら${current}`);
    expect(r.message).toContain(`旧来の記載なら${legacy}`);
    expect(r.message).toContain("p. 表記");
  });

  it("どちらの番号でも合わなければ、その旨を添えて c. として変換した結果を示す", async () => {
    const r = await convertOne("brca2 splice site 7976-1G>A");
    expect(r.status).toBe("warning");
    expect(r.notes.join()).toContain("旧来の番号とみなしても一致しませんでした");
  });
});

describe("成熟型タンパク質の番号", () => {
  const mane = async (input: string) => (await convertOne(input)).candidates.find((c) => c.mane === "MANE Select")!;

  it.each([
    ["GBA1 p.N370S", "GBA1 p.Asn409Ser"],
    ["HBB p.Glu6Val", "HBB p.Glu7Val"],
    ["TTR p.V30M", "TTR p.Val50Met"],
    ["SERPINA1 p.E342K", "SERPINA1 p.Glu366Lys"],
  ])("%s は成熟型の番号とみなすと一致することを示す", async (input, asMature) => {
    const c = await mane(input);
    expect(c.refCheck?.ok).toBe(false);
    expect(c.warnings[0]).toContain(`「${asMature}」で入力し直してください`);
  });

  it.each(["GBA1 p.Asn409Ser", "TTR p.Val50Met"])(
    "開始 Met から数えた番号の入力は、成熟型の番号では合わなければ注意しない: %s",
    async (input) => {
      const c = await mane(input);
      expect(c.refCheck?.ok).toBe(true);
      expect(c.warnings.join()).not.toContain("成熟型タンパク質の番号");
    },
  );

  it.each([
    ["GBA1 p.N370S", "「GBA1 p.Asn409Ser」"],
    ["HBB p.Glu7Val", "番号だけではどちらか決められません"],
    ["GBA1 p.Asn409Ser", ""],
  ])("確認表に出す注意（先頭の候補から）: %s", async (input, text) => {
    const { numberingNote } = await import("../src/lib/variant/request-form");
    const note = numberingNote((await convertOne(input)).candidates[0]);
    if (text) expect(note).toContain(text);
    else expect(note).toBe("");
  });

  it("どちらの番号でも合うとき（HBB は 7・8 番目がともに Glu）は、決められないことを示す", async () => {
    const c = await mane("HBB p.Glu7Val");
    expect(c.refCheck?.ok).toBe(true);
    expect(c.warnings[0]).toContain("番号だけではどちらか決められません");
  });
});

describe("照合と注意表示", () => {
  it("リファレンス塩基が違う入力は要確認にする", async () => {
    const r = await convertOne("NM_002253.2:c.889C>T");
    expect(r.status).toBe("warning");
    expect(r.candidates[0].refCheck).toMatchObject({ expected: "C", observed: "G", ok: false });
  });

  it("2 塩基以上の欠失は範囲指定と特記事項の注意を出す", async () => {
    const r = await convertOne("NM_007294.4:c.68_69delAG");
    const c = r.candidates[0];
    expect(c.refCheck?.ok).toBe(true);
    expect(c.warnings.join()).toContain("特記事項");
  });

  it("− 鎖遺伝子の繰り返し内の欠失は g. 表記の 3' 側に寄せる（NCBI SPDI NC_000017.11:43124027:CTCT:CT）", async () => {
    const r = await convertOne("NM_007294.4:c.68_69delAG");
    const c = r.candidates[0];
    expect([c.start, c.end]).toEqual([43124030, 43124031]);
    expect(c.hgvsG).toBe("NC_000017.11:g.43124030_43124031del");
    expect(c.warnings.join()).toContain("chr17:43124028-43124029");
  });

  it("偽常染色体領域の SHOX は chrX と chrY の両方を返し注意を出す", async () => {
    const r = await convertOne("NM_000451.4:c.100");
    expect(r.candidates.map((c) => c.chrom).sort()).toEqual(["chrX", "chrY"]);
    for (const c of r.candidates) expect(c.warnings.join()).toContain("2 か所にアライメント");
  });

  it("相同領域のある遺伝子（PMS2）に注意を出す", async () => {
    const r = await convertOne("PMS2:c.137G>T");
    expect(r.candidates[0].warnings.join()).toContain("相同領域");
    expect(r.candidates[0].warnings.join()).not.toContain("分節重複");
  });

  it.each([
    // UCSC と ClinVar（NCBI）で別のコピーに対応付けられていた旧版（validation/ANALYSIS.md）
    ["NM_000854.3:c.338C>T", "GSTT2B"],
    ["NM_001472.2:c.185C>T", "GAGE"],
    ["SMN1:c.840C>T", "SMN2"],
    // 2 つのコピーの長さが違い、もう一方のコピーの位置が重複領域の外にはみ出す
    ["NM_012200.4:c.914del", "TRIM59"],
  ])("ほぼ同じ配列のコピーがある遺伝子（%s）に注意を出す", async (input, partner) => {
    const r = await convertOne(input);
    const w = r.candidates[0].warnings.find((x) => x.includes("分節重複"));
    expect(w).toBeDefined();
    expect(w).toContain(partner);
  });

  it("重複領域にない遺伝子には分節重複の注意を出さない", async () => {
    const r = await convertOne("NM_004985.5:c.35G>A");
    expect(r.candidates[0].warnings.join()).not.toContain("分節重複");
  });

  it("hg19 の位置を hg38 に変換する", async () => {
    const r = await convertOne("hg19, chr7:55259515 T>G");
    expect(r.candidates[0]).toMatchObject({ chrom: "chr7", start: 55191822 });
    expect(r.candidates[0].refCheck?.ok).toBe(true);
    expect(r.notes.join()).toContain("hg19");
  });

  it("形式1 で重なる転写産物の c. 表記を返す", async () => {
    const r = await convertOne("hg38 chr17:7675993 C>T");
    const tp53 = r.candidates.find((c) => c.transcript === "NM_000546.6");
    expect(tp53?.hgvsC).toBe("NM_000546.6:c.375+1G>A");
  });

  it("hg38 に無い部分より後ろの c. 番号は、どの入力形式でもデータベースによる番号のずれを注意する（SHANK3）", async () => {
    const note = "c.1528〜c.1566 の 39 塩基";
    const after = await convertOne("NM_001372044.2:c.1734T>A");
    expect(after.candidates[0]).toMatchObject({ chrom: "chr22", start: 50698700 });
    expect(after.candidates[0].warnings.join()).toContain(note);
    const genomic = await convertOne("hg38, chr22:50698700");
    const shank3 = genomic.candidates.find((c) => c.transcript === "NM_001372044.2");
    expect(shank3?.hgvsC).toBe("NM_001372044.2:c.1734");
    expect(shank3?.warnings.join()).toContain(note);
    const before = await convertOne("NM_001372044.2:c.994G>A");
    expect(before.candidates[0].warnings.join()).not.toContain(note);
    expect(before.candidates[0].warnings.join()).toContain("完全には一致しません");
  });
});

describe("UCSC にアライメントの無いバージョン（NCBI の配列で照合）", () => {
  // NM_052892.5（PKD1L2）は UCSC のデータに無く、.4 とは 5' 側の配列と番号が違う。
  // 以前は .4 で代わりに計算して 9 塩基ずれていた（validation/ANALYSIS.md）
  it("NM_052892.5:c.4853G>A を ClinVar と同じ chr16:81148249 にする", async () => {
    const r = await convertOne("NM_052892.5:c.4853G>A");
    expect(r.status).toBe("ok");
    const c = r.candidates[0];
    expect(c).toMatchObject({ transcript: "NM_052892.5", chrom: "chr16", start: 81148249 });
    expect(c.refCheck?.ok).toBe(true);
    expect(r.notes.join()).toContain("NCBI から NM_052892.5 の配列を取得");
    expect(c.warnings.join()).toContain("NM_052892.4 の hg38 アライメントと照合");
  });

  it("NM_005396.5:c.805G>C（PNLIPRP2、以前は 3 塩基ずれていた）", async () => {
    const r = await convertOne("NM_005396.5:c.805G>C");
    expect(r.candidates[0]).toMatchObject({ chrom: "chr10", start: 116631345 });
  });

  it("別バージョンに無い 5' 側の位置はエラーにする（推測しない）", async () => {
    const r = await convertOne("NM_052892.5:c.425C>T");
    expect(r.status).toBe("error");
    expect(r.message).toContain("配列が異なる 5' 側");
  });

  it("配列が異なる部分との境界付近はエラーにする", async () => {
    const r = await convertOne("NM_052892.5:c.907A>C");
    expect(r.status).toBe("error");
    expect(r.message).toContain("境界から 10 塩基以内");
  });

  it("NP_ の旧版も、NCBI のレコードからコードする NM_ を求めて計算する", async () => {
    const r = await convertOne("NP_443124.4:p.Arg1618Gln");
    expect(r.notes.join()).toContain("NM_052892.5 がコードするタンパク質");
    const c = r.candidates[0];
    expect(c.protein).toBe("NP_443124.4");
    expect(c.start).toBeLessThanOrEqual(81148249);
    expect(c.end).toBeGreaterThanOrEqual(81148249);
  });

  it("転写産物と hg38 の間の挿入・欠失の近くでは位置がずれうることを注意する（ORAI1）", async () => {
    const r = await convertOne("NM_032790.4:c.131C>T");
    expect(r.candidates[0].warnings.join()).toContain("5 塩基の挿入・欠失の差");
  });
});

describe("ミトコンドリア DNA", () => {
  it("m.3243A>G（MELAS）は chrM:3243 の MT-TL1", async () => {
    const r = await convertOne("MT-TL1:m.3243A>G");
    expect(r.status).toBe("ok");
    expect(r.format).toBe(1);
    const c = r.candidates[0];
    expect(c).toMatchObject({ chrom: "chrM", start: 3243, end: 3243, gene: "MT-TL1", transcript: "" });
    expect(c.hgvsG).toBe("NC_012920.1:m.3243A>G");
    expect(c.region).toContain("tRNA");
    expect(c.refCheck?.ok).toBe(true);
    expect(c.warnings.join()).toContain("ヘテロプラスミー");
    expect(r.notes.join()).toContain("rCRS");
    expect(r.notes.join()).not.toContain("遺伝子間領域");
  });

  it("タンパク質をコードする遺伝子（MT-ATP6）と D-loop を表示する", async () => {
    const atp6 = (await convertOne("m.8993T>G")).candidates[0];
    expect(atp6.gene).toContain("MT-ATP6");
    expect(atp6.region).toContain("ATP synthase");
    const dloop = (await convertOne("m.16519T>C")).candidates[0];
    expect(dloop.gene).toBe("");
    expect(dloop.region).toContain("D-loop");
  });

  it("入力の遺伝子名と位置の遺伝子が違えば警告する", async () => {
    const r = await convertOne("MT-ND5:m.3243A>G");
    expect(r.candidates[0].warnings.join()).toContain("一致しません");
  });

  it("hg19 の chrM は UCSC の NC_001807 と rCRS の番号の違いを警告する", async () => {
    const r = await convertOne("hg19 chrM:3243");
    expect(r.candidates[0].warnings.join()).toContain("NC_001807");
  });
});

describe("HGVS g. の 3' 側への移動", () => {
  const at = (seq: string) => (p: number) => seq[p - 1];

  it("欠失・重複は同じ塩基が続く限り右へ動かす", () => {
    // 1-based: A C T C T G
    expect(shiftGenomic3(at("ACTCTG"), "range", 2, 3)).toMatchObject({ lo: 4, hi: 5 });
    expect(shiftGenomic3(at("GAAAAC"), "range", 2, 2)).toMatchObject({ lo: 5, hi: 5 });
    expect(shiftGenomic3(at("GACTT"), "range", 2, 3)).toMatchObject({ lo: 2, hi: 3 });
  });

  it("挿入は挿入配列を回しながら右へ動かす", () => {
    // insert CT between 1 and 2 of G C T C T A → after 5, still CT
    expect(shiftGenomic3(at("GCTCTA"), "insertion", 1, 2, "CT")).toEqual({ lo: 5, hi: 6, ins: "CT" });
    // insert A between 1 and 2 of G A A C → after 3
    expect(shiftGenomic3(at("GAAC"), "insertion", 1, 2, "A")).toEqual({ lo: 3, hi: 4, ins: "A" });
  });

  it("読み込んだ配列の端で止まる", () => {
    expect(shiftGenomic3(at("GAAA"), "range", 2, 2)).toMatchObject({ lo: 4, hi: 4 });
  });
});

describe("かずさの依頼書（区分ごとのチェック）", () => {
  it("Sanger: 依頼書の記載例 CYBB NM_000397.4:c.194T>G → chrX:37783542", async () => {
    const r = await convertOne("NM_000397.4:c.194T>G");
    const c = r.candidates[0];
    expect(c).toMatchObject({ gene: "CYBB", chrom: "chrX", start: 37783542, end: 37783542 });
    expect(c.refCheck?.ok).toBe(true);
    expect(sangerLine(c)).toEqual({ text: "CYBB chrX:37783542 NM_000397.4 c.194T>G", missing: [] });
    expect(kazusaCheck(c, "sanger")).toMatchObject({ issues: [], review: false });
    expect(kazusaCheck(c, "cancer60").issues.join()).toContain("含まれません");
    expect(needsReview(r.candidates, "cancer60")).toBe(true);
    expect(needsReview(r.candidates, "sanger")).toBe(false);
  });

  it("Sanger: ゲノム位置と塩基変化の入力からも c. 表記の変化まで入る", async () => {
    const r = await convertOne("hg38, chrX:37783542 T>G");
    const c = r.candidates.find((x) => x.transcript.startsWith("NM_000397"))!;
    expect(sangerLine(c)?.text).toMatch(/^CYBB chrX:37783542 NM_000397\.\d+ c\.194T>G$/);
    expect(sangerLine(c)?.missing).toEqual([]);
  });

  it("Sanger: かずさの資料の例 ATP7B NM_000053.3:c.2903T>C → hg38 chr13:51946441", async () => {
    const r = await convertOne("NM_000053.3:c.2903T>C");
    expect(r.candidates[0]).toMatchObject({ gene: "ATP7B", chrom: "chr13", start: 51946441 });
    expect(r.candidates[0].refCheck?.ok).toBe(true);
  });

  it("Sanger: hg19 の位置だけの入力は c. 表記の変化を補うよう示す", async () => {
    const r = await convertOne("hg19, chr13:52520577");
    const c = r.candidates.find((x) => x.gene === "ATP7B")!;
    expect(c.start).toBe(51946441);
    expect(sangerLine(c)?.missing).toEqual(["c. 表記の配列の変化"]);
  });

  it("Sanger: p. 表記の入力は p. を入れ、c. 表記を補うよう示す", async () => {
    const r = await convertOne("CYBB p.Met65Arg");
    const c = r.candidates[0];
    expect(c.start).toBeLessThanOrEqual(37783542);
    expect(c.end).toBeGreaterThanOrEqual(37783542);
    const line = sangerLine(c)!;
    expect(line.text).toContain("Met65Arg");
    expect(line.missing).toEqual(["c. 表記"]);
  });

  it("Sanger: がん関連60遺伝子ならがんの依頼書を案内する", async () => {
    const r = await convertOne("NM_000249.4:c.350C>T");
    const c = r.candidates[0];
    expect(c.gene).toBe("MLH1");
    expect(c.refCheck?.ok).toBe(true);
    expect(kazusaCheck(c, "sanger").issues.join()).toContain("対象（60 遺伝子）です");
    expect(kazusaCheck(c, "sanger").review).toBe(true);
  });

  it("がん60: 遺伝子名＋9桁を作り、対象内なら注意を出さない", async () => {
    const r = await convertOne("NM_007294.4:c.68_69del");
    const c = r.candidates[0];
    expect(requestText(c, "cancer60")).toBe("BRCA1 043124030-043124031");
    expect(kazusaCheck(c, "cancer60")).toEqual({ cancer60: true, issues: [], review: false });
    expect(needsReview(r.candidates, "cancer60")).toBe(false);
  });

  it("がん60: TP53 p.Arg175His と hg38 / hg19 の位置が一致する", async () => {
    const p = await convertOne("TP53 p.Arg175His");
    const g38 = await convertOne("hg38, chr17:7675088");
    const g19 = await convertOne("hg19, chr17:7578406");
    expect(p.candidates[0].gene).toBe("TP53");
    expect(p.candidates[0].start).toBeLessThanOrEqual(7675088);
    expect(p.candidates[0].end).toBeGreaterThanOrEqual(7675088);
    expect(g19.candidates[0].start).toBe(7675088);
    expect(g38.candidates.some((c) => c.gene === "TP53" && c.hgvsC?.endsWith("c.524"))).toBe(true);
  });

  it.each([
    ["NM_007294.4:c.-20", "UTR"],
    ["NM_007294.4:c.80+20", "イントロン側へ 20 塩基"],
    ["NM_007294.4:c.68_80del", "13 塩基の欠失・挿入"],
  ])("がん60: 対象外の %s に注意を出す", async (input, message) => {
    const r = await convertOne(input);
    expect(kazusaCheck(r.candidates[0], "cancer60").issues.join()).toContain(message);
    expect(kazusaCheck(r.candidates[0], "cancer60").review).toBe(true);
  });

  it("がん60: SDHA に相同配列の注意を出す", async () => {
    const r = await convertOne("SDHA:c.91");
    expect(r.candidates[0].warnings.join()).toContain("相同領域");
    expect(kazusaCheck(r.candidates[0], "cancer60").review).toBe(true);
  });
});

describe("エラー", () => {
  it.each([
    ["FOO1:c.1A>G", /見つかりません/],
    ["NM_002253.2:c.99999A>G", /コード領域/],
    ["c.889G>A", /遺伝子名/],
  ])("%s", async (input, message) => {
    const r = await convertOne(input);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(message);
  });
});
