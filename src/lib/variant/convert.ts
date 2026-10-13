import { aa3, revComp, translateCodon } from "./codon";
import { chromToNC } from "./chrom";
import { cdsLengthAA, cPosToGenome, formatCPos, genomeToC, MappingError } from "./mapping";
import { ParseError, normalizeInput, parseQuery } from "./parse";
import { accBase, accVersion, getIndex, overlapping, sortTranscripts, type RefSeqIndex } from "./refseq";
import { getSequence, liftHg19ToHg38 } from "./remote";
import type {
  ConversionResult,
  FormatNo,
  ParsedQuery,
  QueryTarget,
  ResultCandidate,
  SnvCandidate,
  Transcript,
} from "./types";

const HOMOLOGOUS_GENES = new Set(["PMS2", "BMPR1A", "SDHD", "CHEK2", "NF1"]);
const MAX_GENOMIC_TRANSCRIPTS = 20;
const NGS_SMALL_VARIANT_LIMIT = 20;

const FORMAT_LABEL: Record<FormatNo, string> = {
  1: "形式1: ゲノム位置",
  2: "形式2: スプライシング型指定の c. 表記",
  3: "形式3: スプライシング型指定の p. 表記",
  4: "形式4: スプライシング型不明（遺伝子名）",
};

export function ucscUrl(chrom: string, start: number, end: number): string {
  const pad = Math.max(10, Math.round((end - start) * 0.2));
  const pos = `${chrom}:${Math.max(1, start - pad)}-${end + pad}`;
  const hl = encodeURIComponent(`hg38.${chrom}:${start}-${end}#FFAAAA`);
  return `https://genome-asia.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=${encodeURIComponent(pos)}&highlight=${hl}`;
}

/** Fetches the reference for a set of nearby ranges with as few requests as possible. */
async function loadSequence(chrom: string, ranges: [number, number][]) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const windows: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = windows[windows.length - 1];
    if (last && lo - last[1] <= 5000 && hi - last[0] <= 60000) last[1] = Math.max(last[1], hi);
    else windows.push([lo, hi]);
  }
  const loaded = await Promise.all(
    windows.map(async ([lo, hi]) => ({ lo, hi, seq: await getSequence(chrom, lo, hi) })),
  );
  return (lo: number, hi: number): string => {
    const w = loaded.find((x) => x.lo <= lo && hi <= x.hi);
    if (!w) throw new Error("sequence window missing");
    return w.seq.slice(lo - w.lo, hi - w.lo + 1);
  };
}

type SeqAccessor = Awaited<ReturnType<typeof loadSequence>>;

function transcriptWarnings(t: Transcript): string[] {
  const w: string[] = [];
  if (t.hist) w.push(`${t.acc} は旧バージョンの転写産物です。現行版とゲノム位置が異なることがあります`);
  const aligned = t.blocks.reduce((s, b) => s + b[2], 0);
  if (t.mm > 0 || aligned < t.len) {
    w.push(`${t.acc} の配列は hg38 ゲノム配列と完全には一致しません（不一致・未整列の塩基があります）`);
  }
  if (HOMOLOGOUS_GENES.has(t.gene.toUpperCase())) {
    w.push(`${t.gene} はゲノム上に相同領域があり、解析精度を担保できず受け入れが難しい場合があります`);
  }
  return w;
}

interface Resolved {
  transcripts: Transcript[];
  notes: string[];
  fallback: boolean;
}

function latestPerBase(ts: Transcript[]): Transcript[] {
  const best = new Map<string, Transcript>();
  for (const t of ts) {
    const k = `${accBase(t.acc)}|${t.chrom}`;
    const cur = best.get(k);
    if (!cur || (cur.hist && !t.hist) || (cur.hist === t.hist && accVersion(t.acc) > accVersion(cur.acc))) {
      best.set(k, t);
    }
  }
  const keep = new Set([...best.values()].map((t) => t.acc));
  return ts.filter((t) => keep.has(t.acc));
}

