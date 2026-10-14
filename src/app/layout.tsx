import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans_JP } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const notoSans = Noto_Sans_JP({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "シングルサイト解析のための HGVS–GRCh38 座標自動変換ツール",
  description:
    "HGVS 表記（c.・p.・g.・m.）および遺伝子名で記載されたバリアントを、NCBI RefSeq 転写産物のゲノムアライメントに基づいて GRCh38（hg38）のゲノム座標に変換し、検査依頼書用の 9 桁表記を出力します。がん・難病のシングルサイト解析（家系内解析を含む）における対象座標の特定を支援します。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-muted/30">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
