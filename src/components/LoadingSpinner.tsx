"use client";

type LoadingSpinnerProps = {
  readonly message?: string;
};

export default function LoadingSpinner({ message = "주변 대기자를 검색 중입니다." }: LoadingSpinnerProps) {
  return (
    <div className="loading-spinner" role="status" aria-live="polite">
      <div className="loading-spinner__indicator" aria-hidden="true"><div className="spinner" /></div>
      <p className="loading-spinner__message">{message}</p>
    </div>
  );
}
