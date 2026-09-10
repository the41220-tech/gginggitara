/**
 * 예금주 마스킹 유틸.
 *
 * 규칙:
 *   2글자: 뒤 1글자 마스킹 (김철 → 김*)
 *   3글자: 가운데 마스킹 (홍길동 → 홍*동)
 *   4글자+: 첫/마지막만 보이고 중간 마스킹 (최하늘별 → 최**별)
 */
export function maskAccountHolder(name: string): string {
  const characters = Array.from(name.trim());
  if (characters.length === 0) return "";
  if (characters.length === 1) return characters[0];
  if (characters.length === 2) return characters[0] + "*";
  if (characters.length === 3) return characters[0] + "*" + characters[2];
  // 4글자 이상
  return characters[0] + "*".repeat(characters.length - 2) + characters[characters.length - 1];
}
