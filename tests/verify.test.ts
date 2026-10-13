/*
 * Cross-checks against NCBI Variation Services and Ensembl VEP, replayed from tests/fixtures/external.json.
 * Re-record with: RECORD_FIXTURES=1 npx vitest run tests/verify.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const FIXTURE = path.join(__dirname, "fixtures", "external.json");
const RECORD = process.env.RECORD_FIXTURES === "1";
const recorded: Record<string, unknown> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};

type Encoded = { error: string } | { value: unknown } | { map: [string, unknown][] };

vi.mock("../src/lib/variant/remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/variant/remote")>();
  const replay =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const key = `${name}:${args.join(":")}`;
      if (key in recorded) return recorded[key] as R;
      if (!RECORD) throw new Error(`fixture missing: ${key}`);
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

vi.mock("../src/lib/variant/external-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/variant/external-api")>();
  const { ExternalError } = actual;
  const decode = (e: Encoded): unknown => {
    if ("error" in e) throw new ExternalError(e.error);
    if ("map" in e) {
      return new Map(
        e.map.map(([k, v]) => [k, v && typeof v === "object" && "error" in v ? new ExternalError((v as { error: string }).error) : v]),
      );
    }
    return e.value;
  };
  const encode = (v: unknown): Encoded =>
    v instanceof Map
      ? { map: [...v].map(([k, x]) => [k, x instanceof Error ? { error: x.message } : x]) }
      : { value: v };
  const replay =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const key = `${name}:${JSON.stringify(args)}`;
      if (key in recorded) return decode(recorded[key] as Encoded) as R;
      if (!RECORD) throw new Error(`fixture missing: ${key}`);
      try {
        const v = await fn(...args);
        recorded[key] = encode(v);
        return v;
      } catch (e) {
        if (e instanceof ExternalError) recorded[key] = { error: e.message };
        throw e;
      }
    };
  return {
    ...actual,
    ncbiHgvsContextual: replay("ncbiHgvs", actual.ncbiHgvsContextual),
    ncbiEquivalents: replay("ncbiEq", actual.ncbiEquivalents),
    ensemblVepHgvs: replay("vepHgvs", actual.ensemblVepHgvs),
    ensemblVepRegion: replay("vepRegion", actual.ensemblVepRegion),
  };
});

const { convertOne } = await import("../src/lib/variant/convert");
const { verifyItems, txToCText, describeEdit } = await import("../src/lib/variant/verify");
type Item = Parameters<typeof verifyItems>[1][number];

afterAll(() => {
  if (RECORD) writeFileSync(FIXTURE, JSON.stringify(recorded, null, 1) + "\n");
});

async function itemsFor(query: string): Promise<Item[]> {
  const r = await convertOne(query);
  return r.candidates
    .filter((c) => c.verify && c.transcript)
    .map((c) => ({ transcript: c.transcript, chrom: c.chrom, plan: c.verify! }));
}

describe("補助関数", () => {
  it("転写産物上の位置を c. 表記にする", () => {
    expect(txToCText(303, [303, 4361])).toBe("c.1");
    expect(txToCText(300, [303, 4361])).toBe("c.-3");
    expect(txToCText(4365, [303, 4361])).toBe("c.*4");
  });
  it("ゲノム上の編集を表示する", () => {
    expect(describeEdit("chr4", { from: 55113391, to: 55113391, alt: "T" })).toBe("chr4:55,113,391 → T");
    expect(describeEdit("chr13", { from: 32340301, to: 32340300, alt: "T" })).toBe("chr13:32,340,300^32,340,301 挿入 T");
    expect(describeEdit("chr7", { from: 10, to: 12, alt: "" })).toBe("chr7:10-12 欠失");
  });
});

describe("NCBI Variation Services", () => {
  it("KDR NM_002253.4:c.889G>A は順変換・逆変換とも一致", async () => {
    const [c] = await verifyItems("ncbi", await itemsFor("NM_002253.4:c.889G>A"));
    expect(c.forward).toMatchObject({ status: "match" });
    expect(c.reverse).toMatchObject({ status: "match", detail: "chr4:55,113,391 → NCBI c.889" });
  });

  it("本ツールの位置が 1 塩基ずれていれば不一致になる", async () => {
    const [item] = await itemsFor("NM_002253.4:c.889G>A");
    const f = item.plan.forward[0];
    const broken: Item = {
      ...item,
      plan: {
        forward: [{ ...f, edit: { ...f.edit, from: f.edit.from + 1, to: f.edit.to + 1 } }],
        points: [{ pos: item.plan.points[0].pos, c: "c.890" }],
      },
    };
    const [c] = await verifyItems("ncbi", [broken]);
    expect(c.forward?.status).toBe("mismatch");
    expect(c.reverse).toMatchObject({ status: "mismatch", detail: expect.stringContaining("本ツール c.890") });
  });

  it("BRAF c.1799del（欠失）は順変換が一致", async () => {
    const [c] = await verifyItems("ncbi", await itemsFor("NM_004333.6:c.1799del"));
    expect(c.forward).toMatchObject({ status: "match" });
    expect(c.reverse).toMatchObject({ status: "match" });
  });

  it("GSTT2 の旧版 NM_000854.1 は、NCBI が別の重複コピーを返すので不一致", async () => {
    const [c] = await verifyItems("ncbi", await itemsFor("NM_000854.1:c.100G>A"));
    expect(c.forward).toMatchObject({ status: "mismatch", detail: expect.stringContaining("chr22:23,961,032") });
  });

  it("イントロン内の変異は NCBI では確認不可", async () => {
    const [c] = await verifyItems("ncbi", await itemsFor("NM_000546.6:c.375+1G>A"));
    expect(c.forward).toMatchObject({ status: "unavailable", detail: expect.stringContaining("イントロン") });
    expect(c.reverse?.status).toBe("unavailable");
  });

  it("KRAS p.G12D は 1 塩基置換候補とコドン 3 塩基を照合する", async () => {
    const items = await itemsFor("NP_004976.2:p.Gly12Asp");
    expect(items[0].plan.forward.map((f) => f.hgvs)).toEqual(["NM_004985.5:c.35G>A"]);
    expect(items[0].plan.points.map((p) => p.c)).toEqual(["c.34", "c.35", "c.36"]);
    const [c] = await verifyItems("ncbi", items.slice(0, 1));
    expect(c.forward?.status).toBe("match");
    expect(c.reverse?.status).toBe("match");
  });
});

describe("Ensembl VEP（RefSeq）", () => {
  it("イントロン内の TP53 c.375+1G>A も照合できる", async () => {
    const [c] = await verifyItems("ensembl", await itemsFor("NM_000546.6:c.375+1G>A"));
    expect(c.forward).toMatchObject({ status: "match" });
    expect(c.reverse).toMatchObject({ status: "match", detail: expect.stringContaining("c.375+1") });
  });

  it("重複（dup）は Ensembl の挿入表記と配列で等価なら一致", async () => {
    const [c] = await verifyItems("ensembl", await itemsFor("NM_000059.4:c.5946dup"));
    expect(c.forward).toMatchObject({ status: "match", detail: expect.stringContaining("挿入") });
  });

  it("Ensembl に無い旧バージョンは確認不可", async () => {
    const [c] = await verifyItems("ensembl", await itemsFor("NM_002253.2:c.889G>A"));
    expect(c.forward).toMatchObject({ status: "unavailable", detail: expect.stringContaining("現行版のみ") });
    expect(c.reverse?.status).toBe("unavailable");
  });
});