export function resolveTarget(idx: RefSeqIndex, target: QueryTarget): Resolved {
  const notes: string[] = [];
  if (target.type === "transcript") {
    const hasVersion = target.acc.includes(".");
    const exact = hasVersion ? idx.byAcc.get(target.acc) : undefined;
    if (exact) return { transcripts: exact, notes, fallback: false };
    const all = idx.byBase.get(accBase(target.acc));
    if (!all) throw new MappingError(`${target.acc} は hg38 の RefSeq データに見つかりません`);
    const chosen = latestPerBase(all);
    notes.push(
      hasVersion
        ? `${target.acc} は hg38 にアライメントされたデータがないため、${chosen[0].acc} で計算しました。バージョンが違うとゲノム位置が変わることがあります`
        : `バージョン番号が未指定のため ${chosen[0].acc} で計算しました`,
    );
    return { transcripts: chosen, notes, fallback: true };
  }
  if (target.type === "protein") {
    const hasVersion = target.acc.includes(".");
    const exact = hasVersion ? idx.byProt.get(target.acc) : undefined;
    if (exact) return { transcripts: sortTranscripts(latestPerBase(exact)), notes, fallback: false };
    const all = idx.byProtBase.get(accBase(target.acc));
    if (!all) throw new MappingError(`${target.acc} に対応する転写産物（NM_）が見つかりません`);
    const maxV = Math.max(...all.map((t) => accVersion(t.prot)));
    const chosen = sortTranscripts(latestPerBase(all.filter((t) => accVersion(t.prot) === maxV)));
    notes.push(
      hasVersion
        ? `${target.acc} に対応する転写産物がないため、${chosen[0].prot}（${chosen[0].acc}）で計算しました。アミノ酸番号が変わっていないか確認してください`
        : `バージョン番号が未指定のため ${chosen[0].prot}（${chosen[0].acc}）で計算しました`,
    );
    return { transcripts: chosen, notes, fallback: true };
  }
  const direct = idx.byGene.get(target.symbol)?.filter((t) => !t.hist);
  if (direct?.length) return { transcripts: sortTranscripts(direct), notes, fallback: false };
  const syn = idx.bySynonym.get(target.symbol);
  if (syn?.length) {
    const genes = [...new Set(syn.map((t) => t.gene))];
    notes.push(`${target.symbol} は ${genes.join(", ")} の別名として扱いました。遺伝子名を確認してください`);
    return { transcripts: sortTranscripts(syn), notes, fallback: true };
  }
  throw new MappingError(`遺伝子名 ${target.symbol} は RefSeq（NM_）データに見つかりません`);
}

function checkGeneLabel(target: QueryTarget, ts: Transcript[], notes: string[]) {
  if (target.type === "gene" || !target.gene) return;
  const genes = new Set(ts.map((t) => t.gene.toUpperCase()));
  if (!genes.has(target.gene.toUpperCase())) {
    notes.push(`括弧内の遺伝子名 ${target.gene} と、${target.acc} の遺伝子 ${[...genes].join(", ")} が一致しません`);
  }
}

function hgvsGChange(
  q: Extract<ParsedQuery, { kind: "cdna" }>,
  strand: "+" | "-",
  gRef: string | undefined,
): string {
  const orient = (s: string) => (strand === "+" ? s : revComp(s));
  switch (q.varType) {
    case "substitution":
      return gRef && q.altAllele ? `${gRef}>${orient(q.altAllele)}` : "";
    case "deletion":
      return "del";
    case "duplication":
      return "dup";
    case "insertion":
      return q.altAllele && /^[ACGT]+$/.test(q.altAllele) ? `ins${orient(q.altAllele)}` : "ins";
    case "delins":
      return q.altAllele && /^[ACGT]+$/.test(q.altAllele) ? `delins${orient(q.altAllele)}` : "delins";
    case "inversion":
      return "inv";
    case "identity":
      return "=";
    default:
      return "";
  }
}

type CdnaQuery = Extract<ParsedQuery, { kind: "cdna" }>;
type ProteinQuery = Extract<ParsedQuery, { kind: "protein" }>;

/** c. range → genomic range on hg38 (+ strand, 1-based inclusive). Throws MappingError. */
export function mapCdna(q: CdnaQuery, t: Transcript): { lo: number; hi: number; warnings: string[] } {
  const a = cPosToGenome(t, q.start);
  const b = q.end === q.start ? a : cPosToGenome(t, q.end);
  if ((t.strand === "+" && b.genomic < a.genomic) || (t.strand === "-" && b.genomic > a.genomic)) {
    throw new MappingError("範囲の終了位置が開始位置より前です");
  }
  const warnings = [...new Set([...a.warnings, ...b.warnings])];
  if (q.varType === "insertion" && Math.abs(b.genomic - a.genomic) > 1) {
    // Flanking bases sit in different exons: place the insertion just before the 3' exon, as ClinVar/NCBI do.
    warnings.push("挿入位置がエクソン境界にあるため、3' 側エクソンの直前への挿入として計算しました");
    return t.strand === "+"
      ? { lo: b.genomic - 1, hi: b.genomic, warnings }
      : { lo: b.genomic, hi: b.genomic + 1, warnings };
  }
  return {
    lo: Math.min(a.genomic, b.genomic),
    hi: Math.max(a.genomic, b.genomic),
    warnings,
  };
}

