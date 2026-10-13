/*
 * End-to-end tests through convertOne (the function behind /api/convert).
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
  };
});

const { convertOne } = await import("../src/lib/variant/convert");

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

describe("照合と注意表示", () => {
  it("リファレンス塩基が違う入力は要確認にする", async () => {
    const r = await convertOne("NM_002253.2:c.889C>T");
    expect(r.status).toBe("warning");
    expect(r.candidates[0].refCheck).toMatchObject({ expected: "C", observed: "G", ok: false });
  });

  it("2 塩基以上の欠失は範囲指定と特記事項の注意を出す", async () => {
    const r = await convertOne("NM_007294.4:c.68_69delAG");
    const c = r.candidates[0];
    expect([c.start, c.end]).toEqual([43124028, 43124029]);
    expect(c.refCheck?.ok).toBe(true);
    expect(c.warnings.join()).toContain("特記事項");
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
