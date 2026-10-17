"use client";

import { CheckCircle2, CircleMinus, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { FaqLink } from "@/components/faq";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CheckOutcome, ConversionResult, SelfCheck, SourceChecks, VerifySource, VerifyPlan } from "@/lib/variant/types";
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
  const outcomes = (s: SourceState | undefined, i: number) => {
    const c = s?.state === "done" ? s.checks[i] : null;
    return c ? [c.forward, c.reverse].filter((o) => o !== undefined) : [];
  };
  const anyMatch = idx.some((i) => states.some((s) => outcomes(s, i).some((o) => o.status === "match")));
  if (!anyMatch) return "unavailable";
  const allMatch = idx.every((i) =>
    states.every((s) => {
      const o = outcomes(s, i);
      return o.length > 0 && o.every((x) => x.status === "match");
    }),
  );
  return allMatch ? "match" : "partial";
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
        {outcome.status === "unavailable" && <FaqLink id="unavailable" />}
      </div>
    </div>
  );
}

/** The in-tool column carries the result; the external columns only check it. */
const MAIN_COL = "border-x border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/30";

/** The in-tool round trip split into its c. → hg38 and hg38 → c. halves. */
export function selfDirection(selfCheck: SelfCheck, dir: "forward" | "reverse"): boolean {
  return selfCheck.rows.every((r) => (dir === "forward" ? r.forward === r.pos : r.reverse === r.c));
}

function SelfCell({ selfCheck, dir }: { selfCheck?: SelfCheck; dir: "forward" | "reverse" }) {
  if (!selfCheck) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = selfCheck.rows.slice(0, 3);
  return (
    <OutcomeCell
      outcome={{
        status: selfDirection(selfCheck, dir) ? "match" : "mismatch",
        detail: [
          ...shown.map((r) =>
            dir === "forward"
              ? `${r.c} → ${r.forward?.toLocaleString() ?? "計算不可"}${r.forward !== r.pos ? `（期待 ${r.pos.toLocaleString()}）` : ""}`
              : `${r.pos.toLocaleString()} → ${r.reverse ?? "計算不可"}${r.reverse !== r.c ? `（期待 ${r.c}）` : ""}`,
          ),
          ...(selfCheck.rows.length > shown.length ? [`ほか ${selfCheck.rows.length - shown.length} 塩基`] : []),
        ].join(" / "),
      }}
    />
  );
}

export function VerificationPanel({
  plan,
  selfCheck,
  checks,
  onRun,
}: {
  plan: VerifyPlan;
  selfCheck?: SelfCheck;
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
          計算結果の照合
        </div>
        {!started && onRun && (
          <Button variant="outline" size="xs" onClick={onRun}>
            照合する
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[7.5rem]" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead className="border-b">
            <tr>
              <th rowSpan={2} className="px-3 py-1" />
              <th rowSpan={2} className={cn(MAIN_COL, "px-3 py-1 align-bottom font-semibold text-blue-800 dark:text-blue-300")}>
                本ツール
                <div className="font-normal text-muted-foreground">UCSC のアライメント・変換結果の計算</div>
              </th>
              <th colSpan={2} className="px-3 pt-1 font-medium text-muted-foreground">
                外部データベース検証
                <span className="ml-1 font-normal">（照合用・UCSC を使わない独立した計算）</span>
              </th>
            </tr>
            <tr>
              {SOURCES.map(({ id, label }) => (
                <th key={id} className="border-l px-3 pb-1 font-normal text-muted-foreground first:border-l-0">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.key} className="align-top">
                <td className="px-3 py-2">
                  <div className="font-mono font-medium">{row.label}</div>
                  <div className="text-muted-foreground">{row.sub}</div>
                </td>
                <td className={cn(MAIN_COL, "min-w-0 px-3 py-2")}>
                  <SelfCell selfCheck={selfCheck} dir={row.key} />
                </td>
                {SOURCES.map(({ id }, i) => {
                  const s = checks[id];
                  return (
                    <td key={id} className={cn("min-w-0 px-3 py-2", i > 0 && "border-l")}>
                      <OutcomeCell
                        pending={s?.state === "pending"}
                        error={s?.state === "error" ? s.message : undefined}
                        outcome={s?.state === "done" ? (s.check?.[row.key] ?? undefined) : undefined}
                        none={s ? (row.none ?? "照合データなし") : "未実行"}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        本ツールは UCSC のアライメントで両方向に計算し直した結果で、計算の誤りを見つけます。NCBI と Ensembl は UCSC を使わない独立した計算で、データ自体の誤りも確認できます。3 つの計算 × 2 方向の 6 通りがすべて一致すれば、両方の誤りがないことを確認できたことになります。
        {!started && " 外部データベース検証は「照合する」で実行します。Ensembl は応答に数十秒かかることがあります。"}
      </p>
    </div>
  );
}
