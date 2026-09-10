"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { StatusMessage } from "@/components/ui/StatusMessage";

export default function NotFound() {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.focus();
  }, []);

  return (
    <main ref={mainRef} tabIndex={-1} className="public-shell route-fallback">
      <div className="route-fallback__content">
        <StatusMessage tone="info" title="찾을 수 없는 페이지입니다.">주소가 바뀌었거나 만료된 링크일 수 있습니다.</StatusMessage>
        <div className="route-fallback__actions">
          <Link className="button button--primary" href="/join">매칭 시작 화면으로</Link>
        </div>
      </div>
    </main>
  );
}