/** Genomic positions of the codon(s) named in a p. query, in transcript order. Throws MappingError. */
export function mapProtein(q: ProteinQuery, t: Transcript): { codon1: number[]; codon2?: number[] } {
  const lastPos = q.pos2 ?? q.pos1;
  const n = cdsLengthAA(t);
  if (lastPos > n + 1) {
    throw new MappingError(`アミノ酸位置 ${lastPos} はタンパク質の長さ（${n} 残基）を超えています`);
  }
  const codonGenomic = (p: number) =>
    [0, 1, 2].map((i) => cPosToGenome(t, { base: 3 * p - 2 + i, utr3: false, offset: 0 }).genomic);
  return { codon1: codonGenomic(q.pos1), codon2: q.pos2 ? codonGenomic(q.pos2) : undefined };
}

async function convertCdna(
  q: CdnaQuery,
  ts: Transcript[],
): Promise<{ candidates: ResultCandidate[]; errors: string[] }> {
  const errors: string[] = [];
  const mapped: { t: Transcript; lo: number; hi: number; warnings: string[] }[] = [];
  for (const t of ts) {
    try {
      mapped.push({ t, ...mapCdna(q, t) });
    } catch (e) {
      if (e instanceof MappingError) errors.push(`${t.acc}: ${e.message}`);
      else throw e;
    }
  }

  const byChrom = new Map<string, [number, number][]>();
  for (const m of mapped) {
    const arr = byChrom.get(m.t.chrom) ?? [];
    if (m.hi - m.lo < 300) arr.push([m.lo, m.hi]);
    byChrom.set(m.t.chrom, arr);
  }
  const seqs = new Map<string, SeqAccessor | null>();
  await Promise.all(
    [...byChrom].map(async ([chrom, ranges]) => {
      try {
        seqs.set(chrom, ranges.length ? await loadSequence(chrom, ranges) : null);
      } catch {
        seqs.set(chrom, null);
      }
    }),
  );

  const cText =
    formatCPos(q.start) + (q.end !== q.start ? `_${formatCPos(q.end).slice(2)}` : "") + q.change;

  const candidates = mapped.map(({ t, lo, hi, warnings }) => {
    const w = [...warnings, ...transcriptWarnings(t)];
    const acc = seqs.get(t.chrom);
    let gRef: string | undefined;
    if (acc && hi - lo < 300) gRef = acc(lo, hi);
    else if (hi - lo < 300) w.push("参照配列を取得できなかったため、塩基の照合を行っていません");

    let refCheck: ResultCandidate["refCheck"];
    if (gRef && q.refAllele && q.varType !== "insertion") {
      const observed = t.strand === "+" ? gRef : revComp(gRef);
      const ok = observed === q.refAllele;
      refCheck = { expected: q.refAllele, observed, ok, label: "リファレンス塩基（転写産物の向き）" };
      if (!ok) {
        w.unshift(
          `入力のリファレンス塩基 ${q.refAllele} と hg38 の塩基 ${observed} が一致しません。転写産物の番号・バージョンを確認してください`,
        );
      }
    }
    const len = hi - lo + 1;
    if (["deletion", "duplication", "delins", "inversion"].includes(q.varType) && len > 1) {
      w.push(
        `${len} 塩基の範囲です。依頼書には範囲内のどの位置を指定しても構いません。特記事項欄に変異の内容（${cText}）を記入してください`,
      );
    }
    if (len > NGS_SMALL_VARIANT_LIMIT && q.varType !== "position") {
      w.push(`${NGS_SMALL_VARIANT_LIMIT} 塩基を超える欠失・重複などは、精度を担保できず確定に至らない場合があります`);
    }
    const nc = chromToNC(t.chrom);
    const gPos = lo === hi ? `${lo}` : `${lo}_${hi}`;
    const gChange = hgvsGChange(q, t.strand, gRef);
    return {
      transcript: t.acc,
      gene: t.gene,
      protein: t.prot,
      mane: t.mane,
      historical: t.hist,
      chrom: t.chrom,
      strand: t.strand,
      start: lo,
      end: hi,
      hgvsC: `${t.acc}:${cText}`,
      hgvsG: nc ? `${nc}:g.${gPos}${gChange}` : undefined,
      genomicRef: gRef,
      genomicAlt:
        q.varType === "substitution" && q.altAllele
          ? t.strand === "+"
            ? q.altAllele
            : revComp(q.altAllele)
          : undefined,
      refCheck,
      warnings: [...new Set(w)],
      ucscUrl: ucscUrl(t.chrom, lo, hi),
    } satisfies ResultCandidate;
  });
  return { candidates, errors };
}

