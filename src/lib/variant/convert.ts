import { aa3, revComp, translateCodon } from "./codon";
import { chromToNC } from "./chrom";
import { cdsLengthAA, cPosToGenome, formatCPos, genomeToC, MappingError } from "./mapping";
import { ParseError, normalizeInput, parseQuery } from "./parse";
import {
  accBase,
  accVersion,
  duplicatedCopies,
  getIndex,
  overlapping,
  sortTranscripts,
  type RefSeqIndex,
} from "./refseq";
import { bridgeTranscript } from "./bridge";
import { getMitoGenes, getRefSeqRecord, getSequence, liftHg19ToHg38, type MitoFeature } from "./remote";
import type {
  ConversionResult,
  FormatNo,
  ForwardCheck,
  ParsedQuery,
  QueryTarget,
  ResultCandidate,
  SnvCandidate,
  Transcript,
  VerifyPlan,
  VersionRow,
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

function duplicationWarning(idx: RefSeqIndex, t: Transcript): string | undefined {
  if (HOMOLOGOUS_GENES.has(t.gene.toUpperCase())) return undefined;
  const d = duplicatedCopies(idx, t);
  if (!d) return undefined;
  const shown = d.copies.slice(0, 3).map((c) => {
    const genes = c.genes.length ? `（${c.genes.slice(0, 3).join("、")}）` : "";
    return `${c.chrom}:${(c.start + 1).toLocaleString("en-US")} 付近${genes}`;
  });
  const more = d.copies.length > 3 ? ` ほか ${d.copies.length - 3} か所` : "";
  return (
    `${t.gene || t.acc} のコード領域は、配列が 95% 以上同一の重複領域（分節重複）にあります: ${shown.join("、")}${more}。` +
    "データベースによって対応付けたコピーが異なることがあり、塩基の照合では区別できません。UCSC で位置と遺伝子名を確認してください"
  );
}

function transcriptWarnings(idx: RefSeqIndex, t: Transcript): string[] {
  const w: string[] = [];
  if (t.hist) w.push(`${t.acc} は旧バージョンの転写産物です。現行版とゲノム位置が異なることがあります`);
  if (t.bridge) {
    w.push(
      `${t.acc} の位置は、NCBI の配列を ${t.bridge.from} の hg38 アライメントと照合して求めました` +
        (t.bridge.identicalCds
          ? "（コード領域の番号とゲノム位置は同一です）"
          : `（コード領域の配列または番号が ${t.bridge.from} と異なります。両者で配列が同じ部分だけを計算しています）`),
    );
  }
  const aligned = t.blocks.reduce((s, b) => s + b[2], 0);
  if (t.mm > 0 || aligned < t.len) {
    w.push(`${t.acc} の配列は hg38 ゲノム配列と完全には一致しません（不一致・未整列の塩基があります）`);
  }
  if (HOMOLOGOUS_GENES.has(t.gene.toUpperCase())) {
    w.push(`${t.gene} はゲノム上に相同領域があり、解析精度を担保できず受け入れが難しい場合があります`);
  }
  const dup = duplicationWarning(idx, t);
  if (dup) w.push(dup);
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

/**
 * resolveTarget, but when the requested NM_/NP_ version has no UCSC alignment, place that
 * exact version via its NCBI sequence instead of silently substituting another version.
 * Falls back to the substitute (with a note) if NCBI cannot be used.
 */
export async function resolveTargetWithNcbi(idx: RefSeqIndex, target: QueryTarget): Promise<Resolved> {
  const r = resolveTarget(idx, target);
  if (!r.fallback || target.type === "gene" || !target.acc.includes(".")) return r;
  try {
    if (target.type === "transcript") {
      const bridged = await Promise.all(r.transcripts.map((t) => bridgeTranscript(target.acc, t)));
      return {
        transcripts: bridged,
        notes: [
          `${target.acc} は UCSC の hg38 アライメントデータに無いため、NCBI から ${target.acc} の配列を取得し、${bridged[0].bridge!.from} と照合して位置を求めました`,
        ],
        fallback: false,
      };
    }
    const np = await getRefSeqRecord(target.acc);
    if (!np.mrna) throw new Error(`${target.acc} をコードする NM_ が NCBI のレコードにありません`);
    let ts = idx.byAcc.get(np.mrna);
    const notes = [`NCBI のレコードでは ${target.acc} は ${np.mrna} がコードするタンパク質です`];
    if (!ts) {
      const subs = latestPerBase(idx.byBase.get(accBase(np.mrna)) ?? []);
      if (!subs.length) throw new Error(`${np.mrna} の転写産物が hg38 のデータにありません`);
      ts = await Promise.all(subs.map((t) => bridgeTranscript(np.mrna!, t)));
      notes.push(`${np.mrna} は UCSC の hg38 アライメントデータに無いため、NCBI の配列を ${ts[0].bridge!.from} と照合して位置を求めました`);
    }
    return { transcripts: sortTranscripts(ts.map((t) => ({ ...t, prot: target.acc }))), notes, fallback: false };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ...r, notes: [...r.notes, `NCBI の配列で照合できなかったため（${why}）、別バージョンで計算した結果を表示しています`] };
  }
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

function positionOnly(acc: string, posText: string, lo: number, hi: number): ForwardCheck {
  return { hgvs: `${acc}:${posText}del`, edit: { from: lo, to: hi, alt: "" }, at: { hgvs: `${acc}:${posText}`, from: lo, to: hi } };
}

/** The c. query as this tool places it on hg38, in a form NCBI / Ensembl can be asked about. */
function cdnaForwardCheck(q: CdnaQuery, t: Transcript, lo: number, hi: number, gRef: string | undefined): ForwardCheck {
  const posText = formatCPos(q.start) + (q.end !== q.start ? `_${formatCPos(q.end).slice(2)}` : "");
  const orient = (s: string) => (t.strand === "+" ? s : revComp(s));
  const fallback = positionOnly(t.acc, posText, lo, hi);
  const at = fallback.at;
  const hgvs = `${t.acc}:${posText}${q.change}`;
  const alt = q.altAllele && /^[ACGT]+$/.test(q.altAllele) ? q.altAllele : undefined;
  switch (q.varType) {
    case "substitution":
      return alt ? { hgvs, edit: { from: lo, to: hi, alt: orient(alt) }, at } : fallback;
    case "deletion":
      return { hgvs, edit: { from: lo, to: hi, alt: "" }, at };
    case "duplication":
      return gRef ? { hgvs, edit: { from: hi + 1, to: hi, alt: gRef }, at } : fallback;
    case "insertion":
      return alt
        ? { hgvs, edit: { from: hi, to: lo, alt: orient(alt) }, at }
        : { hgvs: `${t.acc}:${posText}insA`, edit: { from: hi, to: lo, alt: orient("A") }, at };
    case "delins":
      return alt ? { hgvs, edit: { from: lo, to: hi, alt: orient(alt) }, at } : fallback;
    default:
      return fallback;
  }
}

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
  const idx = await getIndex();
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
    const w = [...warnings, ...transcriptWarnings(idx, t)];
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
    const points = [{ pos: cPosToGenome(t, q.start).genomic, c: formatCPos(q.start) }];
    if (q.end !== q.start) points.push({ pos: cPosToGenome(t, q.end).genomic, c: formatCPos(q.end) });
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
      verify: { forward: [cdnaForwardCheck(q, t, lo, hi, gRef)], points },
    } satisfies ResultCandidate;
  });
  return { candidates, errors };
}

