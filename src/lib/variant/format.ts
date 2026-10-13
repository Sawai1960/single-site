import type { ConversionResult } from "./types";

export function ninePad(n: number): string {
  return String(n).padStart(9, "0");
}

export function formatPos(n: number): string {
  return n.toLocaleString("en-US");
}

export function locusText(chrom: string, start: number, end: number): string {
  return start === end ? `${chrom}:${start}` : `${chrom}:${start}-${end}`;
}

const STATUS_LABEL = { ok: "変換成功", warning: "要確認", error: "エラー" } as const;

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultsToCsv(results: ConversionResult[]): string {
  const header = [
    "入力",
    "入力形式",
    "状態",
    "転写産物",
    "遺伝子",
    "タンパク質",
    "MANE",
    "旧バージョン",
    "染色体",
    "鎖",
    "開始(hg38)",
    "終了(hg38)",
    "開始(9桁)",
    "終了(9桁)",
    "c.表記",
    "p.表記",
    "g.表記",
    "リファレンス(+鎖)",
    "リファレンス照合",
    "注意事項",
  ];
  const rows: string[][] = [header];
  for (const r of results) {
    if (!r.candidates.length) {
      rows.push([r.input, r.formatLabel ?? "", STATUS_LABEL[r.status], ...Array(16).fill(""), [r.message, ...r.notes].filter(Boolean).join(" / ")]);
      continue;
    }
    for (const c of r.candidates) {
      rows.push([
        r.input,
        r.formatLabel ?? "",
        STATUS_LABEL[r.status],
        c.transcript,
        c.gene,
        c.protein,
        c.mane,
        c.historical ? "はい" : "",
        c.chrom,
        c.transcript ? c.strand : "",
        String(c.start),
        String(c.end),
        ninePad(c.start),
        ninePad(c.end),
        c.hgvsC ?? "",
        c.hgvsP ?? "",
        c.hgvsG ?? "",
        c.genomicRef ?? "",
        c.refCheck ? (c.refCheck.ok ? "一致" : `不一致(入力 ${c.refCheck.expected} / hg38 ${c.refCheck.observed})`) : "",
        [...r.notes, ...c.warnings].join(" / "),
      ]);
    }
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