async function convertProtein(
  q: ProteinQuery,
  ts: Transcript[],
): Promise<{ candidates: ResultCandidate[]; errors: string[] }> {
  const errors: string[] = [];
  const lastPos = q.pos2 ?? q.pos1;
  const mapped: { t: Transcript; codon1: number[]; codon2?: number[] }[] = [];
  for (const t of ts) {
    try {
      mapped.push({ t, ...mapProtein(q, t) });
    } catch (e) {
      if (e instanceof MappingError) errors.push(`${t.acc}（${t.prot}）: ${e.message}`);
      else throw e;
    }
  }

  const byChrom = new Map<string, [number, number][]>();
  for (const m of mapped) {
    const arr = byChrom.get(m.t.chrom) ?? [];
    for (const g of [...m.codon1, ...(m.codon2 ?? [])]) arr.push([g, g]);
    byChrom.set(m.t.chrom, arr);
  }
  const seqs = new Map<string, SeqAccessor | null>();
  await Promise.all(
    [...byChrom].map(async ([chrom, ranges]) => {
      try {
        seqs.set(chrom, await loadSequence(chrom, ranges));
      } catch {
        seqs.set(chrom, null);
      }
    }),
  );

  const candidates = mapped.map(({ t, codon1, codon2 }) => {
    const w = transcriptWarnings(t);
    const all = [...codon1, ...(codon2 ?? [])];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const seq = seqs.get(t.chrom);
    const base = (g: number) => {
      const b = seq!(g, g);
      return t.strand === "+" ? b : revComp(b);
    };
    let codon: string | undefined;
    let refCheck: ResultCandidate["refCheck"];
    let snvCandidates: SnvCandidate[] | undefined;
    if (seq) {
      codon = codon1.map(base).join("");
      const observed = translateCodon(codon);
      const failures: string[] = [];
      if (q.aa1) {
        refCheck = { expected: aa3(q.aa1), observed: aa3(observed), ok: observed === q.aa1, label: "リファレンスのアミノ酸" };
        if (observed !== q.aa1) failures.push(`${q.pos1} 番目は ${aa3(observed)}（コドン ${codon}）で、入力の ${aa3(q.aa1)} と一致しません`);
      }
      if (codon2 && q.aa2) {
        const c2 = codon2.map(base).join("");
        const o2 = translateCodon(c2);
        if (o2 !== q.aa2) {
          failures.push(`${q.pos2} 番目は ${aa3(o2)}（コドン ${c2}）で、入力の ${aa3(q.aa2)} と一致しません`);
          if (refCheck) refCheck.ok = false;
        }
      }
      if (failures.length) {
        w.unshift(`${failures.join("。")}。NP 番号・バージョンやアミノ酸番号を確認してください`);
      }
      if (q.altAA && !q.frameshift && !q.pos2 && q.altAA !== observed) {
        snvCandidates = [];
        for (let i = 0; i < 3; i++) {
          for (const nb of "ACGT") {
            if (nb === codon[i]) continue;
            const mut = codon.slice(0, i) + nb + codon.slice(i + 1);
            if (translateCodon(mut) !== q.altAA) continue;
            const cpos = 3 * q.pos1 - 2 + i;
            const g = codon1[i];
            snvCandidates.push({
              hgvsC: `c.${cpos}${codon[i]}>${nb}`,
              codonChange: `${codon}→${mut}`,
              genomicPos: g,
              genomicRef: t.strand === "+" ? codon[i] : revComp(codon[i]),
              genomicAlt: t.strand === "+" ? nb : revComp(nb),
            });
          }
        }
        if (!snvCandidates.length) {
          w.push(`${aa3(observed)}→${aa3(q.altAA)} は 1 塩基置換では起こりません。複数塩基の変化の可能性があります`);
        }
      }
    } else {
      w.push("参照配列を取得できなかったため、アミノ酸の照合を行っていません");
    }
    if (q.frameshift) {
      w.push(
        "フレームシフト変異のため、アミノ酸表記だけでは塩基レベルの変化を特定できません。表示はコドン範囲です。c. 表記が分かる場合はそちらで確認してください",
      );
    }
    const cFirst = 3 * q.pos1 - 2;
    const cLast = 3 * lastPos;
    const pText = `p.${q.aa1 ? aa3(q.aa1) : ""}${q.pos1}${q.pos2 ? `_${q.aa2 ? aa3(q.aa2) : ""}${q.pos2}` : ""}${q.change}`;
    const spliced = hi - lo + 1 > cLast - cFirst + 1;
    if (spliced) w.push("コドンがエクソン境界をまたいでいます。表示範囲にはイントロンが含まれます");
    return {
      transcript: t.acc,
      gene: t.gene,
      protein: t.prot,
      mane: t.mane,
      historical: t.hist,
      chrom: t.chrom,
      strand: t.strand,
      start: lo,
      end: hi,
      hgvsP: `${t.prot}:${pText}`,
      hgvsC: `${t.acc}:c.${cFirst}_${cLast}（コドン範囲）`,
      codon,
      refCheck,
      snvCandidates,
      warnings: [...new Set(w)],
      ucscUrl: ucscUrl(t.chrom, lo, hi),
    } satisfies ResultCandidate;
  });
  return { candidates, errors };
}

