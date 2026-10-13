export const AA3_TO_1: Record<string, string> = {
  Ala: "A",
  Arg: "R",
  Asn: "N",
  Asp: "D",
  Cys: "C",
  Gln: "Q",
  Glu: "E",
  Gly: "G",
  His: "H",
  Ile: "I",
  Leu: "L",
  Lys: "K",
  Met: "M",
  Phe: "F",
  Pro: "P",
  Ser: "S",
  Thr: "T",
  Trp: "W",
  Tyr: "Y",
  Val: "V",
  Sec: "U",
  Ter: "*",
};

export const AA1_TO_3: Record<string, string> = Object.fromEntries(
  Object.entries(AA3_TO_1).map(([k, v]) => [v, k]),
);

export function normalizeAA(token: string): string | undefined {
  if (token.length === 3) return AA3_TO_1[token];
  if (token === "X") return "*";
  return AA1_TO_3[token] ? token : undefined;
}

const BASES = "TCAG";
const AMINO = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";

export function translateCodon(codon: string): string {
  const c = codon.toUpperCase();
  if (c.length !== 3) return "?";
  const i = BASES.indexOf(c[0]);
  const j = BASES.indexOf(c[1]);
  const k = BASES.indexOf(c[2]);
  if (i < 0 || j < 0 || k < 0) return "?";
  return AMINO[i * 16 + j * 4 + k];
}

export function aa3(aa1: string): string {
  return AA1_TO_3[aa1] ?? aa1;
}

const COMP: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N" };

export function revComp(seq: string): string {
  let out = "";
  for (let i = seq.length - 1; i >= 0; i--) out += COMP[seq[i].toUpperCase()] ?? "N";
  return out;
}