async function convertProtein(
  q: ProteinQuery,
  ts: Transcript[],
): Promise<{ candidates: ResultCandidate[]; errors: string[] }> {
  const idx = await getIndex();
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
    const w = transcriptWarnings(idx, t);
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
    const codonPoints = (bases: number[], p: number) => bases.map((pos, i) => ({ pos, c: `c.${3 * p - 2 + i}` }));
    const verify: VerifyPlan = {
      forward: (snvCandidates ?? []).map((s) => ({
        hgvs: `${t.acc}:${s.hgvsC}`,
        edit: { from: s.genomicPos, to: s.genomicPos, alt: s.genomicAlt },
        at: { hgvs: `${t.acc}:${s.hgvsC.replace(/[ACGT]>[ACGT]$/, "")}`, from: s.genomicPos, to: s.genomicPos },
      })),
      points: [...codonPoints(codon1, q.pos1), ...(codon2 && q.pos2 ? codonPoints(codon2, q.pos2) : [])],
    };
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
      verify,
    } satisfies ResultCandidate;
  });
  return { candidates, errors };
}

const MAX_BRIDGED_VERSIONS = 8;

/**
 * For an NM_/NP_ given without a version, computes the position under every version: those
 * aligned in the hg38 data plus, for NM_, the intermediate versions UCSC lacks (via NCBI).
 */
