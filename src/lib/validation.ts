/**
 * Security validation utilities
 * 모든 API 라우트에서 공통으로 사용하는 검증 함수들
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate that a value is a valid UUID v4 string
 */
export function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_REGEX.test(value);
}

/**
 * Sanitize internal error messages — never expose DB/internal errors to client
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    console.error("[Internal Error]", error.message);
  } else if (error && typeof error === 'object' && 'message' in error) {
    // Supabase PostgrestError has code, message, details, hint
    const pgErr = error as { code?: string; message?: string; details?: string; hint?: string };
    console.error("[Internal Error]", JSON.stringify({
      code: pgErr.code,
      message: pgErr.message,
      details: pgErr.details,
      hint: pgErr.hint,
    }));
  } else {
    console.error("[Internal Error]", error);
  }
  return "서버 오류가 발생했습니다.";
}