async function convertGenomic(
  q: Extract<ParsedQuery, { kind: "genomic" }>,
  idx: RefSeqIndex,
  notes: string[],
): Promise<ResultCandidate[]> {
  let { chrom, start, end } = q;
  if (!q.assemblyGiven) {
    notes.push("リファレンスゲノムのバージョンが未指定のため hg38 として扱いました");
  }
  if (q.assembly === "hg19") {
    const lifted = await liftHg19ToHg38(chrom, start, end);
    notes.push(
      `hg19 ${chrom}:${start}${end > start ? `-${end}` : ""} を hg38 ${lifted.chrom}:${lifted.start}${lifted.end > lifted.start ? `-${lifted.end}` : ""} に変換しました（Ensembl assembly mapping）`,
    );
    ({ chrom, start, end } = lifted);
  }
  const warnings: string[] = [];
  let gRef: string | undefined;
  if (end - start < 300) {
    try {
      gRef = await getSequence(chrom, start, end);
    } catch {
      warnings.push("参照配列を取得できなかったため、塩基の照合を行っていません");
    }
  }
  let refCheck: ResultCandidate["refCheck"];
  const refGiven = q.change.match(/^([ACGT]+)/)?.[1];
  if (gRef && refGiven) {
    const ok = refGiven === gRef;
    refCheck = { expected: refGiven, observed: gRef, ok, label: "リファレンス塩基（+鎖）" };
    if (!ok) {
      warnings.unshift(
        `入力の塩基 ${refGiven} と hg38 の塩基 ${gRef} が一致しません。ゲノムバージョン（hg19/hg38）を確認してください`,
      );
    }
  }
  const altGiven = q.change.match(/>([ACGT]+)$/)?.[1];
  const nc = chromToNC(chrom);
  const range = start === end ? `${start}` : `${start}_${end}`;
  const base = {
    chrom,
    start,
    end,
    genomicRef: gRef,
    genomicAlt: altGiven,
    refCheck,
    hgvsG: nc ? `${nc}:g.${range}${refGiven && altGiven ? `${refGiven}>${altGiven}` : ""}` : undefined,
    ucscUrl: ucscUrl(chrom, start, end),
  };

  const ts = sortTranscripts(overlapping(idx, chrom, start)).slice(0, MAX_GENOMIC_TRANSCRIPTS);
  if (!ts.length) {
    notes.push("この位置に重なる RefSeq 転写産物（NM_）はありません（遺伝子間領域の可能性）");
    return [
      { ...base, transcript: "", gene: "", protein: "", mane: "", historical: false, strand: "+", warnings },
    ];
  }
  return ts.map((t) => {
    const c1 = genomeToC(t, t.strand === "+" ? start : end);
    const c2 = start === end ? undefined : genomeToC(t, t.strand === "+" ? end : start);
    let cText = c1 ? `${t.acc}:${c1}${c2 ? `_${c2.slice(2)}` : ""}` : undefined;
    if (cText && start === end && refGiven && altGiven && refGiven.length === 1 && altGiven.length === 1) {
      cText += t.strand === "+" ? `${refGiven}>${altGiven}` : `${revComp(refGiven)}>${revComp(altGiven)}`;
    }
    return {
      ...base,
      transcript: t.acc,
      gene: t.gene,
      protein: t.prot,
      mane: t.mane,
      historical: t.hist,
      strand: t.strand,
      hgvsC: cText,
      warnings: [...warnings, ...transcriptWarnings(t).filter((x) => !x.includes("完全には一致しません"))],
    };
  });
}

