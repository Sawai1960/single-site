import { readFileSync } from "node:fs";
import { revComp } from "../src/lib/variant/codon";
import type { ParsedQuery } from "../src/lib/variant/types";

export interface Case {
  id: string;
  category: string;
  nm: string;
  gene: string;
  c: string;
  p: string;
  chrom: string;
  start: number;
  stop: number;
  posVcf: number;
  refVcf: string;
  altVcf: string;
  review: string;
}

export function loadCases(file: string): { source: string; cases: Case[] } {
  const lines = readFileSync(file, "utf8").split("\n");
  const source = lines[0].replace(/^# source: /, "");
  const cases = lines
    .slice(2)
    .filter(Boolean)
    .map((l) => {
      const f = l.split("\t");
      return {
        id: f[0],
        category: f[1],
        nm: f[2],
        gene: f[3],
        c: f[4],
        p: f[5],
        chrom: `chr${f[6]}`,
        start: Number(f[7]),
        stop: Number(f[8]),
        posVcf: Number(f[9]),
        refVcf: f[10],
        altVcf: f[11],
        review: f[12],
      };
    });
  return { source, cases };
}

export function applyEdit(seq: string, offset: number, start: number, end: number, insert: string): string {
  return seq.slice(0, start - offset) + insert + seq.slice(end - offset + 1);
}

/** Our interpretation of a c. indel as a genomic edit: replace [start,end] with insert (end = start-1 means pure insertion). */
export function ourEdit(
  q: Extract<ParsedQuery, { kind: "cdna" }>,
  t: { strand: "+" | "-" },
  lo: number,
  hi: number,
  ref: (a: number, b: number) => string,
) {
  const orient = (s: string) => (t.strand === "+" ? s : revComp(s));
  switch (q.varType) {
    case "deletion":
      return { start: lo, end: hi, insert: "" };
    case "duplication":
      return { start: hi + 1, end: hi, insert: ref(lo, hi) };
    case "insertion":
      return { start: hi, end: lo, insert: orient(q.altAllele ?? "") };
    case "delins":
      return { start: lo, end: hi, insert: orient(q.altAllele ?? "") };
    default:
      return undefined;
  }
}

export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}
