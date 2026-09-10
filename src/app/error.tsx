"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { StatusMessage } from "@/components/ui/StatusMessage";

export default function Error({ error, retry }: { readonly error: Error & { digest?: string }; readonly retry: () => void }) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    console.error("Route render failed", { digest: error.digest });
    mainRef.current?.focus();
  }, [error.digest]);

  return (
    <main ref={mainRef} tabIndex={-1} className="public-shell route-fallback">
      <div className="route-fallback__content">
        <StatusMessage tone="error" title="화면을 불러오지 못했습니다." live="assertive">연결 상태를 확인한 뒤 다시 시도해 주세요.</StatusMessage>
        <div className="route-fallback__actions">
          <button type="button" className="button button--primary" onClick={retry}>다시 시도</button>
          <Link className="button button--secondary" href="/join">매칭 시작 화면으로</Link>
        </div>
      </div>
    </main>
  );
}