export async function convertOne(raw: string): Promise<ConversionResult> {
  const input = normalizeInput(raw);
  const notes: string[] = [];
  let format: FormatNo | undefined;
  try {
    const q = parseQuery(input);
    const idx = await getIndex();
    let candidates: ResultCandidate[];
    let errors: string[] = [];
    let fallback = false;
    if (q.kind === "genomic") {
      format = 1;
      candidates = await convertGenomic(q, idx, notes);
      fallback = !q.assemblyGiven;
    } else {
      format = q.target.type === "gene" ? 4 : q.kind === "cdna" ? 2 : 3;
      const resolved = resolveTarget(idx, q.target);
      notes.push(...resolved.notes);
      fallback = resolved.fallback;
      checkGeneLabel(q.target, resolved.transcripts, notes);
      const r =
        q.kind === "cdna"
          ? await convertCdna(q, resolved.transcripts)
          : await convertProtein(q, resolved.transcripts);
      candidates = r.candidates;
      errors = r.errors;
      const perTranscript = new Map<string, number>();
      for (const c of candidates) perTranscript.set(c.transcript, (perTranscript.get(c.transcript) ?? 0) + 1);
      for (const c of candidates) {
        const n = perTranscript.get(c.transcript)!;
        if (n > 1) {
          c.warnings.push(
            `${c.transcript} はゲノム上の ${n} か所にアライメントされています（多コピー遺伝子・偽常染色体領域など）。すべての候補を確認してください`,
          );
        }
      }
      if (q.kind === "protein") {
        notes.push(
          "古くから知られる変異では、シグナル配列を除いた成熟型タンパク質の番号で表記されていることがあります。その場合はシグナル配列を含む番号に直してから入力してください",
        );
      }
      const mismatched = (c: ResultCandidate) => Boolean(c.refCheck && !c.refCheck.ok);
      candidates = [...candidates.filter((c) => !mismatched(c)), ...candidates.filter(mismatched)];
      if (format === 4 && candidates.length > 1) {
        const consistent = candidates.filter((c) => !mismatched(c));
        const pool = consistent.length ? consistent : candidates;
        const distinct = new Set(pool.map((c) => `${c.chrom}:${c.start}-${c.end}`));
        const skipped = candidates.length - consistent.length;
        const suffix =
          consistent.length && skipped
            ? `（リファレンスが一致しない ${skipped} 件は末尾に表示）`
            : "";
        notes.unshift(
          distinct.size > 1
            ? `転写産物によってゲノム位置が ${distinct.size} 通りに分かれます${suffix}。お手元の情報（NM_/NP_ 番号）と照合して選んでください`
            : `リファレンスが一致する転写産物はすべて同じゲノム位置になりました${suffix}`,
        );
      }
    }
    if (!candidates.length) {
      return {
        input,
        format,
        formatLabel: format ? FORMAT_LABEL[format] : undefined,
        status: "error",
        message: errors[0] ?? "変換できる転写産物がありませんでした",
        candidates: [],
        notes: [...notes, ...errors.slice(1)],
      };
    }
    if (errors.length) notes.push(...errors.map((e) => `変換できなかった候補 — ${e}`));
    const refFail = candidates.every((c) => c.refCheck && !c.refCheck.ok);
    return {
      input,
      format,
      formatLabel: FORMAT_LABEL[format],
      status: refFail || fallback ? "warning" : "ok",
      candidates,
      notes,
    };
  } catch (e) {
    if (e instanceof ParseError || e instanceof MappingError) {
      return {
        input,
        format,
        formatLabel: format ? FORMAT_LABEL[format] : undefined,
        status: "error",
        message: e.message,
        candidates: [],
        notes,
      };
    }
    return {
      input,
      format,
      formatLabel: format ? FORMAT_LABEL[format] : undefined,
      status: "error",
      message: e instanceof Error ? e.message : String(e),
      candidates: [],
      notes,
    };
  }
}

export async function convertMany(lines: string[], concurrency = 3): Promise<ConversionResult[]> {
  const out: ConversionResult[] = new Array(lines.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, lines.length) }, async () => {
      while (next < lines.length) {
        const i = next++;
        out[i] = await convertOne(lines[i]);
      }
    }),
  );
  return out;
}
