import { getRefSeqRecord } from "./remote";
import { alignVersions, type AlignedBlock } from "./seqalign";
import type { Transcript } from "./types";

type Block = [number, number, number];

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

function genomicOf(blocks: Block[], strand: "+" | "-", tx0: number): number | undefined {
  for (const [qs, gs, size] of blocks) {
    if (tx0 >= qs && tx0 < qs + size) return strand === "+" ? gs + (tx0 - qs) : gs + size - 1 - (tx0 - qs);
  }
  return undefined;
}

/**
 * Builds a Transcript for an NM_ version that UCSC has not aligned, by aligning its NCBI
 * sequence to the mRNA of a version (`sub`) that UCSC has aligned and reusing that
 * alignment's exon structure. Versions usually differ far less from each other than from
 * hg38 (e.g. KIR alleles), so mRNA-to-mRNA is the robust comparison. Stretches where the
 * versions differ (new exons, changed UTRs, indels) stay unaligned and cannot be mapped.
 */
export async function bridgeTranscript(acc: string, sub: Transcript): Promise<Transcript> {
  const [rec, subRec] = await Promise.all([getRefSeqRecord(acc), getRefSeqRecord(sub.acc)]);
  if (!rec.cds) throw new Error(`${acc} の CDS 情報が NCBI のレコードにありません`);
  if (subRec.seq.length !== sub.len) {
    throw new Error(`${sub.acc} の NCBI 配列長が UCSC のデータと一致しません`);
  }
  const aln = alignVersions(rec.seq, subRec.seq);
  const blocks = composeBlocks(aln.blocks, sub.blocks, sub.strand);
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
    mm: sub.mm + aln.mismatches,
    bridge: { from: sub.acc, mismatches: aln.mismatches, identicalCds, edges },
  };
}
