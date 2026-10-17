"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { FAQ, faqFor } from "@/lib/faq";

function openFaq(id?: string) {
  const root = document.getElementById("faq");
  if (!(root instanceof HTMLDetailsElement)) return;
  root.open = true;
  const item = id ? document.getElementById(`faq-${id}`) : null;
  if (item instanceof HTMLDetailsElement) item.open = true;
  (item ?? root).scrollIntoView({ behavior: "smooth", block: "start" });
}

export function FaqAnchor({ children }: { children: ReactNode }) {
  return (
    <a
      href="#faq"
      className="underline underline-offset-2"
      onClick={(e) => {
        e.preventDefault();
        openFaq();
      }}
    >
      {children}
    </a>
  );
}

/** "詳しく" link after a note whose topic is covered in the FAQ. */
export function FaqLink({ text, id }: { text?: string; id?: string }) {
  const target = id ?? faqFor(text);
  if (!target) return null;
  return (
    <button
      type="button"
      onClick={() => openFaq(target)}
      className="ml-1 text-xs whitespace-nowrap text-primary underline underline-offset-2 print:hidden"
    >
      詳しく
    </button>
  );
}

export function FaqSection() {
  return (
    <Card size="sm">
      <CardContent>
        <details id="faq" className="group scroll-mt-4">
          <summary className="cursor-pointer text-base font-semibold">よくある質問（クリックで表示）</summary>
          <div className="mt-3 space-y-4 text-sm leading-relaxed">
            {FAQ.map((g) => (
              <section key={g.title}>
                <h3 className="mb-1.5 font-semibold">■ {g.title}</h3>
                <div className="divide-y rounded-lg border">
                  {g.items.map((item) => (
                    <details key={item.id} id={`faq-${item.id}`} className="scroll-mt-4 px-3 py-2">
                      <summary className="cursor-pointer font-medium">{item.q}</summary>
                      <div className="mt-1.5 space-y-1 text-foreground/90">
                        {item.a.map((p) =>
                          p.startsWith("・") ? (
                            <p key={p} className="pl-4 -indent-3">
                              {p}
                            </p>
                          ) : (
                            <p key={p}>{p}</p>
                          ),
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
