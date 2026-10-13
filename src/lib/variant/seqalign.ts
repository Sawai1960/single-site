/** [aStart0, bStart0, length]: a[aStart0 + i] corresponds to b[bStart0 + i]. May contain mismatches. */
export type AlignedBlock = [number, number, number];

export interface Alignment {
  blocks: AlignedBlock[];
  /** substitutions inside blocks */
  mismatches: number;
}

const SEED = 24;
/** Equal-length gaps up to this size between two blocks are treated as substitutions, not indels. */
const MAX_MISMATCH_GAP = 30;
const MAX_RUNS = 4000;

function kmerCounts(s: string, k: number) {
  const count = new Map<string, number>();
  const pos = new Map<string, number>();
  for (let i = 0; i + k <= s.length; i++) {
    const w = s.slice(i, i + k);
    count.set(w, (count.get(w) ?? 0) + 1);
    pos.set(w, i);
  }
  return { count, pos };
}

/**
 * Colinear alignment of two versions of the same RefSeq sequence. Versions differ by
 * 5'/3' extensions, small indels, and substitutions, so unique-k-mer anchoring plus
 * chaining is enough; regions that do not align are left out of the blocks.
 */
export function alignVersions(a: string, b: string): Alignment {
  if (a === b) return { blocks: [[0, 0, a.length]], mismatches: 0 };
  const A = kmerCounts(a, SEED);
  const B = kmerCounts(b, SEED);

  const runs: AlignedBlock[] = [];
  let cur: AlignedBlock | undefined;
  for (let i = 0; i + SEED <= a.length; i++) {
    const w = a.slice(i, i + SEED);
    if (A.count.get(w) !== 1 || B.count.get(w) !== 1) continue;
    const j = B.pos.get(w)!;
    if (cur && i - cur[0] === j - cur[1] && i <= cur[0] + cur[2] - SEED + 1) {
      cur[2] = i + SEED - cur[0];
    } else {
      cur = [i, j, SEED];
      runs.push(cur);
    }
  }
  if (!runs.length) return { blocks: [], mismatches: 0 };
  if (runs.length > MAX_RUNS) runs.splice(0, runs.length, ...runs.sort((x, y) => y[2] - x[2]).slice(0, MAX_RUNS));
  runs.sort((x, y) => x[0] - y[0]);

  // Heaviest colinear chain.
  const score = runs.map((r) => r[2]);
  const prev = runs.map(() => -1);
  for (let i = 0; i < runs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (runs[j][0] + runs[j][2] <= runs[i][0] && runs[j][1] + runs[j][2] <= runs[i][1] && score[j] + runs[i][2] > score[i]) {
        score[i] = score[j] + runs[i][2];
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < runs.length; i++) if (score[i] > score[best]) best = i;
  const chain: AlignedBlock[] = [];
  for (let i = best; i >= 0; i = prev[i]) chain.unshift([...runs[i]] as AlignedBlock);

  // Extend each block over exact matches up to its neighbours.
  for (let n = 0; n < chain.length; n++) {
    const blk = chain[n];
    const left = chain[n - 1];
    const minA = left ? left[0] + left[2] : 0;
    const minB = left ? left[1] + left[2] : 0;
    while (blk[0] > minA && blk[1] > minB && a[blk[0] - 1] === b[blk[1] - 1]) {
      blk[0]--;
      blk[1]--;
      blk[2]++;
    }
    const right = chain[n + 1];
    const maxA = right ? right[0] : a.length;
    const maxB = right ? right[1] : b.length;
    while (blk[0] + blk[2] < maxA && blk[1] + blk[2] < maxB && a[blk[0] + blk[2]] === b[blk[1] + blk[2]]) blk[2]++;
  }

  // Merge neighbours separated by equal-length gaps (substitutions).
  const blocks: AlignedBlock[] = [];
  let mismatches = 0;
  for (const blk of chain) {
    const last = blocks[blocks.length - 1];
    if (last) {
      const gapA = blk[0] - (last[0] + last[2]);
      const gapB = blk[1] - (last[1] + last[2]);
      if (gapA === gapB && gapA >= 0 && gapA <= MAX_MISMATCH_GAP) {
        for (let i = 0; i < gapA; i++) if (a[last[0] + last[2] + i] !== b[last[1] + last[2] + i]) mismatches++;
        last[2] = blk[0] + blk[2] - last[0];
        continue;
      }
    }
    blocks.push(blk);
  }
  // Absorb short mismatching edges at the very ends (e.g. a substituted first/last base).
  const first = blocks[0];
  const lead = Math.min(first[0], first[1]);
  if (lead > 0 && lead <= MAX_MISMATCH_GAP && first[0] === first[1]) {
    for (let i = 0; i < lead; i++) if (a[i] !== b[i]) mismatches++;
    first[2] += lead;
    first[0] = first[1] = 0;
  }
  return { blocks, mismatches };
}

/** Maps a 0-based position in `a` to `b`, or undefined if it falls outside the aligned blocks. */
export function mapThrough(blocks: AlignedBlock[], p0: number): number | undefined {
  for (const [as, bs, len] of blocks) if (p0 >= as && p0 < as + len) return bs + (p0 - as);
  return undefined;
}
