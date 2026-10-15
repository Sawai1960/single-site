"use client";

import { Loader2 } from "lucide-react";
import type { VerificationSummary } from "@/components/verification";
import { cn } from "@/lib/utils";
import type { KazusaMode } from "@/lib/variant/kazusa";
import { planEntries } from "@/lib/variant/request-form";
import type { ConversionResult } from "@/lib/variant/types";

type ResultStatus = ConversionResult["status"];

const STATUS: Record<ResultStatus, { label: string; className: string }> = {
  ok: { label: "成功", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  warning: { label: "要確認", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  error: { label: "エラー", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const CHECK: Record<VerificationSummary, { label: string; className: string }> = {
  none: { label: "—", className: "text-muted-foreground" },
  pending: { label: "照合中", className: "text-muted-foreground" },
  unchecked: { label: "未照合", className: "text-amber-700 dark:text-amber-400" },
  match: { label: "一致", className: "text-emerald-700 dark:text-emerald-400" },
  partial: { label: "一部のみ確認", className: "text-amber-700 dark:text-amber-400" },
  unavailable: { label: "確認不可", className: "text-amber-700 dark:text-amber-400" },
  mismatch: { label: "不一致", className: "font-semibold text-destructive" },
};

export function SummaryTable({
  results,
  mode,
  statuses,
  summaries,
}: {
  results: ConversionResult[];
  mode: KazusaMode;
  statuses: ResultStatus[];
  summaries: VerificationSummary[];
}) {
  const plan = planEntries(
    results,
    mode,
    results.map((_, i) => ({ warning: statuses[i] === "warning", mismatch: summaries[i] === "mismatch" })),
  );

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-8 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">入力</th>
            <th className="px-3 py-2 font-medium">遺伝子</th>
            <th className="px-3 py-2 font-medium">{mode === "sanger" ? "依頼書に書く内容（1行）" : "hg38 の位置（9 桁）"}</th>
            <th className="px-3 py-2 font-medium">変換</th>
            <th className="px-3 py-2 font-medium">外部照合</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const entry = plan.entries.find((e) => e.index === i);
            const skip = plan.skipped.find((s) => s.index === i);
            const top = r.candidates[0];
            const note = r.status === "error" ? r.message : (skip?.reason ?? entry?.notes[0]);
            const check = CHECK[summaries[i]];
            return (
              <tr key={i} className="border-t align-top">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-mono text-xs break-all">{r.input}</td>
                <td className="px-3 py-2 font-semibold">{entry?.gene ?? top?.gene ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className={cn("font-mono", mode === "sanger" ? "text-xs break-all" : "text-base font-semibold")}>
                    {entry
                      ? mode === "sanger"
                        ? entry.text
                        : String(entry.pos).padStart(9, "0")
                      : top
                        ? <span className="text-muted-foreground">{`${top.chrom}:${top.start}`}</span>
                        : "—"}
                  </div>
                  {note && (
                    <div className={cn("mt-0.5 text-xs", skip || r.status === "error" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                      {note}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[statuses[i]].className)}>
                    {STATUS[statuses[i]].label}
                  </span>
                </td>
                <td className={cn("px-3 py-2 text-xs whitespace-nowrap", check.className)}>
                  {summaries[i] === "pending" && <Loader2 className="mr-1 inline size-3 animate-spin" />}
                  {check.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
