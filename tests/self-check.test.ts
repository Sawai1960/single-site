/*
 * The in-tool round trip (c. → hg38 → c.) must agree for ordinary positions, otherwise every
 * result would carry a false alarm.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { selfRoundTrip } from "../src/lib/variant/convert";
import { cPosToGenome, formatCPos } from "../src/lib/variant/mapping";
import { ensureAll, getIndex, type RefSeqIndex } from "../src/lib/variant/refseq";
import type { CPos, Transcript } from "../src/lib/variant/types";

let idx: RefSeqIndex;
beforeAll(async () => {
  idx = await getIndex();
  await ensureAll(idx);
});

/** CDS ends, UTR ends and both sides of every intron */
function samplePoints(t: Transcript): CPos[] {
  const [cs, ce] = t.cds;
  const toC = (tx: number, offset = 0): CPos =>
    tx < cs ? { base: tx - cs, utr3: false, offset } : tx > ce ? { base: tx - ce, utr3: true, offset } : { base: tx - cs + 1, utr3: false, offset };
  const pts: CPos[] = [toC(cs), toC(ce), toC(Math.floor((cs + ce) / 2))];
  if (cs > 1) pts.push(toC(1));
  if (ce < t.len) pts.push(toC(t.len));
  for (let i = 0; i + 1 < t.blocks.length; i++) {
    const [qs, ts, size] = t.blocks[i];
    const [nqs, nts] = t.blocks[i + 1];
    const gap = t.strand === "+" ? nts - (ts + size) : ts - (nts + t.blocks[i + 1][2]);
    if (nqs !== qs + size || gap < 30) continue;
    const last = qs + size;
    const next = nqs + 1;
    pts.push(toC(last), toC(last, 1), toC(last, 5), toC(next), toC(next, -1), toC(next, -5));
  }
  return pts;
}

describe("本ツール内の往復計算", () => {
  it("通常の位置では c. → hg38 → c. が一致する", () => {
    const all = [...idx.byAcc.values()].flat().filter((t) => !t.bridge && t.cds[1] > t.cds[0]);
    const sample = all.filter((_, i) => i % 25 === 0);
    const failures: string[] = [];
    let checked = 0;
    for (const t of sample) {
      const points = samplePoints(t).flatMap((p) => {
        try {
          return [{ pos: cPosToGenome(t, p).genomic, c: formatCPos(p) }];
        } catch {
          return [];
        }
      });
      checked += points.length;
      const r = selfRoundTrip(t, points);
      for (const row of r.rows) {
        if (!row.ok) failures.push(`${t.acc} ${row.c} → ${row.pos} → ${row.reverse} (forward ${row.forward})`);
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it.each([
    ["NM_000546.6", "c.524", 7675088],
    ["NM_007294.4", "c.135-5", 43106538],
  ])("%s %s が 1 塩基ずれていれば不一致になる", (acc, c, pos) => {
    const t = idx.byAcc.get(acc)![0];
    expect(selfRoundTrip(t, [{ c, pos }]).ok).toBe(true);
    expect(selfRoundTrip(t, [{ c, pos: pos + 1 }]).ok).toBe(false);
    expect(selfRoundTrip(t, [{ c, pos: pos - 1 }]).ok).toBe(false);
  });
});
