import { describe, expect, it } from "vitest";
import { composeBlocks } from "../src/lib/variant/bridge";
import { alignVersions, mapThrough } from "../src/lib/variant/seqalign";

// Deterministic pseudo-random sequence so k-mers are unique.
function randomSeq(n: number, seed = 1): string {
  let s = seed;
  let out = "";
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out += "ACGT"[s >>> 30];
  }
  return out;
}

describe("バージョン間の配列アラインメント", () => {
  const base = randomSeq(600);

  it("同一配列は 1 ブロック", () => {
    expect(alignVersions(base, base)).toEqual({ blocks: [[0, 0, 600]], mismatches: 0 });
  });

  it("5' 側の延長: 位置がずれて対応する", () => {
    const a = randomSeq(40, 7) + base;
    const { blocks } = alignVersions(a, base);
    expect(mapThrough(blocks, 40)).toBe(0);
    expect(mapThrough(blocks, 639)).toBe(599);
    expect(mapThrough(blocks, 10)).toBeUndefined();
  });

  it("1 塩基置換は同じブロックにまとめ、置換数を数える", () => {
    const a = base.slice(0, 300) + (base[300] === "A" ? "C" : "A") + base.slice(301);
    const r = alignVersions(a, base);
    expect(r.blocks).toEqual([[0, 0, 600]]);
    expect(r.mismatches).toBe(1);
  });

  it("欠失の前後は別ブロックになり、後ろは欠失分ずれる", () => {
    const a = base.slice(0, 300) + base.slice(306);
    const { blocks } = alignVersions(a, base);
    expect(blocks.length).toBe(2);
    expect(mapThrough(blocks, 100)).toBe(100);
    expect(mapThrough(blocks, 400)).toBe(406);
  });

  it("配列の対応とゲノムのアライメントを合成する（- 鎖）", () => {
    // b: two exons of 100 bases on the - strand at genome 5000..5099 and 1000..1099
    const blocks = composeBlocks([[10, 0, 200]], [[0, 5000, 100], [100, 1000, 100]], "-");
    expect(blocks).toEqual([
      [10, 5000, 100],
      [110, 1000, 100],
    ]);
  });
});
