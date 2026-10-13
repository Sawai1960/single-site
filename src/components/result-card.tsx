"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Info, OctagonX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CandidateView } from "@/components/candidate-view";
import { candidateChecks, hasMismatch, type ResultVerification } from "@/components/verification";
import { cn } from "@/lib/utils";
import { formatPos, ninePad } from "@/lib/variant/format";
import type { ConversionResult, VersionRow } from "@/lib/variant/types";

const INITIAL_VISIBLE = 4;

const STATUS = {
  ok: { label: "変換成功", icon: CircleCheck, className: "bg-emerald-600 text-white" },
  warning: { label: "要確認", icon: CircleAlert, className: "bg-amber-500 text-white" },
  error: { label: "エラー", icon: OctagonX, className: "bg-destructive text-white" },
} as const;

export function effectiveStatus(r: ConversionResult, v: ResultVerification | undefined): ConversionResult["status"] {
  return r.status === "ok" && hasMismatch(v) ? "warning" : r.status;
}

function VersionTable({ rows }: { rows: VersionRow[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">バージョン別の hg38 位置</div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-muted/60 text-xs whitespace-nowrap text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">バージョン</th>
              <th className="px-3 py-1.5 text-left font-medium">hg38 位置</th>
              <th className="px-3 py-1.5 text-left font-medium">9桁</th>
              <th className="px-3 py-1.5 text-left font-medium">リファレンス</th>
              <th className="px-3 py-1.5 text-left font-medium">判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.transcript} className={cn("border-t align-top", r.same === false && "bg-amber-50 dark:bg-amber-950/30")}>
                <td className="px-3 py-1.5">
                  <div className="font-mono">{r.transcript}</div>
                  {r.protein && <div className="font-mono text-xs text-muted-foreground">{r.protein}</div>}
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {r.used && <Badge variant="secondary">表示中の候補</Badge>}
                    {r.bridged ? (
                      <Badge variant="outline">NCBI の配列で計算</Badge>
                    ) : (
                      r.historical && <Badge variant="outline">旧バージョン</Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                  {r.loci.length
                    ? r.loci.map((l) => (
                        <div key={`${l.chrom}:${l.start}`}>
                          {l.chrom}:{formatPos(l.start)}
                          {l.end > l.start ? `-${formatPos(l.end)}` : ""}
                        </div>
                      ))
                    : "—"}
                </td>
                <td className="px-3 py-1.5 font-mono">
                  {r.loci.map((l) => (
                    <div key={`${l.chrom}:${l.start}`}>{ninePad(l.start)}</div>
                  ))}
                </td>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                  {r.refOk === undefined ? "—" : r.refOk ? "一致" : <span className="text-destructive">不一致</span>}
                </td>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                  {r.error ? (
                    <span className="text-muted-foreground">計算できません: {r.error}</span>
                  ) : r.same ? (
                    "同じ位置"
                  ) : (
                    <span className="font-medium text-amber-700 dark:text-amber-400">位置が異なる</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResultCard({
  result,
  verification,
  onVerify,
}: {
  result: ConversionResult;
  verification?: ResultVerification;
  onVerify?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showMismatched, setShowMismatched] = useState(false);
  const status = STATUS[effectiveStatus(result, verification)];
  const indexed = result.candidates.map((c, i) => ({ c, i }));
  const matched = indexed.filter(({ c }) => !c.refCheck || c.refCheck.ok);
  const mismatched = indexed.filter(({ c }) => c.refCheck && !c.refCheck.ok);
  const primary = matched.length ? matched : mismatched;
  const secondary = matched.length ? mismatched : [];
  const visible = showAll ? primary : primary.slice(0, INITIAL_VISIBLE);
  const external = hasMismatch(verification);

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={status.className}>
            <status.icon data-icon="inline-start" />
            {status.label}
          </Badge>
          {result.formatLabel && <Badge variant="outline">{result.formatLabel}</Badge>}
          {result.candidates.length > 1 && (
            <span className="text-xs text-muted-foreground">候補 {result.candidates.length} 件</span>
          )}
        </div>
        <CardTitle className="font-mono text-base break-all">{result.input}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.status === "error" && (
          <Alert variant="destructive">
            <OctagonX />
            <AlertTitle>変換できませんでした</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}
        {external && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>外部データベースの結果と一致しない候補があります</AlertTitle>
            <AlertDescription>
              NCBI または Ensembl が別の位置を返しました。各候補の「外部データベースとの照合」を確認し、UCSC で位置と遺伝子名を確かめてください。
            </AlertDescription>
          </Alert>
        )}
        {result.notes.length > 0 && (
          <Alert className="border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <Info />
            <AlertDescription className="text-inherit">
              <ul className="list-disc space-y-0.5 pl-4">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {result.versions && result.versions.length > 1 && <VersionTable rows={result.versions} />}
        {visible.map(({ c, i }) => (
          <CandidateView
            key={`${c.transcript}-${c.chrom}-${c.start}-${i}`}
            c={c}
            checks={candidateChecks(verification, i)}
            onVerify={onVerify}
          />
        ))}
        {primary.length > INITIAL_VISIBLE && (
          <Button variant="outline" className="w-full" onClick={() => setShowAll((v) => !v)}>
            <ChevronDown data-icon="inline-start" className={showAll ? "rotate-180" : ""} />
            {showAll ? "候補を折りたたむ" : `残り ${primary.length - INITIAL_VISIBLE} 件の候補を表示`}
          </Button>
        )}
        {secondary.length > 0 && (
          <div className="space-y-3">
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setShowMismatched((v) => !v)}>
              <ChevronDown data-icon="inline-start" className={showMismatched ? "rotate-180" : ""} />
              リファレンスが一致しない候補 {secondary.length} 件を{showMismatched ? "隠す" : "表示"}
            </Button>
            {showMismatched &&
              secondary.map(({ c, i }) => (
                <CandidateView
                  key={`mm-${c.transcript}-${c.chrom}-${c.start}-${i}`}
                  c={c}
                  dimmed
                  checks={candidateChecks(verification, i)}
                  onVerify={onVerify}
                />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
