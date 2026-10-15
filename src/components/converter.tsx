"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Download, Eraser, Loader2, OctagonX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { effectiveStatus, ResultCard } from "@/components/result-card";
import {
  fetchSourceChecks,
  SOURCES,
  verifiableIndexes,
  verificationText,
  type ResultVerification,
  type SourceState,
} from "@/components/verification";
import { convertMany } from "@/lib/variant/convert";
import { resultsToCsv } from "@/lib/variant/format";
import { getIndex } from "@/lib/variant/refseq";
import type { ConversionResult, VerifySource } from "@/lib/variant/types";

const EXAMPLES: { label: string; value: string }[] = [
  { label: "形式1", value: "hg38, chr4:55113391" },
  { label: "形式2", value: "NM_002253.2:c.889G>A" },
  { label: "形式3", value: "NP_443086.1:p.Asp509Glyfs" },
  { label: "形式4（c.）", value: "KDR:c.889G>A" },
  { label: "形式4（p.）", value: "KRAS p.G12D" },
  { label: "hg19", value: "hg19, chr7:55259515" },
  { label: "ミトコンドリア", value: "m.3243A>G" },
];

const MAX_LINES = 200;
/** External checks start automatically for the first results only, to stay within NCBI/Ensembl rate limits. */
const AUTO_VERIFY_RESULTS = 5;

