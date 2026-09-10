"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { createClient } from "@/lib/supabase/client";
import styles from "./admin.module.css";

export default function AdminLoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showToast(error.message, "error");
        return;
      }
      router.replace("/admin/dashboard");
    } catch {
      showToast("로그인 요청을 처리하지 못했어요. 네트워크 연결을 확인하고 다시 시도해주세요.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={`admin-shell ${styles.loginShell}`}>
      <section className={styles.loginCard} aria-labelledby="admin-login-title">
        <p className={styles.eyebrow}>GGINGGITARA OPERATIONS</p>
        <h1 id="admin-login-title">운영 센터</h1>
        <p className={styles.lead}>승차 대기열과 하차 지점을 안전하게 관리합니다.</p>
        <form className={styles.formStack} onSubmit={handleLogin}>
          <div className={styles.fieldGroup}>
            <label htmlFor="admin-email">이메일</label>
            <input id="admin-email" autoComplete="email" inputMode="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className={styles.fieldGroup}>
            <label htmlFor="admin-password">비밀번호</label>
            <input id="admin-password" autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <button className="button button--primary" disabled={submitting} type="submit">
            {submitting ? "인증 중…" : "운영 센터 열기"}
          </button>
        </form>
      </section>
    </main>
  );
}
