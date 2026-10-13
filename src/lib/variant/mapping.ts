import type { CPos, Transcript } from "./types";

export class MappingError extends Error {}

/** HGVS allows c.-N / c.*N beyond the transcript ends; they continue along the genome. */
const MAX_FLANK = 50000;

/**
 * c. position (without intronic offset) → 1-based transcript coordinate.
 * May return < 1 (upstream of the transcript) or > len (downstream).
 */
export function cToTx(t: Transcript, p: CPos): number {
  const [cdsStart, cdsEnd] = t.cds;
  let tx: number;
  if (p.utr3) tx = cdsEnd + p.base;
  else if (p.base < 0) tx = cdsStart + p.base;
  else tx = cdsStart + p.base - 1;
  if (!p.utr3 && p.base > 0 && tx > cdsEnd) {
    throw new MappingError(
      `c.${p.base} はコード領域（c.1〜c.${cdsEnd - cdsStart + 1}）を超えています。3'UTR は c.*N で指定してください`,
    );
  }
  if (tx < 1 - MAX_FLANK || tx > t.len + MAX_FLANK) {
    throw new MappingError(`${formatCPos(p)} は ${t.acc}（全長 ${t.len} 塩基）から離れすぎています`);
  }
  return tx;
}

export function txToC(t: Transcript, tx: number): string {
  const [cdsStart, cdsEnd] = t.cds;
  if (tx < cdsStart) return `-${cdsStart - tx}`;
  if (tx > cdsEnd) return `*${tx - cdsEnd}`;
  return String(tx - cdsStart + 1);
}

export function formatCPos(p: CPos): string {
  const b = p.utr3 ? `*${p.base}` : String(p.base);
  const o = p.offset ? (p.offset > 0 ? `+${p.offset}` : String(p.offset)) : "";
  return `c.${b}${o}`;
}

function findBlock(t: Transcript, tx: number) {
  const p0 = tx - 1;
  for (let i = 0; i < t.blocks.length; i++) {
    const [qs, ts, size] = t.blocks[i];
    if (p0 >= qs && p0 < qs + size) return { i, qs, ts, size, off: p0 - qs };
  }
  return undefined;
}

/** 1-based transcript coordinate → 1-based genomic coordinate (+ strand) */
export function txToGenome(t: Transcript, tx: number): number {
  const b = findBlock(t, tx);
  if (!b) {
    throw new MappingError(
      `${t.acc} の転写産物位置 ${tx} はゲノムにアライメントされていません（転写産物配列とゲノム配列の差異領域）`,
    );
  }
  const g0 = t.strand === "+" ? b.ts + b.off : b.ts + b.size - 1 - b.off;
  return g0 + 1;
}

export interface MappedPos {
  genomic: number;
  warnings: string[];
}

export function cPosToGenome(t: Transcript, p: CPos): MappedPos {
  const warnings: string[] = [];
  const tx = cToTx(t, p);
  const firstAligned = t.blocks[0][0] + 1;
  const last = t.blocks[t.blocks.length - 1];
  const lastAligned = last[0] + last[2];
  if (tx < firstAligned || tx > lastAligned) {
    const upstream = tx < firstAligned;
    const edge = txToGenome(t, upstream ? firstAligned : lastAligned);
    const dist = upstream ? firstAligned - tx : tx - lastAligned;
    const dir = (upstream ? -1 : 1) * (t.strand === "+" ? 1 : -1);
    const outside = upstream ? tx < 1 : tx > t.len;
    warnings.push(
      outside
        ? `${formatCPos(p)} は ${t.acc} の転写${upstream ? "開始点より上流" : "終了点より下流"}にあるため、ゲノム上で延長して計算しました`
        : `${formatCPos(p)} は ${t.acc} の末端のゲノムに整列していない部分にあるため、ゲノム上で延長して計算しました`,
    );
    const g0 = edge + dir * dist;
    return { genomic: t.strand === "+" ? g0 + p.offset : g0 - p.offset, warnings };
  }
  const g = txToGenome(t, tx);
  if (!p.offset) return { genomic: g, warnings };
  const b = findBlock(t, tx)!;
  const p0 = tx - 1;
  const atEnd = p0 === b.qs + b.size - 1;
  const atStart = p0 === b.qs;
  if ((p.offset > 0 && !atEnd) || (p.offset < 0 && !atStart)) {
    warnings.push(
      `${formatCPos(p)} の基準位置はエクソン境界ではありません（${t.acc} のエクソン構造と一致しない可能性があります）`,
    );
  }
  return { genomic: t.strand === "+" ? g + p.offset : g - p.offset, warnings };
}

/** genomic position → c. notation for transcript (exonic or intronic), or undefined if outside */
export function genomeToC(t: Transcript, g1: number): string | undefined {
  const g0 = g1 - 1;
  let best: { dist: number; tx: number; offset: number } | undefined;
  for (const [qs, ts, size] of t.blocks) {
    if (g0 >= ts && g0 < ts + size) {
      const off = t.strand === "+" ? g0 - ts : ts + size - 1 - g0;
      return `c.${txToC(t, qs + off + 1)}`;
    }
    for (const [edgeG, edgeTx] of [
      [ts, t.strand === "+" ? qs : qs + size - 1],
      [ts + size - 1, t.strand === "+" ? qs + size - 1 : qs],
    ] as const) {
      const d = g0 - edgeG;
      const offset = t.strand === "+" ? d : -d;
      if (!best || Math.abs(d) < best.dist) best = { dist: Math.abs(d), tx: edgeTx + 1, offset };
    }
  }
  const gs = Math.min(...t.blocks.map((b) => b[1]));
  const ge = Math.max(...t.blocks.map((b) => b[1] + b[2]));
  if (!best) return undefined;
  if (g0 < gs || g0 >= ge) {
    const dist = g0 < gs ? gs - g0 : g0 - ge + 1;
    if (dist > MAX_FLANK) return undefined;
    const upstream = (g0 < gs) === (t.strand === "+");
    return `c.${txToC(t, upstream ? 1 - dist : t.len + dist)}`;
  }
  const sign = best.offset > 0 ? "+" : "";
  return `c.${txToC(t, best.tx)}${sign}${best.offset}`;
}

export function cdsLengthAA(t: Transcript): number {
  return Math.floor((t.cds[1] - t.cds[0] + 1) / 3) - 1;
}
