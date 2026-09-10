"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

type ConfirmDialogProps = {
  readonly open: boolean;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: "default" | "danger";
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = "취소", tone = "default", busy = false, onConfirm, onClose }: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current
        ? [...panelRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")].filter((element) => element.tabIndex >= 0)
        : [];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panelRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [busy, onClose, open]);

  if (!open) return null;
  const confirmClassName = tone === "danger" ? "button button--danger" : "button button--primary";

  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={panelRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <h2 id={titleId} className="dialog__title">{title}</h2>
        <div id={descriptionId} className="dialog__description">{description}</div>
        <div className="dialog__actions">
          <button ref={cancelButtonRef} type="button" className="button button--secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={confirmClassName} onClick={onConfirm} disabled={busy}>{busy ? "처리 중…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
