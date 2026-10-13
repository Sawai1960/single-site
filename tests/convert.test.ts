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

  it("相同領域のある遺伝子（PMS2）に注意を出す", async () => {
    const r = await convertOne("PMS2:c.137G>T");
    expect(r.candidates[0].warnings.join()).toContain("相同領域");
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
