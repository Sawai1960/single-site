import { revComp } from "./codon";
import { getRefSeqRecord, getSequence } from "./remote";
import { alignVersions, type AlignedBlock } from "./seqalign";
import type { Transcript } from "./types";

type Block = [number, number, number];

const WINDOW_GAP = 20000;

/**
 * Re-expresses a genome alignment (`blocks`, in the coordinates of sequence b) in the
 * coordinates of sequence a, given an alignment a→b. Keeps the
 * [txStart0, gStart0, size] convention of Transcript.blocks.
 */
export function composeBlocks(aln: AlignedBlock[], blocks: Block[], strand: "+" | "-"): Block[] {
  const out: Block[] = [];
  for (const [as, bs, len] of aln) {
    for (const [qs, gs, size] of blocks) {
      const x0 = Math.max(bs, qs);
      const x1 = Math.min(bs + len, qs + size);
      if (x0 >= x1) continue;
      const g = strand === "+" ? gs + (x0 - qs) : gs + (qs + size - x1);
      out.push([as + (x0 - bs), g, x1 - x0]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/**
 * The hg38 sequence of `t`'s aligned exons, concatenated in transcript orientation, with
 * blocks mapping offsets in that string back to the genome. Using the genome itself (rather
 * than the other version's mRNA) keeps differences between that mRNA and hg38 out of the result.
 */
async function splicedGenome(t: Transcript): Promise<{ seq: string; blocks: Block[] }> {
  const byGenome = [...t.blocks].sort((a, b) => a[1] - b[1]);
  const windows: [number, number][] = [];
  for (const [, gs, size] of byGenome) {
    const last = windows[windows.length - 1];
    if (last && gs - last[1] <= WINDOW_GAP) last[1] = Math.max(last[1], gs + size);
    else windows.push([gs, gs + size]);
  }
  const loaded = await Promise.all(windows.map(async ([lo, hi]) => ({ lo, hi, seq: await getSequence(t.chrom, lo + 1, hi) })));
  const parts: string[] = [];
  const blocks: Block[] = [];
  let offset = 0;
  for (const [, gs, size] of t.blocks) {
    const w = loaded.find((x) => x.lo <= gs && gs + size <= x.hi)!;
    const s = w.seq.slice(gs - w.lo, gs - w.lo + size);
    parts.push(t.strand === "+" ? s : revComp(s));
    blocks.push([offset, gs, size]);
    offset += size;
  }
  return { seq: parts.join(""), blocks };
}

function genomicOf(blocks: Block[], strand: "+" | "-", tx0: number): number | undefined {
  for (const [qs, gs, size] of blocks) {
    if (tx0 >= qs && tx0 < qs + size) return strand === "+" ? gs + (tx0 - qs) : gs + size - 1 - (tx0 - qs);
  }
  return undefined;
}

/**
 * Builds a Transcript for an NM_ version that UCSC has not aligned: its NCBI sequence is
 * aligned to the hg38 exons of a version (`sub`) that UCSC has aligned. Stretches where the
 * input differs (new exons, changed UTRs, indels) stay unaligned and cannot be mapped.
 */
export async function bridgeTranscript(acc: string, sub: Transcript): Promise<Transcript> {
  const [rec, genome] = await Promise.all([getRefSeqRecord(acc), splicedGenome(sub)]);
  if (!rec.cds) throw new Error(`${acc} の CDS 情報が NCBI のレコードにありません`);
  const aln = alignVersions(rec.seq, genome.seq);
  const blocks = composeBlocks(aln.blocks, genome.blocks, sub.strand);
  if (!blocks.length) throw new Error(`${acc} と ${sub.acc} の配列を対応付けられませんでした`);

  const edges: number[] = [];
  for (const [as, , len] of aln.blocks) {
    if (as > 0) edges.push(as + 1);
    if (as + len < rec.seq.length) edges.push(as + len);
  }
  const g = (tx1: number) => genomicOf(blocks, sub.strand, tx1 - 1);
  const s = (tx1: number) => genomicOf(sub.blocks, sub.strand, tx1 - 1);
  const identicalCds =
    rec.cds[1] - rec.cds[0] === sub.cds[1] - sub.cds[0] &&
    g(rec.cds[0]) !== undefined &&
    g(rec.cds[0]) === s(sub.cds[0]) &&
    g(rec.cds[1]) === s(sub.cds[1]);
  return {
    ...sub,
    acc,
    prot: rec.protein ?? "",
    len: rec.seq.length,
    cds: rec.cds,
    blocks,
    hist: false,
    mane: "",
    mm: aln.mismatches,
    bridge: { from: sub.acc, mismatches: aln.mismatches, identicalCds, edges },
  };
}