export function Converter() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ConversionResult[] | null>(null);
  const [verification, setVerification] = useState<Record<number, ResultVerification>>({});
  const runId = useRef(0);
  const [meta, setMeta] = useState<{ builtAt: string; mane: string; transcripts: number } | null>(null);

  useEffect(() => {
    getIndex()
      .then((idx) => setMeta({ builtAt: idx.builtAt, mane: idx.sources.mane, transcripts: idx.count }))
      .catch(() => {});
  }, []);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  async function run() {
    if (!lines.length || loading) return;
    if (lines.length > MAX_LINES) {
      setError(`一度に変換できるのは ${MAX_LINES} 行までです（現在 ${lines.length} 行）`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await getIndex();
      const list = await convertMany(lines);
      const run = ++runId.current;
      setResults(list);
      setVerification({});
      list
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => verifiableIndexes(r).length)
        .slice(0, AUTO_VERIFY_RESULTS)
        .forEach(({ r, i }) => verify(r, i, run));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function verify(r: ConversionResult, i: number, run = runId.current) {
    const update = (source: VerifySource, s: SourceState) => {
      if (run !== runId.current) return;
      setVerification((v) => ({ ...v, [i]: { ...v[i], [source]: s } }));
    };
    for (const { id } of SOURCES) {
      update(id, { state: "pending" });
      fetchSourceChecks(r, id).then((s) => update(id, s));
    }
  }

  function addExample(v: string) {
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n${v}` : v));
  }

  function downloadCsv() {
    if (!results) return;
    const blob = new Blob(
      [
        resultsToCsv(
          results.map((r, i) => ({ ...r, status: effectiveStatus(r, verification[i]) })),
          (ri, ci) => verificationText(verification[ri], ci),
        ),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `hg38_positions_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statuses = results?.map((r, i) => effectiveStatus(r, verification[i]));
  const counts = statuses
    ? {
        ok: statuses.filter((s) => s === "ok").length,
        warning: statuses.filter((s) => s === "warning").length,
        error: statuses.filter((s) => s === "error").length,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>変異の位置情報を入力</CardTitle>
            <CardDescription>
              1 行に 1 件ずつ、Enter で改行して入力してください。複数行をまとめて変換できます（最大 {MAX_LINES} 行）。枠内の薄い文字は入力例で、書き始めると消えます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder={"NM_002253.2:c.889G>A\nNP_443086.1:p.Asp509Glyfs\nKDR:c.889G>A"}
              className="min-h-40 font-mono text-sm"
              spellCheck={false}
              aria-label="変異の位置情報"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">入力例（クリックすると上の欄に入ります）:</span>
              {EXAMPLES.map((ex) => (
                <Button key={ex.value} variant="outline" size="xs" onClick={() => addExample(ex.value)}>
                  <span className="text-muted-foreground">{ex.label}</span>
                  <span className="font-mono">{ex.value}</span>
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="lg" onClick={run} disabled={!lines.length || loading}>
                {loading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArrowRightLeft data-icon="inline-start" />}
                {loading ? "変換中…" : `hg38 ゲノム位置に変換${lines.length > 1 ? `（${lines.length} 件）` : ""}`}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setText("");
                  setResults(null);
                  setError(null);
                  setVerification({});
                  runId.current++;
                }}
                disabled={loading || (!text && !results)}
              >
                <Eraser data-icon="inline-start" />
                クリア
              </Button>
              <span className="text-xs text-muted-foreground">Ctrl / ⌘ + Enter でも変換できます</span>
            </div>
          </CardContent>
        </Card>

        <FormatGuide />
      </div>

      {error && (
        <Alert variant="destructive">
          <OctagonX />
          <AlertTitle>変換に失敗しました</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !results && (
        <div className="space-y-3" aria-hidden>
          {lines.slice(0, 3).map((l, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
          ))}
          <p className="text-center text-sm text-muted-foreground">
            初回は転写産物データの読み込みに数秒かかります
          </p>
        </div>
      )}

      {results && counts && (
        <section className={loading ? "space-y-4 opacity-60 transition-opacity" : "space-y-4"} aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">変換結果</h2>
              <p className="text-sm text-muted-foreground">
                {results.length} 件中 成功 {counts.ok} / 要確認 {counts.warning} / エラー {counts.error}
              </p>
            </div>
            <Button variant="outline" onClick={downloadCsv}>
              <Download data-icon="inline-start" />
              CSV をダウンロード
            </Button>
          </div>
          {results.map((r, i) => (
            <ResultCard
              key={`${i}-${r.input}`}
              result={r}
              verification={verification[i]}
              onVerify={() => verify(r, i)}
            />
          ))}
        </section>
      )}

      {!results && !loading && (
        <div className="rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
          変換結果がここに表示されます。上の入力例をクリックすると試せます。
        </div>
      )}

      <Notes meta={meta} />
    </div>
  );
}

function FormatGuide() {
  const rows = [
    { no: "1", title: "ゲノム位置", ex: ["hg38, chr1:195507262", "hg19 chr7:55259515 T>G", "NC_000004.12:g.55113391C>T", "NC_012920.1:m.3243A>G"] },
    { no: "2", title: "スプライシング型指定の c. 表記", ex: ["NM_002253.2:c.889G>A", "NM_002253.2, c.889G>A", "NM_000546.6:c.375+1G>A"] },
    { no: "3", title: "スプライシング型指定の p. 表記", ex: ["NP_443086.1:p.Asp509Glyfs", "NP_004976.2:p.G12D"] },
    { no: "4", title: "スプライシング型不明（遺伝子名）", ex: ["KDR:c.889G>A", "EGFR p.Leu858Arg"] },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>対応している入力形式</CardTitle>
        <CardDescription>
          形式 2〜4 は hg38 のゲノム位置（形式 1）に変換します。形式 1 は hg38 上の位置の確認と、重なる転写産物の c. 表記を表示します。ミトコンドリア DNA の m. 表記（rCRS の番号）も形式 1 として扱います。
          <br />
          本ツールの計算: UCSC Genome Browser（hg38）に登録されている NCBI RefSeq 転写産物とゲノムの対応表（エクソンごとのアライメント）を使って、c. 位置を hg38 の位置に換算しています。p. 表記は、そのアミノ酸のコドン 3 塩基の位置に換算します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {rows.map((r) => (
            <li key={r.no} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {r.no}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                  {r.ex.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

const CAUTIONS = [
  "NM_ 番号（スプライシング型）が違うとゲノム位置が変わることがあります。候補が複数ある場合は、お手元の情報と矛盾がないか確認してください。",
  "得られた位置は、UCSC Genome Browser などで同じリファレンス（hg38）を開き、SNP・ClinVar などの情報が元の変異と一致するか確認してください。",
  "古くから知られる変異は、シグナル配列を除いた成熟型タンパク質の番号で表記されていることがあります。その場合は、シグナル配列を含むコード領域上の番号に直してから入力してください。",
  "2 塩基以上の欠失は、範囲内のどの位置を指定しても構いません。依頼書の特記事項欄に欠失の内容を記入してください。",
  "NGS 法で確認できるのは 1〜20 塩基程度の小さな変異までです。PMS2・BMPR1A・SDHD・CHEK2・NF1 などは相同領域があり、受け入れが難しい場合があります。",
  "難病の遺伝子パネル検査で見つかった変異の家系解析にも使えます。ただし、エクソン単位の欠失・重複（CNV）や反復配列の伸長（リピート病）は位置指定のシングルサイト検査の対象外です。CYP21A2・SMN1/SMN2・GBA1・PKD1 など偽遺伝子や相同領域がある遺伝子は、重複領域の警告が出ます。受け入れ可否は検査会社に確認してください。",
  "ミトコンドリア DNA の変異は m. 表記（rCRS の番号、hg38 の chrM と同じ）で入力できます。変異の割合（ヘテロプラスミー率）は組織や人によって違うため、割合の測定が必要かどうかも含めて検査会社に確認してください。",
];

const DISCLAIMER = [
  "本ツールは、HGVS 表記で記載されたバリアントの GRCh38 ゲノム座標を求める作業を支援するためのものであり、疾患の診断・治療・予防を目的としたものではありません。",
  "本ツールは、臨床遺伝専門医による利用を想定しています。認定遺伝カウンセラー等は座標の確認に使えますが、診断・治療の判断は臨床遺伝専門医が行ってください。出力結果は必ず UCSC Genome Browser 等で確認のうえご使用ください。検査依頼への使用を含め、最終的な判断と責任は利用者が担うものとします。",
  "本ツールは UCSC Genome Browser、NCBI、Ensembl 等の公開データを使用しています。作成者は、出力結果の正確性・完全性・最新性を保証しません。",
  "作成者は、本ツールの使用または使用できなかったことによって生じたいかなる損害についても、責任を負いません。",
  "患者を特定できる情報（氏名・ID 等）は入力しないでください。",
];

function Notes({ meta }: { meta: { builtAt: string; mane: string; transcripts: number } | null }) {
  const sources = [
    `転写産物の構造: UCSC Genome Browser hg38 の NCBI RefSeq アライメント（現行版と旧バージョン）${
      meta
        ? `、${meta.mane}、転写産物アライメント ${meta.transcripts.toLocaleString()} 件（${new Date(meta.builtAt).toLocaleDateString("ja-JP")} 取得）`
        : ""
    }`,
    "参照配列の照合: UCSC API（予備に Ensembl REST）",
    "hg19 → hg38 の変換: Ensembl REST",
    "ミトコンドリアの遺伝子情報: NCBI の NC_012920.1",
    `外部データベースとの照合: NCBI Variation Services と Ensembl VEP（RefSeq 転写産物）。先頭 ${AUTO_VERIFY_RESULTS} 件は自動で照合し、それ以降は各候補の「照合する」から実行します。`,
  ];
  return (
    <Card size="sm" id="disclaimer">
      <CardHeader>
        <CardTitle>利用上の注意</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm leading-relaxed text-foreground/90">
        <section>
          <h3 className="mb-1.5 font-semibold text-foreground">■ 位置を指定するときの注意</h3>
          <ul className="list-disc space-y-1 pl-5">
            {CAUTIONS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1.5 font-semibold text-foreground">■ 免責事項</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {DISCLAIMER.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="mb-1.5 font-semibold text-foreground">■ 使用しているデータと外部サービス</h3>
          <ul className="list-disc space-y-1 pl-5">
            {sources.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        <p>作成者: 兵庫医科大学 澤井英明</p>
      </CardContent>
    </Card>
  );
}
