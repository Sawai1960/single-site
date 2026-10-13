export type Assembly = "hg38" | "hg19";

export interface CPos {
  /** c.N → N, c.-N → -N, c.*N → N (with utr3 = true) */
  base: number;
  utr3: boolean;
  /** intronic offset, e.g. c.100+5 → 5, c.101-3 → -3 */
  offset: number;
}

export type ParsedQuery =
  | {
      kind: "genomic";
      assembly: Assembly;
      assemblyGiven: boolean;
      chrom: string;
      start: number;
      end: number;
      change: string;
    }
  | {
      kind: "cdna";
      target: QueryTarget;
      start: CPos;
      end: CPos;
      change: string;
      refAllele?: string;
      altAllele?: string;
      varType: VarType;
    }
  | {
      kind: "protein";
      target: QueryTarget;
      aa1?: string;
      pos1: number;
      aa2?: string;
      pos2?: number;
      change: string;
      altAA?: string;
      frameshift: boolean;
    };

export type QueryTarget =
  | { type: "transcript"; acc: string; gene?: string }
  | { type: "protein"; acc: string; gene?: string }
  | { type: "gene"; symbol: string };

export type VarType =
  | "substitution"
  | "deletion"
  | "duplication"
  | "insertion"
  | "delins"
  | "inversion"
  | "identity"
  | "position";

export interface Transcript {
  acc: string;
  gene: string;
  prot: string;
  syn: string;
  chrom: string;
  strand: "+" | "-";
  len: number;
  /** 1-based inclusive CDS range in transcript coordinates (includes stop codon) */
  cds: [number, number];
  /** [transcript 0-based start, genome 0-based start, size] in transcript order */
  blocks: [number, number, number][];
  hist: boolean;
  mane: string;
  mm: number;
}

export interface SnvCandidate {
  hgvsC: string;
  codonChange: string;
  genomicPos: number;
  genomicRef: string;
  genomicAlt: string;
}

export interface ResultCandidate {
  transcript: string;
  gene: string;
  protein: string;
  mane: string;
  historical: boolean;
  chrom: string;
  strand: "+" | "-";
  start: number;
  end: number;
  hgvsC?: string;
  hgvsP?: string;
  hgvsG?: string;
  /** genomic reference bases on + strand for start..end (truncated when long) */
  genomicRef?: string;
  /** user-supplied ref allele/residue check */
  refCheck?: { expected: string; observed: string; ok: boolean; label: string };
  genomicAlt?: string;
  codon?: string;
  snvCandidates?: SnvCandidate[];
  warnings: string[];
  ucscUrl: string;
}

export type FormatNo = 1 | 2 | 3 | 4;

export interface ConversionResult {
  input: string;
  format?: FormatNo;
  formatLabel?: string;
  status: "ok" | "warning" | "error";
  message?: string;
  normalized?: string;
  candidates: ResultCandidate[];
  notes: string[];
}
