import { describe, expect, it } from "vitest";
import { FAQ, faqFor } from "../src/lib/faq";

const ids = new Set(FAQ.flatMap((g) => g.items.map((i) => i.id)));

describe("faqFor", () => {
  it.each([
    ["「c.」が省かれた表記として、MET c.2888-14_2888-4del11 と読み取りました", "omitted"],
    ["旧来の記載方法（BIC 表記）のようです。BRCA2 の BIC 表記は…", "legacy-which"],
    ["GBA1 は、成熟型タンパク質の番号（開始 Met から数えた番号より 39 小さい）で書かれることがあります。", "mature"],
    ["転写産物によってゲノム位置が 2 通りに分かれます。お手元の情報（NM_/NP_ 番号）と照合して選んでください", "multiple"],
    ["変換できなかった候補 — NM_001127500.3: c.2888 はこの転写産物ではエクソン境界ではないため、c.2888-14 という表記は成り立ちません", "anchor"],
    ["MET はがん関連遺伝子のシングルサイト解析の対象（60 遺伝子）に含まれません。", "outside60"],
    ["エクソン境界からイントロン側へ 14 塩基の位置です。検査の対象はイントロン側 10 塩基以内です", "intron10"],
    ["同じ配列の繰り返しの中にあるため、hg38 の位置は HGVS の g. 表記の規則（+鎖の 3' 側に寄せる）で示しています。", "shift"],
  ])("%s → %s", (text, id) => {
    expect(faqFor(text)).toBe(id);
    expect(ids.has(id)).toBe(true);
  });

  it("関係のない注意には付けない", () => {
    expect(faqFor("11 塩基の範囲です。依頼書には範囲内のどの位置を指定しても構いません")).toBeUndefined();
    expect(faqFor(undefined)).toBeUndefined();
  });

  it("質問の id は重複しない", () => {
    expect(ids.size).toBe(FAQ.flatMap((g) => g.items).length);
  });
});
