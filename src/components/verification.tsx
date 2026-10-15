"use client";

import { CheckCircle2, CircleMinus, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CheckOutcome, ConversionResult, SourceChecks, VerifySource, VerifyPlan } from "@/lib/variant/types";
import { verifyItems } from "@/lib/variant/verify";

export const SOURCES: { id: VerifySource; label: string }[] = [
  { id: "ncbi", label: "NCBI" },
  { id: "ensembl", label: "Ensembl" },
];

export type SourceState =
  | { state: "pending" }
  | { state: "done"; checks: (SourceChecks | null)[] }
  | { state: "error"; message: string };

/** Verification of one conversion result, per source; checks are indexed like result.candidates. */
export type ResultVerification = Partial<Record<VerifySource, SourceState>>;

const MAX_ITEMS = 30;

export function verifiableIndexes(r: ConversionResult): number[] {
  return r.candidates
    .map((c, i) => (c.verify && c.transcript ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, MAX_ITEMS);
}

export async function fetchSourceChecks(r: ConversionResult, source: VerifySource): Promise<SourceState> {
  const idx = verifiableIndexes(r);
  const items = idx.map((i) => ({
    transcript: r.candidates[i].transcript,
    chrom: r.candidates[i].chrom,
    plan: r.candidates[i].verify as VerifyPlan,
  }));
  try {
    const results = await verifyItems(source, items);
    const checks: (SourceChecks | null)[] = r.candidates.map(() => null);
    idx.forEach((ci, k) => (checks[ci] = results[k]));
    return { state: "done", checks };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export type CandidateSourceState =
  | { state: "pending" }
  | { state: "done"; check: SourceChecks | null }
  | { state: "error"; message: string };

export function candidateChecks(v: ResultVerification | undefined, i: number) {
  const out: Partial<Record<VerifySource, CandidateSourceState>> = {};
  for (const { id } of SOURCES) {
    const s = v?.[id];
    if (!s) continue;
    out[id] = s.state === "done" ? { state: "done", check: s.checks[i] } : s;
  }
  return out;
}

export function hasMismatch(v: ResultVerification | undefined, i?: number): boolean {
  return SOURCES.some(({ id }) => {
    const s = v?.[id];
    if (s?.state !== "done") return false;
    const list = i === undefined ? s.checks : [s.checks[i]];
    return list.some((c) => c?.forward?.status === "mismatch" || c?.reverse?.status === "mismatch");
  });
}

export type VerificationSummary = "none" | "mismatch" | "pending" | "unchecked" | "unavailable" | "partial" | "match";

/** Overall state of the external cross-check for one conversion result. */
export function verificationSummary(r: ConversionResult, v: ResultVerification | undefined): VerificationSummary {
  const idx = verifiableIndexes(r);
  if (!idx.length) return "none";
  if (hasMismatch(v)) return "mismatch";
  const states = SOURCES.map(({ id }) => v?.[id]);
  if (states.some((s) => s?.state === "pending")) return "pending";
  if (states.every((s) => !s)) return "unchecked";
  const matched = idx.filter((i) =>
    states.some(
      (s) => s?.state === "done" && (s.checks[i]?.forward?.status === "match" || s.checks[i]?.reverse?.status === "match"),
    ),
  ).length;
  if (!matched) return "unavailable";
  return matched === idx.length && states.every((s) => s?.state !== "error") ? "match" : "partial";
}

const STATUS_TEXT = { match: "一致", mismatch: "不一致", unavailable: "確認不可" } as const;

/** One-line summary for CSV. */
export function verificationText(v: ResultVerification | undefined, i: number): string {
  const parts: string[] = [];
  for (const { id, label } of SOURCES) {
    const s = v?.[id];
    if (s?.state !== "done") continue;
    const c = s.checks[i];
    if (!c) continue;
    const f = c.forward ? `順変換 ${STATUS_TEXT[c.forward.status]}` : "";
    const r = c.reverse ? `逆変換 ${STATUS_TEXT[c.reverse.status]}` : "";
    parts.push(`${label}: ${[f, r].filter(Boolean).join("・")}`);
  }
  return parts.join(" / ");
}

function OutcomeCell({ outcome, pending, error, none }: { outcome?: CheckOutcome; pending?: boolean; error?: string; none?: string }) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        照会中
      </span>
    );
  }
  if (error) return <span className="text-xs text-muted-foreground">接続エラー: {error}</span>;
  if (!outcome) return <span className="text-xs text-muted-foreground">{none ?? "—"}</span>;
  const badge =
    outcome.status === "match" ? (
      <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 data-icon="inline-start" />
        一致
      </Badge>
    ) : outcome.status === "mismatch" ? (
      <Badge variant="destructive">
        <XCircle data-icon="inline-start" />
        不一致
      </Badge>
    ) : (
      <Badge variant="secondary" className="text-muted-foreground">
        <CircleMinus data-icon="inline-start" />
        確認不可
      </Badge>
    );
  return (
    <div className="space-y-0.5">
      {badge}
      <div className={cn("text-xs break-words", outcome.status === "mismatch" ? "text-destructive" : "text-muted-foreground")}>
        {outcome.detail}
      </div>
    </div>
  );
}

export function VerificationPanel({
  plan,
  checks,
  onRun,
}: {
  plan: VerifyPlan;
  checks: ReturnType<typeof candidateChecks>;
  onRun?: () => void;
}) {
  const started = SOURCES.some(({ id }) => checks[id]);
  const rows = [
    { key: "forward" as const, label: "c. → hg38", sub: "順変換", none: plan.forward.length ? undefined : "対象外（1 塩基置換の候補なし）" },
    { key: "reverse" as const, label: "hg38 → c.", sub: "逆変換" },
  ];
  return (
    <div className="mt-4 rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" />
          外部データベースとの照合
          <span className="font-normal text-muted-foreground">（UCSC のアライメントを使わない独立した計算）</span>
        </div>
        {!started && onRun && (
          <Button variant="outline" size="xs" onClick={onRun}>
            照合する
          </Button>
        )}
      </div>
      {started ? (
        <div className="divide-y">
          {rows.map((row) => (
            <div key={row.key} className="grid gap-2 px-3 py-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="text-xs">
                <div className="font-mono font-medium">{row.label}</div>
                <div className="text-muted-foreground">{row.sub}</div>
              </div>
              {SOURCES.map(({ id, label }) => {
                const s = checks[id];
                return (
                  <div key={id} className="min-w-0">
                    <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{label}</div>
                    <OutcomeCell
                      pending={s?.state === "pending"}
                      error={s?.state === "error" ? s.message : undefined}
                      outcome={s?.state === "done" ? (s.check?.[row.key] ?? undefined) : undefined}
                      none={s ? (row.none ?? "照合データなし") : "未実行"}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          NCBI と Ensembl で同じ変換を行い、本ツールの結果と一致するかを確認します。Ensembl は応答に数十秒かかることがあります。
        </p>
      )}
    </div>
  );
}
