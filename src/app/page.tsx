import { Dna } from "lucide-react";
import { Converter } from "@/components/converter";
import { FaqAnchor } from "@/components/faq";
import { version } from "../../package.json";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
      <header className="relative mb-8 flex items-start gap-3 pr-16">
        <span className="absolute top-0 right-0 rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          v{version}
        </span>
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Dna className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">シングルサイト解析のための HGVS–GRCh38 座標自動変換ツール</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            HGVS 表記（c.・p.・g.・m.）および遺伝子名で記載されたバリアントを、NCBI RefSeq 転写産物のゲノムアライメントに基づいて GRCh38（hg38）のゲノム座標に変換し、検査依頼書用の表記（がん関連遺伝子は遺伝子名＋9 桁、それ以外は Sanger 依頼書用の 1 行）を出力します。がん・難病のシングルサイト解析（家系内解析を含む）における対象座標の特定を支援します。
          </p>
          <p className="mt-2 text-sm font-medium text-foreground/80">
            本ツールは、HGVS 表記の変異を hg38 のゲノム座標に換算し、検査依頼書への記入を支援するものです。診断や治療方針の判断を行うものではありません。臨床遺伝専門医・認定遺伝カウンセラーなど、遺伝学的検査の依頼に携わる方の利用を想定しています。ご使用の前に、画面下部の「<a href="#disclaimer" className="underline underline-offset-2">利用上の注意と免責事項</a>」をご確認ください。分からない点は「<FaqAnchor>よくある質問</FaqAnchor>」をご覧ください。
          </p>
        </div>
      </header>
      <Converter version={version} />
    </main>
  );
}
