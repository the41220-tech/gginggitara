const adjectives = [
  "신속한", "즐거운", "함께하는", "나누는", "푸른", "하얀", "빛나는", "따뜻한",
  "친절한", "똑똑한", "용감한", "느긋한", "명랑한", "활기찬", "당당한", "고요한"
];

const nouns = [
  "고양이", "강아지", "호랑이", "독수리", "사자", "토끼", "다람쥐", "곰",
  "별", "달", "햇살", "구름", "바람", "바다", "나무", "강물"
];

export function generateNickname(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}${noun}${num}`;
}
