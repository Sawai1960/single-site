"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Info, OctagonX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CandidateView } from "@/components/candidate-view";
import type { ConversionResult } from "@/lib/variant/types";

const INITIAL_VISIBLE = 4;

const STATUS = {
  ok: { label: "変換成功", icon: CircleCheck, className: "bg-emerald-600 text-white" },
  warning: { label: "要確認", icon: CircleAlert, className: "bg-amber-500 text-white" },
  error: { label: "エラー", icon: OctagonX, className: "bg-destructive text-white" },
} as const;

export function ResultCard({ result }: { result: ConversionResult }) {
  const [showAll, setShowAll] = useState(false);
  const [showMismatched, setShowMismatched] = useState(false);
  const status = STATUS[result.status];
  const matched = result.candidates.filter((c) => !c.refCheck || c.refCheck.ok);
  const mismatched = result.candidates.filter((c) => c.refCheck && !c.refCheck.ok);
  const primary = matched.length ? matched : mismatched;
  const secondary = matched.length ? mismatched : [];
  const visible = showAll ? primary : primary.slice(0, INITIAL_VISIBLE);

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
        {visible.map((c, i) => (
          <CandidateView key={`${c.transcript}-${c.chrom}-${c.start}-${i}`} c={c} />
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
              secondary.map((c, i) => (
                <CandidateView key={`mm-${c.transcript}-${c.chrom}-${c.start}-${i}`} c={c} dimmed />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
