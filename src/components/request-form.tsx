"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, Info, Loader2, OctagonX, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MODE_LABEL, type KazusaMode } from "@/lib/variant/kazusa";
import {
  FORM_CAPACITY,
  FORM_LABEL,
  FORM_MODE,
  FormError,
  filledVariantCells,
  fillForm,
  planEntries,
  readForm,
  type EntryPlan,
  type PlannedEntry,
  type RequestForm,
} from "@/lib/variant/request-form";
import type { ConversionResult } from "@/lib/variant/types";

interface Output {
  name: string;
  label: string;
  url: string;
  entries: PlannedEntry[];
}

interface Outcome {
  outputs: Output[];
  skipped: EntryPlan["skipped"];
  left: PlannedEntry[];
  leftReason?: string;
}

type Slot = "main" | "re";

interface Picked {
  file: File;
  form: RequestForm;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function RequestFormFiller({
  results,
  mode,
  review,
  checking,
  checked,
  unverified,
  onVerifyRest,
}: {
  results: ConversionResult[];
  mode: KazusaMode;
  review: { warning: boolean; mismatch: boolean; unverified: boolean }[];
  /** external checks still running */
  checking: { done: number; total: number } | null;
  /** at least one result has been cross-checked */
  checked: boolean;
  /** results whose external checks have not been started */
  unverified: number;
  onVerifyRest: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [picked, setPicked] = useState<Partial<Record<Slot, Picked>>>({});

  useEffect(() => {
    const urls = outcome?.outputs.map((o) => o.url) ?? [];
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [outcome]);

  const planned = planEntries(results, mode, review).entries.length;
  const perForm = FORM_CAPACITY[mode === "cancer60" ? "cancer" : "sanger"];
  const needsSecond = mode === "cancer60" && planned > perForm;
  const slots: Slot[] = needsSecond ? ["main", "re"] : ["main"];

  async function onPick(slot: Slot, file: File | undefined) {
    if (!file) return;
    setError(null);
    let form: RequestForm;
    try {
      form = readForm(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (FORM_MODE[form.kind] !== mode) {
      setError(`${file.name} は${FORM_LABEL[form.kind]}です。選んでいる区分（${MODE_LABEL[mode]}）の依頼書を選んでください`);
      return;
    }
    if (needsSecond && slot === "main" && form.kind === "cancer-re") {
      setError(`${file.name} は再解析依頼書です。②の窓に入れてください`);
      return;
    }
    if (slot === "re" && form.kind !== "cancer-re") {
      setError(`${file.name} は${FORM_LABEL[form.kind]}です。②の窓には再解析依頼書を入れてください`);
      return;
    }
    const next = { ...picked, [slot]: { file, form } };
    setPicked(next);
    setOutcome(null);
    if (slots.every((s) => next[s])) fill(next.main!, next.re);
  }

  function fill(first: Picked, re: Picked | undefined) {
    setError(null);
    setOutcome(null);
    try {
      const plan = planEntries(results, mode, review);
      if (!plan.entries.length) {
        setOutcome({ outputs: [], skipped: plan.skipped, left: [] });
        return;
      }
      const allowed = first.form.genes;
      const entries = plan.entries.filter((e) => !allowed || allowed.has(e.gene));
      const skipped = [
        ...plan.skipped,
        ...plan.entries
          .filter((e) => !entries.includes(e))
          .map((e) => ({ input: e.input, index: e.index, reason: `${e.gene} は依頼書の遺伝子リストにないため記入しません` })),
      ];

      const per = FORM_CAPACITY[first.form.kind];
      const chunks: { form: RequestForm; file: File; items: PlannedEntry[]; from: number }[] = [];
      for (let i = 0; i < entries.length; i += per) {
        const target = i === 0 ? first : i === per ? re : undefined;
        if (!target) break;
        chunks.push({ form: target.form, file: target.file, items: entries.slice(i, i + per), from: i + 1 });
      }
      const used = chunks.reduce((n, c) => n + c.items.length, 0);
      const left = entries.slice(used);
      const leftReason = !left.length
        ? undefined
        : mode === "sanger"
          ? `Sanger の依頼書に記入できるのは ${per} か所までです。残りは別の依頼書でお申し込みください（分け方はかずさ遺伝子検査室にご確認ください）`
          : `通常の依頼書と再解析依頼書の 2 つで記入できるのは ${per * 2} か所までです。残りは別の依頼でお申し込みください（分け方はかずさ遺伝子検査室にご確認ください）`;

      const flagged = chunks.flatMap((c) => c.items).filter((e) => e.review.length);
      if (
        flagged.length &&
        !window.confirm(
          `次の ${flagged.length} 件は確認が必要な結果です。依頼書に記入しますか？\n\n${flagged
            .map((e) => `・${e.input}（${e.review.join("、")}）`)
            .join("\n")}\n\n記入した場合も、送付前に必ず内容を確認してください。`,
        )
      ) {
        return;
      }
      const filled = [...new Map(chunks.map((c) => [c.form, c.file])).entries()]
        .map(([form, file]) => ({ name: file.name, cells: filledVariantCells(form) }))
        .filter((f) => f.cells.length);
      if (
        filled.length &&
        !window.confirm(
          `選んだ依頼書の変異の欄には、すでに記入があります。\n\n${filled
            .map((f) => `・${f.name}（セル ${f.cells.join("・")}）`)
            .join("\n")}\n\n消して書き直しますか？（医療機関の情報などはそのまま残ります）`,
        )
      ) {
        return;
      }

      const outputs = chunks.map((c) => {
        const bytes = fillForm(c.form, c.items, c.form.kind === "cancer-re" ? first.form : undefined);
        const base = c.file.name.replace(/\.xlsx$/i, "");
        const to = c.from + c.items.length - 1;
        const range = c.from === to ? `${c.from} か所目` : `${c.from}〜${to} か所目`;
        return {
          name: chunks.length > 1 ? `${base}_記入済_${c.from}-${to}.xlsx` : `${base}_記入済.xlsx`,
          label: `${range}（${FORM_LABEL[c.form.kind]}）`,
          url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX })),
          entries: c.items,
        };
      });
      setOutcome({ outputs, skipped, left, leftReason });
    } catch (e) {
      setError(e instanceof FormError ? e.message : `依頼書に記入できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="size-5" />
          かずさ遺伝子検査室の検査依頼書に記入
        </CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">
            医療機関の情報などを記入済みの、ご自身の施設用の依頼書（Excel の .xlsx）を選ぶと、変異の欄に上の変換結果を記入したファイルをダウンロードできます。依頼書は、かずさ遺伝子検査室のサイトから最新のものを入手してください。
          </span>
          <span className="block">
            ファイルはこのブラウザの中だけで処理し、どこにも送信しません。変異の欄以外（匿名化 ID・医療機関の情報・チェックボックスなど）は書き換えません。
          </span>
          <span className="block">
            {mode === "cancer60"
              ? "がん関連遺伝子の依頼書は 1 枚に 4 か所までです。記入するか所が 5 以上のときは、通常の依頼書と再解析依頼書を入れる窓が 2 つ出ます。再解析依頼書の匿名化 ID と医療機関の情報が空欄なら、通常の依頼書から写します（チェックボックスは手で入れてください）。"
              : "Sanger の依頼書は 1 枚に 5 か所までです。各行の末尾に発端者 ID（発端者の解析をかずさ遺伝子検査室で行った場合）を手で追記してください。"}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn("grid gap-2", slots.length > 1 && "sm:grid-cols-2")}>
          {slots.map((slot, n) => (
            <SlotPicker
              key={slot}
              label={
                slot === "re"
                  ? `② 再解析依頼書（${planned === perForm + 1 ? perForm + 1 : `${perForm + 1}〜${Math.min(planned, perForm * 2)}`} か所目）`
                  : needsSecond
                    ? `① 通常の依頼書（1〜${perForm} か所目）`
                    : "依頼書"
              }
              file={picked[slot]?.file}
              checking={checking}
              primary={!picked[slot] && slots.slice(0, n).every((s) => picked[s])}
              onPick={(f) => onPick(slot, f)}
            />
          ))}
        </div>
        {!checking && unverified > 0 && (
          <Button variant="outline" onClick={onVerifyRest}>
            <ShieldCheck data-icon="inline-start" />
            残り {unverified} 件も照合する
          </Button>
        )}
        {checking ? (
          <p className="text-sm text-muted-foreground">外部照合が終わると、依頼書を選べるようになります。</p>
        ) : unverified > 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            外部照合が済んでいない結果が {unverified} 件あります。「残り {unverified} 件も照合する」で照合してから記入することをお勧めします。
          </p>
        ) : (
          checked && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">外部照合が完了しました。依頼書に記入できます。</p>
        )}
        <p className="text-sm text-muted-foreground">
          {planned === 0
            ? "依頼書に記入できる結果がありません（理由は「入力の確認」の表を参照してください）。"
            : needsSecond
              ? `記入するのは ${planned} か所です。5 か所目以降は再解析依頼書に記入するため、①に通常の依頼書、②に再解析依頼書を入れてください。2 つそろうと記入します。${
                  planned > perForm * 2 ? `2 つで記入できるのは ${perForm * 2} か所までで、${perForm * 2 + 1} か所目以降は記入されません。` : ""
                }`
              : mode === "sanger" && planned > perForm
                ? `記入するのは ${planned} か所ですが、1 件の依頼書に記入できるのは ${perForm} か所までです。${perForm + 1} か所目以降は別の依頼書でお申し込みください。`
                : `記入するのは ${planned} か所です。依頼書を 1 つ選ぶと記入します。`}
        </p>

        {error && (
          <Alert variant="destructive">
            <OctagonX />
            <AlertTitle>記入できませんでした</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {outcome && (
          <div className="space-y-3">
            {outcome.left.length > 0 && (
              <Alert className="border-2 border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <CircleAlert />
                <AlertTitle className="text-base font-semibold">
                  記入しきれなかった変異が {outcome.left.length} 件あります。この依頼書だけでは全部を依頼できません
                </AlertTitle>
                <AlertDescription className="text-amber-900 dark:text-amber-200">
                  <p>{outcome.leftReason}</p>
                  <ul className="list-disc pl-4 font-mono">
                    {outcome.left.map((e, i) => (
                      <li key={`${e.input}-${i}`}>{e.input}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {outcome.outputs.length > 0 && (
              <div className="space-y-3 rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2 text-base font-semibold text-emerald-800 dark:text-emerald-300">
                  <CircleCheck className="size-5" />
                  記入が完了しました。下のボタンからダウンロードしてください
                </div>
                {outcome.outputs.map((o) => (
                  <div key={o.url} className="space-y-1.5">
                    <a href={o.url} download={o.name} className={buttonVariants({ size: "lg", className: "h-10 px-4 text-base" })}>
                      <Download data-icon="inline-start" />
                      {o.label}をダウンロード
                    </a>
                    <ul className="pl-1 text-xs text-muted-foreground">
                      {o.entries.map((e, i) => (
                        <li key={`${e.input}-${i}`} className="font-mono break-all">
                          {e.gene} {String(e.pos).padStart(9, "0")}
                          {e.text && ` — ${e.text}`}
                          <span className="font-sans"> （入力: {e.input}）</span>
                          {[...e.review, ...e.notes].map((n) => (
                            <span key={n} className="block font-sans text-amber-700 dark:text-amber-400">
                              {n}
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Excel で開いて内容を確認し、必須項目とチェックボックスを確かめてから保存・送付してください。
                </p>
              </div>
            )}
            {outcome.skipped.length > 0 && (
              <Alert>
                <Info />
                <AlertTitle>記入しなかった入力 {outcome.skipped.length} 件</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {outcome.skipped.map((s, i) => (
                      <li key={`${s.input}-${i}`}>
                        <span className="font-mono">{s.input}</span>：{s.reason}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SlotPicker({
  label,
  file,
  checking,
  primary,
  onPick,
}: {
  label: string;
  file: File | undefined;
  checking: { done: number; total: number } | null;
  primary: boolean;
  onPick: (file: File | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", file && "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20")}>
      <div className="text-sm font-medium">{label}</div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button variant={primary ? "default" : "outline"} onClick={() => input.current?.click()} disabled={!!checking}>
        {checking ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
        {checking ? `外部照合中…（${checking.done}/${checking.total} 件完了）` : file ? "選び直す" : "依頼書（Excel）を選ぶ"}
      </Button>
      {file && (
        <div className="flex items-center gap-1.5 text-sm text-emerald-800 dark:text-emerald-300">
          <CircleCheck className="size-4 shrink-0" />
          <span className="break-all">{file.name}</span>
        </div>
      )}
    </div>
  );
}
