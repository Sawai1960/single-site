"use client";

import { useEffect, useRef } from "react";

const COUNTER_URL = "https://square.umin.ac.jp/cgi-bin/npc.cgi?L=square_single-site_index.html";
const COUNTED_DATE_ITEM = "singleSiteCounterDate";

/** UMIN npc.cgi counter: counts once per browser per day, and only on the UMIN host (dev/preview just display). */
export function AccessCounter() {
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!img.current) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let count = window.location.hostname === "square.umin.ac.jp";
    if (count) {
      try {
        if (localStorage.getItem(COUNTED_DATE_ITEM) === today) count = false;
        else localStorage.setItem(COUNTED_DATE_ITEM, today);
      } catch {}
    }
    img.current.src = count ? COUNTER_URL : `${COUNTER_URL}&INC=0`;
  }, []);

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span>アクセス数</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={img} width={80} height={16} alt="アクセスカウンター" />
    </div>
  );
}
