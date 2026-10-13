import type { Assembly } from "./types";

const CHROMS = [...Array.from({ length: 22 }, (_, i) => String(i + 1)), "X", "Y"];

// RefSeq chromosome accession versions: GRCh38 is GRCh37 + 1 for every primary chromosome.
const GRCH37_VERSION: Record<string, number> = {
  "1": 10, "2": 11, "3": 11, "4": 11, "5": 9, "6": 11, "7": 13, "8": 10, "9": 11, "10": 10,
  "11": 9, "12": 11, "13": 10, "14": 8, "15": 9, "16": 9, "17": 10, "18": 9, "19": 9, "20": 10,
  "21": 8, "22": 10, X: 10, Y: 9,
};

function ncNumber(c: string): string {
  const n = c === "X" ? 23 : c === "Y" ? 24 : Number(c);
  return `NC_${String(n).padStart(6, "0")}`;
}

export function chromToNC(chrom: string, assembly: Assembly = "hg38"): string | undefined {
  const c = chrom.replace(/^chr/, "");
  if (c === "M") return "NC_012920.1";
  const v = GRCH37_VERSION[c];
  if (v === undefined) return undefined;
  return `${ncNumber(c)}.${assembly === "hg38" ? v + 1 : v}`;
}

export function ncToChrom(nc: string): { chrom: string; assembly: Assembly } | undefined {
  if (nc === "NC_012920.1") return { chrom: "chrM", assembly: "hg38" };
  for (const c of CHROMS) {
    if (chromToNC(c, "hg38") === nc) return { chrom: `chr${c}`, assembly: "hg38" };
    if (chromToNC(c, "hg19") === nc) return { chrom: `chr${c}`, assembly: "hg19" };
  }
  return undefined;
}
