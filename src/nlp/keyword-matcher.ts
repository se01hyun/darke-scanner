// FOMO 키워드 사전 매칭 — 1단계 fast path
// 원격 JSON 갱신 지원 (HTTPS 고정 도메인, 스키마 검증, 버전 비교, 실패 시 캐시 유지)

const CACHE_KEY = 'nlp:keyword_dict';

// 원격 갱신을 허용하는 호스트 (빈 문자열이면 원격 갱신 비활성화)
const ALLOWED_REMOTE_HOST = '';

interface KeywordDict {
  version: string;
  keywords: string[];
}

function isValidDict(obj: unknown): obj is KeywordDict {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as KeywordDict).version === 'string' &&
    Array.isArray((obj as KeywordDict).keywords) &&
    (obj as KeywordDict).keywords.every((k) => typeof k === 'string')
  );
}

// 번들 기본 키워드 사전 (rules/fomo-keywords.json 내용과 동기화)
const DEFAULT_DICT: KeywordDict = {
  version: '1.0.0',
  keywords: [
    '마감 임박', '품절 임박', '한정 수량', '지금만', '오늘만',
    '마지막 기회', '곧 종료', '남은 수량', '재고 부족',
    '지금 보고 있는', '명이 보고 있습니다', '방금 구매',
    '특가 마감', '타임세일', 'Flash Sale', 'Limited',
  ],
};

export class KeywordMatcher {
  private keywords: string[] = [];

  async init(): Promise<void> {
    // 1. 캐시 우선 로드
    try {
      const cached = await chrome.storage.local.get(CACHE_KEY);
      const dict: unknown = cached[CACHE_KEY];
      if (isValidDict(dict)) {
        this.keywords = dict.keywords;
        return;
      }
    } catch {
      // storage 접근 실패 시 기본값으로 폴백
    }
    this.keywords = DEFAULT_DICT.keywords;
  }

  /** 원격 URL에서 키워드 사전 갱신 시도. 실패 시 기존 캐시 유지. */
  async tryRefreshRemote(remoteUrl: string): Promise<void> {
    if (!ALLOWED_REMOTE_HOST) return;

    try {
      const url = new URL(remoteUrl);
      // HTTPS + 허용 호스트 검증
      if (url.protocol !== 'https:' || url.hostname !== ALLOWED_REMOTE_HOST) return;

      const resp = await fetch(remoteUrl, { cache: 'no-store' });
      if (!resp.ok) return;

      const data: unknown = await resp.json();
      if (!isValidDict(data)) return;

      // 버전 비교 — 동일 버전이면 갱신 불필요
      const cached = await chrome.storage.local.get(CACHE_KEY);
      const existing = cached[CACHE_KEY] as KeywordDict | undefined;
      if (existing?.version === data.version) return;

      await chrome.storage.local.set({ [CACHE_KEY]: data });
      this.keywords = data.keywords;
    } catch {
      // 네트워크 실패 / JSON 파싱 실패 → 로컬 캐시 유지
    }
  }

  /** 텍스트에서 일치하는 키워드 목록 반환 */
  match(text: string): string[] {
    const lower = text.toLowerCase();
    return this.keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  }
}
