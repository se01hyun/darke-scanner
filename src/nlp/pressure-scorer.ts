// 심리적 압박 지수 계산
// 공식: (FOMO 키워드 밀도 × 0.4) + (압박형 어미 비율 × 0.3) + (긴급성 표현 수 × 0.3)

// 압박형 어미 패턴 — 명령/강요 뉘앙스
const PRESSURE_ENDING_PATTERNS = [
  /하세요[.!]?/g,
  /하십시오[.!]?/g,
  /바랍니다[.!]?/g,
  /놓치지\s*마세요[.!]?/g,
  /서두르세요[.!]?/g,
  /지금\s*확인하세요[.!]?/g,
];

// 긴급성 표현 패턴
const URGENCY_PATTERNS = [
  /지금\s*바로/g,
  /즉시/g,
  /빨리[^도]/g,
  /서두르/g,
  /놓치지\s*마/g,
  /오늘\s*까지/g,
  /마감\s*임박/g,
  /종료\s*임박/g,
  /한정\s*시간/g,
  /곧\s*종료/g,
];

/**
 * 텍스트의 심리적 압박 지수를 0~100으로 반환.
 * @param text 분석 대상 텍스트 (전체 페이지 텍스트 연결)
 * @param fomoHits 1단계 키워드 매칭 결과
 */
export function calcPressureScore(text: string, fomoHits: string[]): number {
  if (!text.trim()) return 0;

  const words = text.split(/\s+/);
  const totalWords = Math.max(words.length, 1);

  // 1) FOMO 키워드 밀도 (0~1)
  const keywordDensity = Math.min(fomoHits.length / totalWords, 1);

  // 2) 압박형 어미 비율 (0~1)
  let endingCount = 0;
  for (const pat of PRESSURE_ENDING_PATTERNS) {
    const m = text.match(new RegExp(pat.source, pat.flags));
    if (m) endingCount += m.length;
  }
  const endingRatio = Math.min(endingCount / totalWords, 1);

  // 3) 긴급성 표현 수 (0~1, 5개 이상 → 1)
  let urgencyCount = 0;
  for (const pat of URGENCY_PATTERNS) {
    const m = text.match(new RegExp(pat.source, pat.flags));
    if (m) urgencyCount += m.length;
  }
  const urgencyNorm = Math.min(urgencyCount / 5, 1);

  const raw = keywordDensity * 0.4 + endingRatio * 0.3 + urgencyNorm * 0.3;
  return Math.round(raw * 100);
}
