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
      /** set for mitochondrial m. notation; label is a gene name written before it (e.g. MT-TL1) */
      mito?: { label?: string };
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
  /**
   * Set when this version has no UCSC alignment and was placed by aligning its NCBI
   * sequence to another version (`from`) that does. Only shared stretches are mapped.
   */
  bridge?: {
    from: string;
    mismatches: number;
    identicalCds: boolean;
    /** 1-based transcript positions bordering stretches that did not align to the genome exons */
    edges: number[];
  };
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
  /** mitochondrial genome: the gene/region at this position, e.g. "tRNA-Leu（tRNA）" */
  region?: string;
  /** What to ask independent databases (NCBI, Ensembl) to cross-check this candidate */
  verify?: VerifyPlan;
  /** This tool's own round trip over the same alignment: each c. ↔ hg38 point computed in both directions */
  selfCheck?: SelfCheck;
}

export interface SelfCheckRow {
  c: string;
  pos: number;
  /** c. → hg38 for `c` */
  forward?: number;
  /** hg38 → c. for `pos` */
  reverse?: string;
  ok: boolean;
}

export interface SelfCheck {
  ok: boolean;
  rows: SelfCheckRow[];
}

/** Edit on the hg38 + strand: bases from..to (1-based) are replaced by alt; to = from - 1 is a pure insertion. */
export interface GenomicEdit {
  from: number;
  to: number;
  alt: string;
}

export interface ForwardCheck {
  /** HGVS c. sent to the external service */
  hgvs: string;
  /** this tool's genomic interpretation of `hgvs` */
  edit: GenomicEdit;
  /** position-only form, used when the service rejects the stated reference allele */
  at: { hgvs: string; from: number; to: number };
}

export interface VerifyPlan {
  /** c. → genome */
  forward: ForwardCheck[];
  /** genome → c.: the c. position this tool assigns to each genomic base */
  points: { pos: number; c: string }[];
}

export type CheckStatus = "match" | "mismatch" | "unavailable";

export interface CheckOutcome {
  status: CheckStatus;
  detail: string;
}

export interface SourceChecks {
  forward?: CheckOutcome;
  reverse?: CheckOutcome;
}

export type VerifySource = "ncbi" | "ensembl";

export interface VersionRow {
  transcript: string;
  protein: string;
  historical: boolean;
  /** placed via the NCBI sequence because UCSC has no alignment of this version */
  bridged: boolean;
  /** the version used for the main candidates */
  used: boolean;
  loci: { chrom: string; start: number; end: number }[];
  refOk?: boolean;
  error?: string;
  /** same genomic position(s) as the version used for the main candidates */
  same?: boolean;
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
  /** For NM_/NP_ given without a version: the position under every version hg38 data has */
  versions?: VersionRow[];
}
