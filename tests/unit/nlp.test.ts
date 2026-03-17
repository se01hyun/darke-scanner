import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeywordMatcher } from '../../src/nlp/keyword-matcher';
import { calcPressureScore } from '../../src/nlp/pressure-scorer';
import { analyzeReviews } from '../../src/nlp/review-analyzer';
import { tokenize, cosineSim, MAX_SEQ_LEN } from '../../src/nlp/tokenizer';

// ── KeywordMatcher ─────────────────────────────────────────────────────────────

describe('KeywordMatcher.init()', () => {
  it('storage 캐시가 유효한 dict이면 해당 키워드를 사용', async () => {
    const cachedDict = { version: '2.0.0', keywords: ['특가', '한정판매'] };
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      'nlp:keyword_dict': cachedDict,
    });

    const matcher = new KeywordMatcher();
    await matcher.init();

    expect(matcher.match('특가 상품')).toContain('특가');
    expect(matcher.match('한정판매 중')).toContain('한정판매');
  });

  it('storage 캐시가 없으면 기본 dict 사용', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const matcher = new KeywordMatcher();
    await matcher.init();

    // DEFAULT_DICT에 있는 키워드
    expect(matcher.match('마감 임박입니다')).toContain('마감 임박');
  });

  it('storage 캐시가 유효하지 않으면 기본 dict 사용', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      'nlp:keyword_dict': { version: '1.0', keywords: 'invalid' }, // keywords가 배열 아님
    });

    const matcher = new KeywordMatcher();
    await matcher.init();

    expect(matcher.match('오늘만 특가')).toContain('오늘만');
  });

  it('storage 접근 실패 시 기본 dict 폴백', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('storage error'));

    const matcher = new KeywordMatcher();
    await matcher.init();

    expect(matcher.match('품절 임박')).toContain('품절 임박');
  });
});

describe('KeywordMatcher.match()', () => {
  let matcher: KeywordMatcher;

  beforeEach(async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    matcher = new KeywordMatcher();
    await matcher.init();
  });

  it('일치 키워드 반환', () => {
    const hits = matcher.match('오늘만 할인 이벤트입니다');
    expect(hits).toContain('오늘만');
  });

  it('대소문자 무시 (Flash Sale)', () => {
    const hits = matcher.match('flash sale 진행 중');
    expect(hits).toContain('Flash Sale');
  });

  it('여러 키워드 동시 탐지', () => {
    const hits = matcher.match('마감 임박! 한정 수량 남은 수량 확인하세요');
    expect(hits).toContain('마감 임박');
    expect(hits).toContain('한정 수량');
    expect(hits).toContain('남은 수량');
  });

  it('일치 없으면 빈 배열', () => {
    const hits = matcher.match('평범한 상품 설명 텍스트');
    expect(hits).toHaveLength(0);
  });

  it('빈 문자열 → 빈 배열', () => {
    expect(matcher.match('')).toHaveLength(0);
  });
});

