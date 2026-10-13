import type { CPos, Transcript } from "./types";

export class MappingError extends Error {}

/** c. position (without intronic offset) → 1-based transcript coordinate */
export function cToTx(t: Transcript, p: CPos): number {
  const [cdsStart, cdsEnd] = t.cds;
  let tx: number;
  if (p.utr3) tx = cdsEnd + p.base;
  else if (p.base < 0) tx = cdsStart + p.base;
  else tx = cdsStart + p.base - 1;
  if (tx < 1 || tx > t.len) {
    throw new MappingError(`${formatCPos(p)} は ${t.acc}（全長 ${t.len} 塩基）の範囲外です`);
  }
  if (!p.utr3 && p.base > 0 && tx > cdsEnd) {
    throw new MappingError(
      `c.${p.base} はコード領域（c.1〜c.${cdsEnd - cdsStart + 1}）を超えています。3'UTR は c.*N で指定してください`,
    );
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
  if (!best || g0 < gs || g0 >= ge) return undefined;
  const sign = best.offset > 0 ? "+" : "";
  return `c.${txToC(t, best.tx)}${sign}${best.offset}`;
}

export function cdsLengthAA(t: Transcript): number {
  return Math.floor((t.cds[1] - t.cds[0] + 1) / 3) - 1;
}
