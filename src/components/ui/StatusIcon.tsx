type StatusTone = "success" | "info" | "warning" | "error";

type StatusIconProps = {
  readonly tone: StatusTone;
  readonly label?: string;
  readonly className?: string;
};

export function StatusIcon({ tone, label, className }: StatusIconProps) {
  const classNames = ["status-icon", `status-icon--${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classNames} aria-hidden={label ? undefined : "true"}>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export type { StatusTone };