describe('KeywordMatcher.tryRefreshRemote()', () => {
  it('ALLOWED_REMOTE_HOST가 비어 있어 즉시 반환 (fetch 호출 없음)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const matcher = new KeywordMatcher();
    await matcher.init();
    await matcher.tryRefreshRemote('https://example.com/keywords.json');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── calcPressureScore ──────────────────────────────────────────────────────────

describe('calcPressureScore', () => {
  it('빈 문자열 → 0', () => {
    expect(calcPressureScore('', [])).toBe(0);
  });

  it('공백만 있는 문자열 → 0', () => {
    expect(calcPressureScore('   ', [])).toBe(0);
  });

  it('FOMO 키워드 없고 압박 없는 텍스트 → 낮은 점수', () => {
    const score = calcPressureScore('좋은 상품을 소개합니다. 품질이 우수합니다.', []);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('FOMO 키워드 밀도 높을수록 점수 증가', () => {
    const text = '마감 임박 한정 수량 지금만';
    const noHit = calcPressureScore(text, []);
    const withHits = calcPressureScore(text, ['마감 임박', '한정 수량', '지금만']);
    expect(withHits).toBeGreaterThan(noHit);
  });

  it('압박형 어미(하세요) → 점수 증가', () => {
    const text = '지금 바로 구매하세요! 서두르세요! 놓치지 마세요!';
    const score = calcPressureScore(text, []);
    expect(score).toBeGreaterThan(0);
  });

  it('긴급성 표현(지금 바로, 즉시) → 점수 증가', () => {
    const text = '지금 바로 신청하세요. 즉시 처리됩니다. 오늘 까지만 유효합니다.';
    const score = calcPressureScore(text, []);
    expect(score).toBeGreaterThan(0);
  });

  it('FOMO + 압박 + 긴급 복합 → 높은 점수', () => {
    const text = '마감 임박! 지금 바로 구매하세요! 즉시 배송! 놓치지 마세요! 서두르세요!';
    const hits = ['마감 임박'];
    const score = calcPressureScore(text, hits);
    expect(score).toBeGreaterThan(20);
  });

  it('점수는 0~100 범위', () => {
    const extremeText = Array(100).fill('지금 바로 구매하세요 즉시 마감 임박 서두르세요').join(' ');
    const hits = Array(50).fill('마감 임박');
    const score = calcPressureScore(extremeText, hits);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('반환값은 정수', () => {
    const score = calcPressureScore('지금 바로 구매하세요', ['지금만']);
    expect(Number.isInteger(score)).toBe(true);
  });
});

// ── analyzeReviews ─────────────────────────────────────────────────────────────

describe('analyzeReviews', () => {
  it('빈 배열 → 빈 클러스터', () => {
    expect(analyzeReviews([])).toHaveLength(0);
  });

  it('리뷰 1개 → 클러스터 없음', () => {
    expect(analyzeReviews(['정말 좋은 제품입니다'])).toHaveLength(0);
  });

  it('10자 미만 짧은 리뷰는 필터링 (유효 리뷰 1개 이하)', () => {
    expect(analyzeReviews(['짧음', '짧음2'])).toHaveLength(0);
  });

  it('완전히 동일한 리뷰 → 클러스터 탐지', () => {
    const review = '이 제품은 정말 좋습니다. 배송도 빠르고 품질도 훌륭해요.';
    const clusters = analyzeReviews([review, review]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reviews).toHaveLength(2);
    expect(clusters[0].avgSimilarity).toBeCloseTo(1.0, 1);
    expect(clusters[0].isSuspicious).toBe(true);
  });

  it('매우 유사한 리뷰 → 클러스터 탐지', () => {
    const r1 = '배송이 빠르고 제품 품질이 매우 좋습니다. 다음에도 구매할 것 같습니다.';
    const r2 = '배송이 빠르고 제품 품질이 매우 좋습니다. 다음에도 구매하고 싶습니다.';
    const clusters = analyzeReviews([r1, r2]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].avgSimilarity).toBeGreaterThan(0.65);
  });

  it('완전히 다른 리뷰 → 클러스터 없음', () => {
    const r1 = '배송이 빠르고 포장이 훌륭합니다. 재구매 의사 있어요.';
    const r2 = '가격 대비 성능이 최고입니다. 색상도 예쁘고 만족스럽습니다.';
    // 단어가 겹치지 않으면 유사도 낮음
    const r3 = '처음 구매인데 실망이에요. 사진과 달리 소재가 별로입니다.';
    const clusters = analyzeReviews([r1, r2, r3]);
    // 완전히 다른 리뷰들은 클러스터가 없거나 1개 이하여야 함
    expect(clusters.length).toBeLessThanOrEqual(1);
  });

  it('3개의 동일한 리뷰 → 클러스터 1개에 모두 포함', () => {
    const review = '이 상품은 정말 훌륭합니다. 가격도 저렴하고 품질도 최고입니다.';
    const clusters = analyzeReviews([review, review, review]);
    const totalReviews = clusters.reduce((sum, c) => sum + c.reviews.length, 0);
    expect(totalReviews).toBeGreaterThanOrEqual(2);
  });

  it('avgSimilarity는 0~1 범위', () => {
    const review = '좋은 제품입니다. 품질이 만족스럽습니다. 재구매할 의사가 있습니다.';
    const clusters = analyzeReviews([review, review]);
    if (clusters.length > 0) {
      expect(clusters[0].avgSimilarity).toBeGreaterThanOrEqual(0);
      expect(clusters[0].avgSimilarity).toBeLessThanOrEqual(1);
    }
  });
});

// ── tokenizer ─────────────────────────────────────────────────────────────────

describe('tokenize()', () => {
  const CLS = 101n;
  const SEP = 102n;
  const PAD = 0n;

  it('첫 번째 토큰이 [CLS](101)', () => {
    const { inputIds } = tokenize('안녕하세요');
    expect(inputIds[0]).toBe(CLS);
  });

  it('마지막 실제 토큰이 [SEP](102)', () => {
    const { inputIds } = tokenize('안녕');
    // CLS + 토큰들 + SEP 뒤로 PAD
    const sepIdx = Array.from(inputIds).findIndex((id) => id === SEP);
    expect(sepIdx).toBeGreaterThan(0);
  });

  it('SEP 이후는 모두 [PAD](0)', () => {
    const { inputIds } = tokenize('짧은 텍스트');
    const sepIdx = Array.from(inputIds).findIndex((id) => id === SEP);
    for (let i = sepIdx + 1; i < inputIds.length; i++) {
      expect(inputIds[i]).toBe(PAD);
    }
  });

  it('attentionMask: 실제 토큰 1, 패딩 0', () => {
    const { inputIds, attentionMask } = tokenize('테스트');
    for (let i = 0; i < MAX_SEQ_LEN; i++) {
      if (inputIds[i] !== PAD) {
        expect(attentionMask[i]).toBe(1n);
      } else {
        expect(attentionMask[i]).toBe(0n);
      }
    }
  });

  it('tokenTypeIds 전부 0', () => {
    const { tokenTypeIds } = tokenize('임의 텍스트');
    for (const v of tokenTypeIds) {
      expect(v).toBe(0n);
    }
  });

  it('출력 길이가 maxLen과 동일', () => {
    const { inputIds, attentionMask, tokenTypeIds } = tokenize('텍스트');
    expect(inputIds.length).toBe(MAX_SEQ_LEN);
    expect(attentionMask.length).toBe(MAX_SEQ_LEN);
    expect(tokenTypeIds.length).toBe(MAX_SEQ_LEN);
  });

  it('긴 텍스트는 maxLen으로 잘림 — SEP이 항상 존재', () => {
    const longText = '가 '.repeat(200);
    const { inputIds } = tokenize(longText);
    const hasSep = Array.from(inputIds).includes(SEP);
    expect(hasSep).toBe(true);
    // maxLen 초과 없음
    expect(inputIds.length).toBe(MAX_SEQ_LEN);
  });

  it('빈 텍스트 → CLS + SEP + PAD…', () => {
    const { inputIds } = tokenize('');
    expect(inputIds[0]).toBe(CLS);
    expect(inputIds[1]).toBe(SEP);
    expect(inputIds[2]).toBe(PAD);
  });

  it('사용자 정의 maxLen 적용', () => {
    const { inputIds } = tokenize('짧은 텍스트입니다', 16);
    expect(inputIds.length).toBe(16);
  });
});

// ── cosineSim ─────────────────────────────────────────────────────────────────

describe('cosineSim()', () => {
  it('동일 벡터 → 유사도 1.0', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSim(a, a)).toBeCloseTo(1.0, 5);
  });

  it('직교 벡터 → 유사도 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSim(a, b)).toBeCloseTo(0, 5);
  });

  it('반대 방향 벡터 → 유사도 -1', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSim(a, b)).toBeCloseTo(-1, 5);
  });

  it('영벡터 포함 → 0 반환 (divide-by-zero 방지)', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSim(a, b)).toBe(0);
  });

  it('두 영벡터 → 0 반환', () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([0, 0]);
    expect(cosineSim(a, b)).toBe(0);
  });

  it('유사도 범위 -1 ~ 1', () => {
    const a = new Float32Array([0.5, 0.3, 0.8, 0.1]);
    const b = new Float32Array([0.2, 0.9, 0.4, 0.7]);
    const sim = cosineSim(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
  });
});
