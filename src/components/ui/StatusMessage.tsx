import type { ReactNode } from "react";
import { StatusIcon, type StatusTone } from "./StatusIcon";

type StatusMessageProps = {
  readonly tone: StatusTone;
  readonly title: string;
  readonly children?: ReactNode;
  readonly live?: "polite" | "assertive" | "off";
  readonly className?: string;
};

export function StatusMessage({ tone, title, children, live = "off", className }: StatusMessageProps) {
  const classNames = ["status-message", `status-message--${tone}`, className]
    .filter(Boolean)
    .join(" ");
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;

  return (
    <div className={classNames} role={role} aria-live={live === "off" ? undefined : live}>
      <StatusIcon tone={tone} />
      <div>
        <p className="status-message__title">{title}</p>
        {children ? <div className="status-message__description">{children}</div> : null}
      </div>
    </div>
  );
}