async function compareVersions(
  idx: RefSeqIndex,
  q: CdnaQuery | ProteinQuery,
  acc: string,
  used: Transcript[],
): Promise<{ rows: VersionRow[]; note: string; differs: boolean; complete: boolean }> {
  const isNM = q.target.type === "transcript";
  const base = accBase(acc);
  const groups = new Map<string, Transcript[]>();
  for (const t of (isNM ? idx.byBase.get(base) : idx.byProtBase.get(base)) ?? []) {
    groups.set(t.acc, [...(groups.get(t.acc) ?? []), t]);
  }
  const failed = new Map<string, string>();
  if (isNM) {
    const have = new Set([...groups.keys()].map(accVersion));
    const missing: string[] = [];
    for (let v = Math.max(...have) - 1; v >= 1 && missing.length < MAX_BRIDGED_VERSIONS; v--) {
      if (!have.has(v)) missing.push(`${base}.${v}`);
    }
    await Promise.all(
      missing.map(async (m) => {
        try {
          groups.set(m, await Promise.all(used.map((t) => bridgeTranscript(m, t))));
        } catch (e) {
          failed.set(m, e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }

  const usedAccs = new Set(used.map((t) => t.acc));
  const rows: VersionRow[] = await Promise.all(
    [...groups].map(async ([tacc, ts]) => {
      const r = q.kind === "cdna" ? await convertCdna(q, ts) : await convertProtein(q, ts);
      const loci = [...new Map(r.candidates.map((c) => [`${c.chrom}:${c.start}-${c.end}`, { chrom: c.chrom, start: c.start, end: c.end }])).values()];
      const checked = r.candidates.filter((c) => c.refCheck);
      return {
        transcript: tacc,
        protein: ts[0].prot,
        historical: ts[0].hist,
        bridged: Boolean(ts[0].bridge),
        used: usedAccs.has(tacc),
        loci,
        refOk: checked.length ? checked.some((c) => c.refCheck!.ok) : undefined,
        error: r.candidates.length ? undefined : (r.errors[0] ?? "計算できませんでした").replace(/^[^:]+: /, ""),
      };
    }),
  );
  for (const [m, why] of failed) {
    rows.push({ transcript: m, protein: "", historical: true, bridged: true, used: false, loci: [], error: `NCBI の配列で照合できませんでした（${why}）` });
  }
  const key = (r: VersionRow) => r.loci.map((l) => `${l.chrom}:${l.start}-${l.end}`).join(";");
  const usedKeys = new Set(rows.filter((r) => r.used && r.loci.length).map(key));
  for (const r of rows) if (r.loci.length) r.same = usedKeys.has(key(r));
  rows.sort((a, b) => accVersion(b.protein || b.transcript) - accVersion(a.protein || a.transcript) || accVersion(b.transcript) - accVersion(a.transcript));

  const computed = rows.filter((r) => r.loci.length);
  const distinct = new Set(computed.map(key)).size;
  const differs = distinct > 1;
  const complete = rows.every((r) => !r.error);
  const usedLabel = [...usedAccs].join("、");
  const scope = isNM ? `${base} の全 ${rows.length} バージョン` : `hg38 データにある ${base} の ${rows.length} 件（NP_ と NM_ の組み合わせ）`;
  const note = differs
    ? `バージョン番号が未指定のため、${scope}で計算したところ、ゲノム位置が ${distinct} 通りに分かれました。表示している候補は ${usedLabel} の結果です。下の表で、お手元の資料のバージョンに対応する位置を選んでください（報告書にバージョンの記載がない場合は検査会社に確認してください）`
    : complete
      ? `バージョン番号が未指定のため、${scope}で計算しました。どのバージョンでも同じゲノム位置です`
      : `バージョン番号が未指定のため、${scope}で計算しました。計算できたバージョンはすべて同じゲノム位置ですが、${rows.length - computed.length} バージョンは計算できませんでした（下の表を参照）`;
  return { rows, note, differs, complete };
}

const MITO_KIND_LABEL: Record<MitoFeature["kind"], string> = {
  tRNA: "tRNA 遺伝子",
  rRNA: "rRNA 遺伝子",
  protein: "タンパク質をコードする遺伝子",
  control: "非コード",
};

const mitoKey = (s: string) => s.toUpperCase().replace(/[-_\s]/g, "").replace(/^MT/, "");

async function mitoCandidate(
  base: Omit<ResultCandidate, "transcript" | "gene" | "protein" | "mane" | "historical" | "strand" | "warnings">,
  fromHg19: boolean,
  label: string | undefined,
  notes: string[],
  warnings: string[],
): Promise<ResultCandidate> {
  notes.push("ミトコンドリア DNA の番号は rCRS（NC_012920.1）の座標です。hg38 の chrM と同じ番号です");
  if (fromHg19) {
    warnings.push(
      "UCSC の hg19 の chrM は rCRS とは別の配列（NC_001807）で、番号がずれる位置があります。元の資料の番号が rCRS（GRCh37 の MT）か UCSC hg19 の chrM かを確認してください。rCRS の番号なら m. 表記で入力してください",
    );
  }
  let region = "";
  let gene = "";
  try {
    const hits = (await getMitoGenes()).filter((f) => f.start <= base.end && f.end >= base.start);
    gene = [...new Set(hits.filter((f) => f.kind !== "control").map((f) => f.symbol))].join(", ");
    region = hits.length
      ? hits
          .map((f) =>
            f.kind === "control"
              ? "D-loop（制御領域、非コード）"
              : `${f.symbol}: ${f.product}（${MITO_KIND_LABEL[f.kind]}${f.strand === "-" ? "、逆鎖" : ""}）`,
          )
          .join("／")
      : "遺伝子と遺伝子の間の非コード領域";
    if (label) {
      const k = mitoKey(label);
      const found = hits.some((f) => [f.symbol, f.name].some((x) => mitoKey(x) === k));
      if (!found) {
        warnings.push(
          `入力の遺伝子名 ${label} は、この位置の遺伝子（${hits.map((f) => f.symbol).join("、") || "なし"}）と一致しません。位置を確認してください`,
        );
      }
    }
  } catch {
    warnings.push("NCBI からミトコンドリアの遺伝子情報を取得できなかったため、遺伝子名を表示していません");
  }
  warnings.push(
    "ミトコンドリア DNA の変異は細胞ごとに変異の割合（ヘテロプラスミー率）が異なり、同じ家系でも組織や人によって割合が大きく違います。シングルサイト検査で変異の割合も測定できるか検査会社に確認してください",
    "核 DNA にはミトコンドリア DNA に似た配列（NUMT）があり、検査方法によっては誤検出の原因になります",
  );
  return { ...base, transcript: "", gene, protein: "", mane: "", historical: false, strand: "+", region, warnings };
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

  if (chrom === "chrM") {
    let mChange = "";
    if (refGiven && altGiven) mChange = `${refGiven}>${altGiven}`;
    else if (/^(DEL|DUP|INS|INV)/i.test(q.change)) {
      mChange = q.change.replace(/^(DELINS|DEL|DUP|INS|INV)/i, (s) => s.toLowerCase());
    }
    return [
      await mitoCandidate(
        { ...base, hgvsG: `NC_012920.1:m.${range}${mChange}` },
        q.assembly === "hg19",
        q.mito?.label,
        notes,
        warnings,
      ),
    ];
  }

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
    const posText = c1 ? `${c1}${c2 ? `_${c2.slice(2)}` : ""}` : undefined;
    let cText = posText ? `${t.acc}:${posText}` : undefined;
    let verify: VerifyPlan | undefined;
    if (posText && cText) {
      const fallback = positionOnly(t.acc, posText, start, end);
      let forward = fallback;
      if (start === end && refGiven && altGiven && refGiven.length === 1 && altGiven.length === 1) {
        cText += t.strand === "+" ? `${refGiven}>${altGiven}` : `${revComp(refGiven)}>${revComp(altGiven)}`;
        forward = { hgvs: cText, edit: { from: start, to: end, alt: altGiven }, at: fallback.at };
      }
      const points = [{ pos: t.strand === "+" ? start : end, c: c1! }];
      if (c2) points.push({ pos: t.strand === "+" ? end : start, c: c2 });
      verify = { forward: [forward], points };
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
      warnings: [...warnings, ...transcriptWarnings(idx, t).filter((x) => !x.includes("完全には一致しません"))],
      verify,
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
    let versions: VersionRow[] | undefined;
    if (q.kind === "genomic") {
      format = 1;
      candidates = await convertGenomic(q, idx, notes);
      fallback = !q.assemblyGiven;
    } else {
      format = q.target.type === "gene" ? 4 : q.kind === "cdna" ? 2 : 3;
      const resolved = await resolveTargetWithNcbi(idx, q.target);
      notes.push(...resolved.notes);
      fallback = resolved.fallback;
      checkGeneLabel(q.target, resolved.transcripts, notes);
      const r =
        q.kind === "cdna"
          ? await convertCdna(q, resolved.transcripts)
          : await convertProtein(q, resolved.transcripts);
      candidates = r.candidates;
      errors = r.errors;
      if (q.target.type !== "gene" && !q.target.acc.includes(".") && candidates.length) {
        const vc = await compareVersions(idx, q, q.target.acc, resolved.transcripts);
        versions = vc.rows;
        const i = notes.findIndex((n) => n.startsWith("バージョン番号が未指定"));
        if (i >= 0) notes.splice(i, 1);
        notes.unshift(vc.note);
        fallback = vc.differs || !vc.complete;
      }
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
      versions,
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
