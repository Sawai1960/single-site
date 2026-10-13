import { Dna } from "lucide-react";
import { Converter } from "@/components/converter";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-8 flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Dna className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">変異位置 → hg38 ゲノム座標 変換ツール</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            c. 表記・p. 表記・遺伝子名からの表記・ミトコンドリアの m. 表記を、hg38 のゲノム位置と依頼書用の 9 桁表記に変換します。がんや難病のシングルサイト解析（家系解析を含む）の依頼書作成に使えます。
          </p>
        </div>
      </header>
      <Converter />
    </main>
  );
}
