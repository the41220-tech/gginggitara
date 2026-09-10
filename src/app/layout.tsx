import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { DevelopmentTools } from "@/components/DevelopmentTools";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { ToastProvider } from "@/components/Toast";
import "./system.css";

export const metadata: Metadata = {
  title: "낑기타자 — 부산대역 택시동승 PWA",
  description: "로그인 없이 QR/링크로 들어와 팀을 매칭하고 팀 번호를 받아 빠르게 출발하세요.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#155eef",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Strict nonce-based CSP requires request-time rendering so Next can attach
  // the per-request nonce to every framework and application script.
  await connection();

  return (
    <html lang="ko">
      <body>
        <DevelopmentTools />
        <ToastProvider>{children}</ToastProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
