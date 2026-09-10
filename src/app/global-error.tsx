"use client";

import { useEffect, useRef } from "react";

const fallbackTokens = {
  "--surface-canvas": "#edf3f8",
  "--surface-base": "#ffffff",
  "--content-primary": "#102a43",
  "--content-secondary": "#486581",
  "--content-on-action": "#ffffff",
  "--border-subtle": "#cbd9e6",
  "--action-primary": "#155eef",
  "--shadow-card": "0 1px 2px rgb(16 42 67 / 0.06), 0 14px 36px rgb(16 42 67 / 0.09)",
  "--space-2": "0.5rem",
  "--space-6": "1.5rem",
  "--text-xl": "1.375rem",
  "--radius-md": "0.75rem",
  "--radius-lg": "1rem",
  "--touch-target": "3rem",
  "--font-sans": "Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif",
} as React.CSSProperties;

export default function GlobalError({ error, retry }: { readonly error: Error & { digest?: string }; readonly retry: () => void }) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    console.error("Root render failed", { digest: error.digest });
    mainRef.current?.focus();
  }, [error.digest]);

  return (
    <html lang="ko">
      <body style={{ ...fallbackTokens, margin: 0, background: "var(--surface-canvas)", color: "var(--content-primary)", fontFamily: "var(--font-sans)" }}>
        <title>서비스 오류 | 낑기타자</title>
        <main ref={mainRef} tabIndex={-1} style={{ display: "grid", minHeight: "100vh", placeItems: "center", padding: "var(--space-6)" }}>
          <section style={{ width: "100%", maxWidth: "30rem", padding: "var(--space-6)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", background: "var(--surface-base)", boxShadow: "var(--shadow-card)" }}>
            <h1 style={{ margin: 0, color: "var(--content-primary)", fontSize: "var(--text-xl)" }}>서비스 화면을 다시 준비하고 있습니다.</h1>
            <p style={{ margin: "var(--space-2) 0 var(--space-6)", color: "var(--content-secondary)" }}>잠시 후 다시 시도해 주세요.</p>
            <button type="button" onClick={retry} style={{ width: "100%", minHeight: "var(--touch-target)", border: 0, borderRadius: "var(--radius-md)", color: "var(--content-on-action)", background: "var(--action-primary)", font: "inherit", fontWeight: 700 }}>다시 시도</button>
          </section>
        </main>
      </body>
    </html>
  );
}
