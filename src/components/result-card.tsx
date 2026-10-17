"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Info, Loader2, OctagonX, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FaqLink } from "@/components/faq";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CandidateView } from "@/components/candidate-view";
import {
  candidateChecks,
  hasMismatch,
  SOURCES,
  verificationSummary,
  type ResultVerification,
  type VerificationSummary,
} from "@/components/verification";
import { cn } from "@/lib/utils";
import { formatPos, ninePad } from "@/lib/variant/format";
import { MODE_LABEL, modeRank, needsReview, wrongForm, type KazusaMode } from "@/lib/variant/kazusa";
import type { ConversionResult, ResultCandidate, VerifySource, VersionRow } from "@/lib/variant/types";

const INITIAL_VISIBLE = 4;

const STATUS = {
  ok: { label: "変換成功", icon: CircleCheck, className: "bg-emerald-600 text-white" },
  warning: { label: "要確認", icon: CircleAlert, className: "bg-amber-500 text-white" },
  error: { label: "エラー", icon: OctagonX, className: "bg-destructive text-white" },
} as const;

const VERIFY_BADGE: Record<Exclude<VerificationSummary, "none">, { text: string; className: string; run?: boolean }> = {
  mismatch: {
    text: "外部データベースと不一致 — 専門家による精査が必要です",
    className: "bg-destructive text-white",
  },
  pending: { text: "外部照合中…", className: "bg-muted text-muted-foreground" },
  unchecked: {
    text: "外部照合が未実施です",
    className: "border border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    run: true,
  },
  unavailable: {
    text: "外部照合ができませんでした。時間をおいて再照合してください",
    className: "border border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    run: true,
  },
  partial: {
    text: "外部照合で確認できなかった項目があります",
    className: "border border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    run: true,
  },
  match: {
    text: "NCBI・Ensembl と一致",
    className: "border border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
};

function VerifyBadge({
  summary,
  retryable,
  onVerify,
}: {
  summary: VerificationSummary;
  /** a source failed to respond; "確認不可" answers from the databases do not change on a rerun */
  retryable: boolean;
  onVerify?: () => void;
}) {
  if (summary === "none") return null;
  const base = VERIFY_BADGE[summary];
  const settled = (summary === "unavailable" || summary === "partial") && !retryable;
  const b =
    settled && summary === "unavailable"
      ? { ...base, text: "外部データベースではこの位置を照合できません（データベースの対象外）", run: false }
      : settled
        ? { ...base, run: false }
        : base;
  const Icon = summary === "mismatch" ? OctagonX : summary === "pending" ? Loader2 : summary === "match" ? ShieldCheck : CircleAlert;
  return (
    <>
      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", b.className)}>
        <Icon className={cn("size-3.5", summary === "pending" && "animate-spin")} />
        {b.text}
      </span>
      {b.run && onVerify && (
        <Button variant="outline" size="xs" onClick={onVerify}>
          今すぐ照合する
        </Button>
      )}
    </>
  );
}

export function effectiveStatus(
  r: ConversionResult,
  v: ResultVerification | undefined,
  mode: KazusaMode | null | undefined,
): ConversionResult["status"] {
  if (r.status !== "ok") return r.status;
  return hasMismatch(v) || (mode && needsReview(r.candidates, mode)) ? "warning" : "ok";
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
                    <span className="inline-block min-w-48 whitespace-normal text-muted-foreground">計算できません: {r.error}</span>
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

function sourceVerdict(s: ReturnType<typeof candidateChecks>[VerifySource]): { text: string; className: string } {
  if (!s) return { text: "未照合", className: "text-muted-foreground" };
  if (s.state === "pending") return { text: "照合中", className: "text-muted-foreground" };
  if (s.state === "error" || !s.check) return { text: "確認不可", className: "text-amber-700 dark:text-amber-400" };
  const o = [s.check.forward, s.check.reverse].filter((x) => x !== undefined);
  if (o.some((x) => x.status === "mismatch")) return { text: "不一致", className: "font-medium text-destructive" };
  if (o.length && o.every((x) => x.status === "match")) return { text: "一致", className: "text-emerald-700 dark:text-emerald-400" };
  return { text: "一部確認不可", className: "text-amber-700 dark:text-amber-400" };
}

function SameSiteTable({
  rows,
  gene,
  verification,
}: {
  rows: { c: ResultCandidate; i: number }[];
  gene: string;
  verification?: ResultVerification;
}) {
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
        同じ位置に重なる {gene} の他の転写産物 {rows.length} 件（一覧を表示）
      </summary>
      <div className="space-y-2 border-t px-3 py-2">
        <p className="text-xs text-muted-foreground">
          ここにまとめた転写産物（スプライシング型）は、上の代表の 1 件（MANE Select があればそれ）と hg38 の位置が同じで、依頼書に書く内容も同じです。位置が違う転写産物、別の遺伝子の転写産物、外部照合で不一致がある転写産物、代表にない注意が付いた転写産物は、まとめずに上に表示します。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="text-xs whitespace-nowrap text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">転写産物</th>
                <th className="py-1 pr-3 text-left font-medium">c. 表記</th>
                {SOURCES.map((s) => (
                  <th key={s.id} className="py-1 pr-3 text-left font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, i }) => {
                const checks = candidateChecks(verification, i);
                return (
                  <tr key={`${c.transcript}-${i}`} className="border-t align-top">
                    <td className="py-1 pr-3 font-mono whitespace-nowrap">{c.transcript}</td>
                    <td className="py-1 pr-3 font-mono break-all">{c.hgvsC ?? "—"}</td>
                    {SOURCES.map((s) => {
                      const v = sourceVerdict(checks[s.id]);
                      return (
                        <td key={s.id} className={cn("py-1 pr-3 text-xs whitespace-nowrap", v.className)}>
                          {v.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export function ResultCard({
  result,
  mode,
  verification,
  onVerify,
}: {
  result: ConversionResult;
  mode?: KazusaMode;
  verification?: ResultVerification;
  onVerify?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showMismatched, setShowMismatched] = useState(false);
  const status = STATUS[effectiveStatus(result, verification, mode)];
  const indexed = result.candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => modeRank(a.c, mode) - modeRank(b.c, mode));
  const matched = indexed.filter(({ c }) => !c.refCheck || c.refCheck.ok);
  const mismatched = indexed.filter(({ c }) => c.refCheck && !c.refCheck.ok);
  const pool = matched.length ? matched : mismatched;
  const secondary = matched.length ? mismatched : [];
  const mapped = result.format !== undefined && result.format > 1;
  // Transcripts that give the same hg38 position give the same request entry, so only one representative
  // (plus anything that needs attention) is shown as a full card.
  const lead = result.format !== undefined && pool.length > 1 ? (pool.find(({ c }) => c.mane) ?? pool[0]) : undefined;
  const differs = (c: ResultCandidate) =>
    result.format !== 1 &&
    (c.chrom !== lead!.c.chrom ||
      c.start !== lead!.c.start ||
      c.end !== lead!.c.end ||
      c.warnings.some((w) => !lead!.c.warnings.includes(w)));
  const primary = lead
    ? pool.filter((x) => x === lead || x.c.gene !== lead.c.gene || hasMismatch(verification, x.i) || differs(x.c))
    : pool;
  const grouped = lead ? pool.filter((x) => !primary.includes(x)) : [];
  const visible = showAll ? primary : primary.slice(0, INITIAL_VISIBLE);
  const external = hasMismatch(verification);
  const formFix = mode && result.status !== "error" ? wrongForm(result.candidates, mode) : undefined;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={status.className}>
            <status.icon data-icon="inline-start" />
            {status.label}
          </Badge>
          {formFix && (
            <Badge variant="destructive">
              <CircleAlert data-icon="inline-start" />
              区分エラー：{MODE_LABEL[formFix]}の依頼書へ
            </Badge>
          )}
          <VerifyBadge
            summary={verificationSummary(result, verification)}
            retryable={SOURCES.some(({ id }) => verification?.[id]?.state === "error")}
            onVerify={onVerify}
          />
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
            <AlertDescription>
              <p>
                {result.message}
                <FaqLink text={result.message} />
              </p>
            </AlertDescription>
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
                  <li key={n}>
                    {n}
                    <FaqLink text={n} />
                  </li>
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
            mode={mode}
            mapped={mapped}
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
        {lead && grouped.length > 0 && (
          <SameSiteTable rows={grouped} gene={lead.c.gene} verification={verification} />
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
                  mode={mode}
                  dimmed
                  mapped={mapped}
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
