// Phase 1 MVP — DOM Scanner
// 공정위 기준 17(시간제한 알림), 18(낮은 재고 알림), 3·10(몰래 장바구니 추가 / 특정옵션의 사전선택) 구현
// Phase 5 — 기준 9(잘못된 계층구조 / 취소 버튼 시각적 약화) 추가, QA 로깅 추가

import type { DarkPatternDetection } from '../types';
import { generateId } from '../utils/id';
import { getElementInfo, getContrastRatio } from '../utils/element';
import { logger } from '../utils/debug-logger';
import domSelectors from '../../rules/dom-selectors.json';
import fomoKeywords from '../../rules/fomo-keywords.json';

// ── TreeWalker 헬퍼 ──────────────────────────────────────────────────────────
// <script>, <style>, <noscript>, <template> 내부 텍스트는 화면에 표시되지 않으므로
// 모든 텍스트 노드 순회 시 이 태그를 부모로 갖는 노드는 처음부터 필터링한다.
const INVISIBLE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
function makeTextWalker(): TreeWalker {
  return document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => INVISIBLE_TAGS.has(n.parentElement?.tagName ?? '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT },
  );
}

// ─── 가이드라인 12: 취소 버튼 시각적 약화 상수 ──────────────────────────────
// 텍스트에 포함된 단어로 버튼 역할을 분류
const ACCEPT_KEYWORDS = ['동의', '확인', '구매', '결제', '신청', '시작', '계속', '주문', '구독', '동의하기', '확인하기'];
const CANCEL_KEYWORDS = ['취소', '거절', '아니요', '아니오', '닫기', '나중에', '건너뛰기', '거부', '뒤로'];

// WCAG AA 기준(4.5:1) 미만이면 가독성 부족; 3.0:1 미만은 매우 낮음
const CONTRAST_WEAK_THRESHOLD    = 3.0;
const CONTRAST_ACCEPT_THRESHOLD  = 4.5;
// 취소 버튼 폰트가 동의 버튼 대비 이 비율 미만이면 약화 신호
const FONT_RATIO_THRESHOLD = 0.85;
// 불투명도가 이 값 미만이면 약화 신호
const OPACITY_THRESHOLD = 0.70;

// hh:mm 또는 hh:mm:ss 형태의 카운트다운 텍스트 패턴
const COUNTDOWN_TEXT_RE = /\d{1,2}:\d{2}(:\d{2})?/;

// ─── 가이드라인 17: 카운트다운 소스 분석 ──────────────────────────────────────
type TimerSource = 'server_driven' | 'client_reset' | 'client_only' | 'external_script' | 'unknown';

/**
 * 카운트다운 요소가 서버 데이터 기반인지 순수 클라이언트 로직인지 판별한다.
 *
 * 판별 순서:
 *  1. 요소의 data-* 속성에 숫자값 포함 → 서버 렌더링 마감 시한 (server_driven)
 *  2. 인라인 스크립트 내 타이머 만료 후 초기화 패턴 → 허위 긴박감 (client_reset)
 *  3. fetch() URL에 time/deadline/expire/remain 키워드 → 서버 연동 (server_driven)
 *  4. setInterval + 감소 연산, fetch 없음 → 순수 클라이언트 (client_only)
 *  5. 외부 스크립트만 존재 → CORS로 분석 불가 (external_script)
 *  6. 판별 불가 → unknown
 */
function analyzeTimerSource(el: HTMLElement): TimerSource {
  // 1. 서버 렌더링 data 속성 (data-end-time, data-deadline 등)
  const serverAttrRe = /^data-(end[_-]?time|deadline|expire|target[_-]?time|countdown[_-]?end|finish[_-]?at|remaining)/i;
  const hasServerAttr = Array.from(el.attributes).some(
    (a) => serverAttrRe.test(a.name) && /\d/.test(a.value)
  );
  if (hasServerAttr) return 'server_driven';

  // 인라인 스크립트 전체 수집
  const inlineSrc = Array.from(document.querySelectorAll<HTMLScriptElement>('script:not([src])'))
    .map((s) => s.textContent ?? '')
    .join('\n');

  // 인라인 스크립트가 없고 외부 스크립트가 존재하면 CORS로 분석 불가
  const hasExternalScripts = document.querySelectorAll('script[src]').length > 0;
  if (!inlineSrc.trim() && hasExternalScripts) return 'external_script';
  if (!inlineSrc.trim()) return 'unknown';

  // 2. 타이머 만료(≤0) 후 초기값 재할당 → 허위 긴박감 가장 강한 신호
  // 예: if (timer <= 0) timer = 300;  /  if (count === 0) count = resetVal;
  if (/(?:<=|===|==)\s*0[\s\S]{0,100}=\s*\d{2,}/.test(inlineSrc)) return 'client_reset';

  // 3. fetch() URL에 시간 관련 키워드 포함 → 서버에서 마감 시한 수신
  if (/fetch\s*\(\s*['"`][^'"`]*(?:time|timer|countdown|deadline|expire|remain)[^'"`]*['"`]/i.test(inlineSrc)) {
    return 'server_driven';
  }

  // 4. setInterval/setTimeout + 감소 연산 (fetch 없음) → 순수 클라이언트
  const hasInterval = /set(?:Interval|Timeout)\s*\(/.test(inlineSrc);
  const hasDecrement = /(?:--[\w$]+|[\w$]+\s*-=\s*1)/.test(inlineSrc);
  const hasFetch = /(?:fetch\s*\(|new\s+XMLHttpRequest|axios\s*\.)/.test(inlineSrc);
  if (hasInterval && hasDecrement && !hasFetch) return 'client_only';

  // 5. 인라인 스크립트는 있지만 패턴 미매칭 + 외부 스크립트도 존재
  if (hasExternalScripts) return 'external_script';

  return 'unknown';
}

// 텍스트 노드 스캔 시 최대 탐지 수 (오탐 flood 방지)
const MAX_TEXT_DETECTIONS = 5;

// ─── 가이드라인 4: 거짓할인 상수 ─────────────────────────────────────────────
// "50% 할인", "30% OFF" 등의 패턴
const DISCOUNT_TEXT_RE = /(\d{1,3})\s*%\s*(할인|OFF|SALE|세일)/i;
// 원래 가격을 나타내는 취소선 요소 선택자
const ORIGIN_PRICE_SELECTORS = [
  'del', 's', '[class*="origin"]', '[class*="before-price"]',
  '[class*="original-price"]', '[class*="list-price"]', '[class*="org-price"]',
];

// ─── 가이드라인 11: 취소·탈퇴 방해 상수 ──────────────────────────────────────
// 취소·해지 관련 레이블
const CANCEL_SERVICE_TERMS = [
  '해지', '탈퇴', '구독취소', '구독 취소', '회원탈퇴', '이용취소', '서비스 해지', '해약',
];
const CANCEL_OPACITY_THRESHOLD = 0.5;
const CANCEL_FONT_THRESHOLD    = 12; // px

// ─── 가이드라인 13: 가격비교 방해 상수 ───────────────────────────────────────
const COMPARISON_PREVENTION_TERMS = [
  '가격문의', '가격 문의', '가격협의', '가격 협의',
  '별도문의', '별도 문의', '문의바람', '협의요망', '전화문의', '전화 문의',
];

// ─── 가이드라인 15: 반복간섭 상수 ────────────────────────────────────────────
const NAGGING_CTA_KEYWORDS = [
  '구독하기', '알림받기', '알림 받기', '동의하기',
  '이벤트 참여', '혜택받기', '혜택 받기', '지금 가입',
];

// ─── 가이드라인 7: 위장광고 상수 ─────────────────────────────────────────────
// 광고 요소 주변에 이 텍스트 중 하나라도 있으면 정상 고지로 간주 → 스킵
const AD_DISCLOSURE_KEYWORDS = ['광고', '스폰서', '협찬', 'AD', 'Sponsored', 'ADVERTISEMENT', '유료광고', 'Paid'];
// 광고 요소의 텍스트/타이틀에 이 단어가 있어도 스킵 (광고주가 자체 표시한 경우)
const AD_SELF_LABEL_RE = /광고|스폰서|AD\b|Sponsored|협찬/i;

// ─── 가이드라인 6: 유인판매 상수 ──────────────────────────────────────────────
// 품절/단종 상태 신호 키워드
const SOLDOUT_TERMS = ['품절', '단종', '판매종료', '재고없음', '일시품절', '구매불가', '판매중지'];
// 같은 상품 컨텍스트에 함께 있으면 대체 상품 유도로 간주
const BAIT_SWITCH_ALT_TERMS = ['대신', '유사상품', '관련상품', '추천상품', '다른 상품', '대체상품', '함께 보기'];
// 상품 상세 컨텍스트 선택자
const PRODUCT_CTX_SELECTOR = '[class*="product"],[class*="goods"],[class*="item"],[class*="detail"]';
// 유인판매 탐지에서 제외할 사용자 생성 콘텐츠 영역
// — 고객 리뷰·Q&A 안의 "품절"·"대신" 언급은 판매자 패턴이 아님
const REVIEW_CTX_SELECTOR = [
  '[class*="review"]', '[class*="comment"]', '[class*="후기"]',
  '[class*="opinion"]', '[class*="rating"]', '[class*="qna"]',
  '[class*="문의"]',   '[class*="답변"]',   '[class*="reply"]',
].join(',');

// ─── 가이드라인 14: 클릭 피로감 상수 ──────────────────────────────────────────
const CLICK_FATIGUE_STEP_THRESHOLD     = 5;  // 이 단계 수 이상이면 탐지
const CLICK_FATIGUE_CHECKBOX_THRESHOLD = 8;  // 동의 팝업 내 체크박스가 이 수 이상이면 탐지
const CONSENT_KEYWORDS = ['약관', '동의', '개인정보', '수집', '이용', '동의하기'];

// ─── 가이드라인 2: 순차공개 가격책정 상수 ─────────────────────────────────────
// 추가 비용 항목으로 간주하는 키워드
const DRIP_PRICE_TERMS = [
  '배송비', '배달비', '택배비', '배송료',
  '수수료', '결제수수료', '할부수수료',
  '부가세', '세금', 'VAT',
  '설치비', '가입비', '포장비',
  '추가금액', '추가비용', '추가요금',
  '별도 부과', '별도 청구', '별도청구',
  '보험료', '보험',
];
// display:none / visibility:hidden 이거나 이 px 미만 소자이면 숨겨진 비용으로 판단
const DRIP_HIDDEN_FONT_THRESHOLD = 10;

// ─── 가이드라인 19: 다른 소비자 활동 알림 상수 ────────────────────────────────
// "현재 N명이 보고 있습니다", "방금 구매했습니다" 등 실시간 활동 패턴
// 판매자의 소셜 프루프 배너는 반드시 인원 단위('명')를 포함한다.
// '명' 없이 '방금구매했는데' 처럼 고객 본인이 서술하는 문장은 탐지하지 않는다.
const SOCIAL_PROOF_RE = /(?:현재|지금|방금|오늘|최근)\s*\d*\s*명\s*(?:이|가)?\s*(?:보고\s*있|구경\s*중|조회\s*중|구매(?:했|완료)|주문(?:했|완료)|담았|관심)/;
const SOCIAL_PROOF_NUMBER_RE = /\d+\s*명\s*(?:이|가)?\s*(?:함께\s*)?(?:구경|보는|보고|구매한?|주문한?|담은|찜한?)/;

// ─── 가이드라인 12: 숨겨진 정보 상수 ────────────────────────────────────────
// 이 단어가 포함된 텍스트가 매우 작은 폰트로 표시되면 숨겨진 정보로 탐지
const HIDDEN_INFO_TERMS = [
  '환불', '취소', '약관', '수수료', '위약금', '자동갱신', '자동결제',
  '별도청구', '추가비용', '유료전환', '청약철회', '면책',
];
// font-size 이 값(px) 미만이면 "숨겨진" 텍스트로 판단
const HIDDEN_FONT_THRESHOLD = 11;

export class DOMScanner {
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    this.scan();
    this.watchDynamicChanges();
    this.watchSPANavigation();
    this.watchInputPropertyChanges();
  }

  private scan(): void {
    const t0 = performance.now();
    logger.group(`DOM Scan — ${document.location.href}`);

    const countdown        = this.detectCountdown();
    const stockWarning     = this.detectStockWarning();
    const preselected      = this.detectPreselectedOptions();
    const weakenedCancel   = this.detectVisuallyWeakenedCancel();
    const disguisedAds     = this.detectDisguisedAds();
    const hiddenInfo       = this.detectHiddenInformation();
    const falseDiscount    = this.detectFalseDiscount();
    const hardToCancel     = this.detectHardToCancel();
    const comparisonPrev   = this.detectComparisonPrevention();
    const nagging          = this.detectNagging();
    const baitAndSwitch    = this.detectBaitAndSwitch();
    const clickFatigue     = this.detectClickFatigue();
    const dripPricing      = this.detectDripPricingDOM();
    const socialProof      = this.detectSocialProofDOM();

    const raw: DarkPatternDetection[] = [
      ...countdown, ...stockWarning, ...preselected, ...weakenedCancel,
      ...disguisedAds, ...hiddenInfo,
      ...falseDiscount, ...hardToCancel, ...comparisonPrev, ...nagging,
      ...baitAndSwitch, ...clickFatigue,
      ...dripPricing, ...socialProof,
    ];

    // 같은 가이드라인 번호로 중첩된 요소 탐지 시 가장 바깥쪽 요소 하나만 유지
    const detections = this.deduplicateOverlapping(raw);

    logger.log('DOM', `스캔 완료 ${(performance.now() - t0).toFixed(1)}ms | 총 ${detections.length}건 (중복제거 전 ${raw.length}건)`
      + ` (카운트다운:${countdown.length} 재고:${stockWarning.length} 사전선택:${preselected.length}`
      + ` 약화취소:${weakenedCancel.length} 위장광고:${disguisedAds.length} 숨겨진정보:${hiddenInfo.length}`
      + ` 거짓할인:${falseDiscount.length} 취소방해:${hardToCancel.length}`
      + ` 가격비교방해:${comparisonPrev.length} 반복간섭:${nagging.length}`
      + ` 유인판매:${baitAndSwitch.length} 클릭피로감:${clickFatigue.length}`
      + ` 드립프라이싱:${dripPricing.length} 소비자활동알림:${socialProof.length})`);
    logger.detections('DOM', detections);
    logger.groupEnd();

    this.sendToBackground(detections);
  }

  // ─── 공정위 기준 17번: 시간제한 알림 (False Urgency) ────────────────────────
  private detectCountdown(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    for (const selector of domSelectors.selectors.countdown) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        const text = (el.textContent ?? '').trim();
        const hasTimePattern = COUNTDOWN_TEXT_RE.test(text);
        const timerSource = analyzeTimerSource(el);

        logger.log('DOM:카운트다운',
          `selector="${selector}" hasTime=${hasTimePattern} source=${timerSource} text="${text.slice(0, 80)}"`);

        // 타이머 소스에 따라 심각도·확신도·설명 분기
        type CountdownMeta = { severity: DarkPatternDetection['severity']; confidence: DarkPatternDetection['confidence']; description: string };
        const meta: CountdownMeta = ((): CountdownMeta => {
          switch (timerSource) {
            case 'client_reset':
              return {
                severity: 'high',
                confidence: 'confirmed',
                description: '카운트다운이 만료 후 자동으로 재시작됩니다. 실제 마감 시한이 없는 허위 긴박감 조성으로 확인됩니다.',
              };
            case 'client_only':
              return {
                severity: 'medium',
                confidence: 'suspicious',
                description: '카운트다운이 서버 데이터 없이 클라이언트 코드만으로 동작합니다. 실제 마감 시한과 무관할 가능성이 높습니다.',
              };
            case 'server_driven':
              return {
                severity: 'low',
                confidence: 'suspicious',
                description: '카운트다운 타이머가 서버 데이터와 연동된 것으로 보입니다. 실제 마감 시한일 가능성이 있으나 직접 확인을 권장합니다.',
              };
            case 'external_script':
              return {
                severity: 'medium',
                confidence: hasTimePattern ? 'confirmed' : 'suspicious',
                description: '타이머 로직이 외부 스크립트에 있어 서버 연동 여부를 자동 판별할 수 없습니다 (브라우저 보안 정책으로 외부 JS 소스 접근 불가).',
              };
            default:
              return {
                severity: 'medium',
                confidence: hasTimePattern ? 'confirmed' : 'suspicious',
                description: '카운트다운 타이머가 감지되었습니다. 실제 마감 시한인지 확인이 필요합니다.',
              };
          }
        })();

        detections.push({
          id: generateId(),
          guideline: 17,
          guidelineName: '시간제한 알림',
          severity: meta.severity,
          confidence: meta.confidence,
          module: 'dom',
          description: meta.description,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, text: text.slice(0, 100), timerSource },
          },
          element: getElementInfo(el),
        });
      });
    }

    return detections;
  }

  // ─── 공정위 기준 18번: 낮은 재고 알림 (Scarcity) ───────────────────────────
  private detectStockWarning(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    // 1) CSS 선택자 기반 탐지 (confirmed 우선)
    for (const selector of domSelectors.selectors.stock_warning) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        const text = (el.textContent ?? '').trim();
        if (!text) return;

        const matched = fomoKeywords.keywords.find((kw) => text.includes(kw));
        const hasQuantityDigit = /\d/.test(text);

        // 오탐 방지: FOMO 키워드도 없고 수량 숫자도 없으면 스킵
        // (예: class="stock-photo", class="stock-list" 등 무관한 요소 제외)
        if (!matched && !hasQuantityDigit) {
          logger.warn('DOM:재고', `오탐 후보 스킵 — selector="${selector}" text="${text.slice(0, 60)}"`);
          return;
        }

        logger.log('DOM:재고', `탐지 — selector="${selector}" keyword="${matched ?? '(없음)'}" text="${text.slice(0, 80)}"`);

        detections.push({
          id: generateId(),
          guideline: 18,
          guidelineName: '낮은 재고 알림',
          severity: 'medium',
          confidence: matched ? 'confirmed' : 'suspicious',
          module: 'dom',
          description: `재고 부족을 강조하는 문구가 감지되었습니다${matched ? `: "${matched}"` : ''}.`,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, matchedKeyword: matched ?? null, text: text.slice(0, 100) },
          },
          element: getElementInfo(el),
        });
      });
    }

    // 2) 텍스트 노드 키워드 스캔 (선택자 미매칭 케이스 보완)
    let textHitCount = 0;
    const walker = makeTextWalker();
    let node: Node | null;

    while ((node = walker.nextNode()) && textHitCount < MAX_TEXT_DETECTIONS) {
      const text = node.textContent ?? '';
      const matched = fomoKeywords.keywords.find((kw) => text.includes(kw));
      if (!matched) continue;

      const parent = node.parentElement;
      if (!parent) continue;
      // 이미 선택자로 잡힌 요소의 자식이면 중복 제외
      if (seen.has(parent) || parent.closest('[class*="stock"],[class*="remain"],[class*="limited"]')) continue;

      seen.add(parent);
      textHitCount++;

      detections.push({
        id: generateId(),
        guideline: 18,
        guidelineName: '낮은 재고 알림',
        severity: 'low',
        confidence: 'suspicious',
        module: 'dom',
        description: `FOMO 유발 문구가 감지되었습니다: "${matched}"`,
        evidence: {
          type: 'text_analysis',
          raw: text.trim().slice(0, 200),
          detail: { matchedKeyword: matched },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 3·10번: 몰래 장바구니 추가 / 특정옵션의 사전선택 ────────────
  private detectPreselectedOptions(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<HTMLInputElement>();

    // 탐지 객체 생성 헬퍼
    const makeDetection = (el: HTMLInputElement, isJsDriven: boolean): DarkPatternDetection => {
      const label = this.findLabel(el)?.trim() ?? null;
      const labelLower = label?.toLowerCase() ?? '';

      // 레이블에 상업적 추가 항목을 암시하는 단어가 있으면 더 심각한 유형으로 분류
      // '선택'은 제외 — "배송지 선택", "사이즈 선택" 등 정상 레이블과 혼동되어 오탐 발생
      const isSneaking =
        labelLower.includes('추가') ||
        labelLower.includes('보험') ||
        labelLower.includes('구독') ||
        labelLower.includes('동의');

      logger.log('DOM:사전선택',
        `isSneaking=${isSneaking} jsDriven=${isJsDriven} label="${label ?? '(없음)'}" type=${el.type} id=${el.id}`);

      return {
        id: generateId(),
        guideline: isSneaking ? 3 : 10,
        guidelineName: isSneaking ? '몰래 장바구니 추가' : '특정옵션의 사전선택',
        severity: isSneaking ? 'high' : 'medium',
        confidence: isSneaking ? 'confirmed' : 'suspicious',
        module: 'dom',
        description: `동의 없이 기본 선택된 옵션이 감지되었습니다${label ? `: "${label}"` : ''}.${isJsDriven ? ' (스크립트로 동적 선택됨)' : ''}`,
        evidence: {
          type: 'dom_element',
          raw: el.outerHTML.slice(0, 300),
          detail: { label, inputType: el.type, isJsDriven },
        },
        element: getElementInfo(el),
      };
    };

    // 1) HTML checked 속성 기반 탐지 (기존)
    for (const selector of domSelectors.selectors.preselected_options) {
      document.querySelectorAll<HTMLInputElement>(selector).forEach((el) => {
        if (el.required || seen.has(el)) return;
        seen.add(el);
        detections.push(makeDetection(el, false));
      });
    }

    // 2) .checked 프로퍼티 기반 탐지 — HTML attribute 없이 JS로 동적 세팅된 경우
    // el.checked === true && el.defaultChecked === false → 스크립트가 페이지 로드 후 선택
    document.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"], input[type="radio"]',
    ).forEach((el) => {
      if (el.required || seen.has(el) || !el.checked || el.defaultChecked) return;
      seen.add(el);
      detections.push(makeDetection(el, true));
    });

    return detections;
  }

  // ─── 공정위 기준 9번: 잘못된 계층구조 (취소 버튼 시각적 약화) ──────────────
  private detectVisuallyWeakenedCancel(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];

    // 버튼 역할을 할 수 있는 모든 요소 수집
    const allButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
      ),
    );

    const acceptButtons: HTMLElement[] = [];
    const cancelButtons: HTMLElement[] = [];

    for (const btn of allButtons) {
      const text = (btn.textContent ?? '').trim();
      if (ACCEPT_KEYWORDS.some((kw) => text.includes(kw))) acceptButtons.push(btn);
      else if (CANCEL_KEYWORDS.some((kw) => text.includes(kw))) cancelButtons.push(btn);
    }

    for (const cancelBtn of cancelButtons) {
      const acceptBtn = this.findNearbyButton(cancelBtn, acceptButtons);
      if (!acceptBtn) continue;

      const cancelContrast = getContrastRatio(cancelBtn);
      const acceptContrast = getContrastRatio(acceptBtn);
      const cancelFontSize = parseFloat(getComputedStyle(cancelBtn).fontSize);
      const acceptFontSize = parseFloat(getComputedStyle(acceptBtn).fontSize);
      const cancelOpacity  = parseFloat(getComputedStyle(cancelBtn).opacity);

      // 각 신호를 독립적으로 평가
      const signals: string[] = [];

      if (cancelContrast < CONTRAST_WEAK_THRESHOLD && acceptContrast >= CONTRAST_ACCEPT_THRESHOLD) {
        signals.push(
          `대비율: 취소(${cancelContrast.toFixed(1)}:1) vs 동의(${acceptContrast.toFixed(1)}:1)`,
        );
      }
      if (acceptFontSize > 0 && cancelFontSize < acceptFontSize * FONT_RATIO_THRESHOLD) {
        signals.push(
          `글자 크기: 취소(${cancelFontSize}px) < 동의(${acceptFontSize}px)`,
        );
      }
      if (cancelOpacity < OPACITY_THRESHOLD) {
        signals.push(`불투명도: 취소 버튼 ${(cancelOpacity * 100).toFixed(0)}%`);
      }

      if (signals.length === 0) continue;

      logger.log('DOM:취소버튼약화',
        `cancel="${(cancelBtn.textContent ?? '').trim().slice(0, 30)}" `
        + `accept="${(acceptBtn.textContent ?? '').trim().slice(0, 30)}" `
        + `신호: ${signals.join(' | ')}`);

      detections.push({
        id: generateId(),
        guideline: 9,
        guidelineName: '잘못된 계층구조',
        // 두 가지 이상 신호가 겹치면 medium, 하나면 low
        severity: signals.length >= 2 ? 'medium' : 'low',
        confidence: 'suspicious',
        module: 'dom',
        description:
          '취소/거절 버튼이 동의/확인 버튼에 비해 시각적으로 약화되어 있어 사용자 선택을 유도할 가능성이 있습니다.',
        evidence: {
          type: 'dom_element',
          raw: cancelBtn.outerHTML.slice(0, 300),
          detail: {
            signals,
            cancelText: (cancelBtn.textContent ?? '').trim().slice(0, 50),
            acceptText: (acceptBtn.textContent ?? '').trim().slice(0, 50),
            cancelContrast: parseFloat(cancelContrast.toFixed(2)),
            acceptContrast: parseFloat(acceptContrast.toFixed(2)),
            cancelFontSize,
            acceptFontSize,
            cancelOpacity,
          },
        },
        element: getElementInfo(cancelBtn),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 7번: 위장광고 (Disguised Ads) ──────────────────────────────
  // 광고 속성·클래스가 있는 요소 주변에 공식 광고 표시(고지 텍스트)가 없으면 탐지
  private detectDisguisedAds(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    for (const selector of domSelectors.selectors.disguised_ads) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        // 보이지 않는 요소는 스킵 (숨겨진 광고 컨테이너 등)
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        // 요소 자신 또는 인접 영역에 광고 고지 텍스트가 있으면 정상 광고 → 스킵
        const areaText = this.getAdDisclosureArea(el);
        if (AD_DISCLOSURE_KEYWORDS.some((kw) => areaText.includes(kw))) {
          logger.log('DOM:위장광고', `고지 확인됨 — 스킵 (selector="${selector}")`);
          return;
        }
        // 요소 자체 title/aria-label에 광고 자체 레이블이 있어도 스킵
        const title = el.getAttribute('title') ?? '';
        const aria  = el.getAttribute('aria-label') ?? '';
        if (AD_SELF_LABEL_RE.test(title) || AD_SELF_LABEL_RE.test(aria)) return;

        logger.log('DOM:위장광고', `탐지 — selector="${selector}" areaText="${areaText.slice(0, 60)}"`);

        detections.push({
          id: generateId(),
          guideline: 7,
          guidelineName: '위장광고',
          severity: 'medium',
          // 광고 속성이 명확히 존재하지만 고지가 없으면 confirmed, iframe 등은 suspicious
          confidence: selector.startsWith('iframe') ? 'suspicious' : 'confirmed',
          module: 'dom',
          description: '광고로 표시되어야 할 요소에 광고 고지(AD·광고·스폰서 등) 표시가 없습니다.',
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, disclosureAreaText: areaText.slice(0, 100) },
          },
          element: getElementInfo(el),
        });
      });
    }

    return detections;
  }

  /**
   * 광고 요소 직근 주변(인접 형제 + 부모의 다른 직계 자식)의 얕은 텍스트를 수집한다.
   *
   * "얕은 텍스트"란 해당 요소의 직계 텍스트 노드만 읽고 자식 요소 안쪽으로는
   * 내려가지 않는 것을 의미한다. 이렇게 해야 페이지 다른 곳에 있는 "광고" 레이블이
   * 큰 컨테이너(예: 메인 콘텐츠 div)의 textContent 에 포함되어 엉뚱한 요소를
   * "정상 고지됨"으로 오판하는 문제를 방지할 수 있다.
   *
   * 요소 자신의 텍스트는 제외한다 — 내부 극소 "광고" 레이블을 정상 고지로 오판 방지.
   */
  private getAdDisclosureArea(el: HTMLElement): string {
    /** 요소의 직계 텍스트 노드만 반환 (자식 요소 미포함) */
    const shallowText = (node: Element): string => {
      let t = '';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) t += child.textContent ?? '';
      }
      return t;
    };

    const parts: string[] = [];
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    if (prev) parts.push(shallowText(prev));
    if (next) parts.push(shallowText(next));
    if (el.parentElement) {
      Array.from(el.parentElement.children).forEach((child) => {
        if (child !== el) parts.push(shallowText(child));
      });
    }
    return parts.join(' ');
  }

  // ─── 공정위 기준 12번: 숨겨진 정보 (Hidden Information) ────────────────────
  // 환불·수수료·자동갱신 등 중요 고지 문구가 매우 작은 폰트(≤10px)로 표시되는 경우 탐지
  private detectHiddenInformation(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    const walker = makeTextWalker();
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      const matchedTerm = HIDDEN_INFO_TERMS.find((term) => text.includes(term));
      if (!matchedTerm) continue;

      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;

      // 스크린 밖 요소(비표시) 스킵
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const style    = getComputedStyle(parent);
      const fontSize = parseFloat(style.fontSize);

      // 폰트 크기 기준 미달이면 탐지
      if (fontSize > HIDDEN_FONT_THRESHOLD) continue;

      seen.add(parent);

      const snippet = text.trim().slice(0, 120);
      logger.log('DOM:숨겨진정보',
        `term="${matchedTerm}" fontSize=${fontSize}px text="${snippet}"`);

      detections.push({
        id: generateId(),
        guideline: 12,
        guidelineName: '숨겨진 정보',
        severity: fontSize <= 8 ? 'high' : 'medium',
        confidence: 'suspicious',
        module: 'dom',
        description: `중요 정보("${matchedTerm}")가 ${fontSize}px의 매우 작은 글자로 표시되어 있습니다.`,
        evidence: {
          type: 'dom_element',
          raw: parent.outerHTML.slice(0, 300),
          detail: { matchedTerm, fontSize, text: snippet },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 4번: 거짓할인 (False Discount) ─────────────────────────────
  // 할인율은 표시하지만 원래 가격(취소선)이 없거나 확인 불가능한 경우 탐지
  private detectFalseDiscount(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    const processElement = (el: HTMLElement, selector: string): void => {
      if (seen.has(el)) return;
      seen.add(el);

      // 가격 컨테이너 범위: 최대 3단계 상위
      const container =
        el.closest('[class*="product"],[class*="item"],[class*="price"],[class*="goods"]')
        ?? el.parentElement?.parentElement
        ?? el.parentElement
        ?? el;

      // 원가 요소 존재 여부 확인
      const hasOriginPrice = ORIGIN_PRICE_SELECTORS.some(
        (s) => container.querySelector(s) !== null,
      );
      if (hasOriginPrice) return; // 원가 있음 → 정상 할인 표시

      const text = el.textContent?.trim() ?? '';
      const match = DISCOUNT_TEXT_RE.exec(text);
      if (!match && selector === '(text-match)') return; // 텍스트 워크: 패턴 없으면 스킵

      const claimedRate = match ? parseInt(match[1], 10) : null;
      logger.log('DOM:거짓할인',
        `원가 없는 할인율 — ${claimedRate ?? '?'}% selector="${selector}" text="${text.slice(0, 60)}"`);

      detections.push({
        id: generateId(),
        guideline: 4,
        guidelineName: '거짓할인',
        severity: claimedRate !== null && claimedRate >= 50 ? 'high' : 'medium',
        confidence: 'suspicious',
        module: 'dom',
        description: `할인율(${claimedRate ?? '?'}%)이 표시되어 있지만 원래 가격이 확인되지 않아 실제 할인 여부를 판단할 수 없습니다.`,
        evidence: {
          type: 'dom_element',
          raw: el.outerHTML.slice(0, 300),
          detail: { selector, claimedRate, hasOriginPrice },
        },
        element: getElementInfo(el),
      });
    };

    // 1) CSS 선택자 기반
    for (const selector of (domSelectors.selectors as Record<string, string[]>)['false_discount'] ?? []) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => processElement(el, selector));
    }

    // 2) 텍스트 기반 스캔 (선택자 미매칭 케이스 보완)
    const walker = makeTextWalker();
    let node: Node | null;
    let count = 0;
    while ((node = walker.nextNode()) && count < 10) {
      const text = node.textContent ?? '';
      if (!DISCOUNT_TEXT_RE.test(text)) continue;
      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;
      count++;
      processElement(parent, '(text-match)');
    }

    return detections;
  }

  // ─── 공정위 기준 11번: 취소·탈퇴 등의 방해 (Hard to Cancel) ───────────────
  // 해지·탈퇴 UI가 숨겨지거나 시각적으로 접근하기 어렵게 설계된 경우 탐지
  private detectHardToCancel(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    const walker = makeTextWalker();
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      const matchedTerm = CANCEL_SERVICE_TERMS.find((term) => text.includes(term));
      if (!matchedTerm) continue;

      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);

      // 실제 취소 UI(버튼·링크)인지 확인 (일반 설명 텍스트 제외)
      const isActionable =
        ['BUTTON', 'A', 'INPUT', 'LABEL'].includes(parent.tagName) ||
        parent.getAttribute('role') === 'button';
      if (!isActionable) continue;

      const style      = getComputedStyle(parent);
      const opacity    = parseFloat(style.opacity);
      const fontSize   = parseFloat(style.fontSize);
      const display    = style.display;
      const visibility = style.visibility;

      const signals: string[] = [];
      if (display === 'none' || visibility === 'hidden') {
        signals.push('display/visibility로 완전히 숨겨짐');
      }
      if (opacity < CANCEL_OPACITY_THRESHOLD) {
        signals.push(`불투명도 ${(opacity * 100).toFixed(0)}%`);
      }
      if (fontSize < CANCEL_FONT_THRESHOLD) {
        signals.push(`글자 크기 ${fontSize}px`);
      }
      if (signals.length === 0) continue;

      logger.log('DOM:취소방해',
        `term="${matchedTerm}" 신호: ${signals.join(' | ')}`);

      detections.push({
        id: generateId(),
        guideline: 11,
        guidelineName: '취소·탈퇴 등의 방해',
        severity: signals.length >= 2 ? 'high' : 'medium',
        confidence: display === 'none' || visibility === 'hidden' ? 'confirmed' : 'suspicious',
        module: 'dom',
        description: `취소·해지 UI("${matchedTerm}")가 의도적으로 숨겨지거나 접근하기 어렵게 설계되어 있습니다.`,
        evidence: {
          type: 'dom_element',
          raw: parent.outerHTML.slice(0, 300),
          detail: { matchedTerm, signals, opacity, fontSize, display, visibility },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 13번: 가격비교 방해 (Comparison Prevention) ───────────────
  // 상품 목록에서 "가격문의"·"가격협의" 등으로 가격을 숨겨 비교를 차단하는 경우 탐지
  private detectComparisonPrevention(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    const walker = makeTextWalker();
    let node: Node | null;
    let count = 0;

    while ((node = walker.nextNode()) && count < 10) {
      const text = (node.textContent ?? '').trim();
      const matchedTerm = COMPARISON_PREVENTION_TERMS.find((t) => text.includes(t));
      if (!matchedTerm) continue;

      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);

      // 상품 카드·목록 컨텍스트 확인 (네비게이션·CS 문구 제외)
      const productCtx = parent.closest(
        '[class*="product"],[class*="item"],[class*="goods"],[class*="card"],[class*="list"],' +
        '[class*="comparison"],[class*="price"],[class*="inquiry"],[class*="contact"]',
      );
      if (!productCtx) continue;
      count++;

      logger.log('DOM:가격비교방해',
        `term="${matchedTerm}" text="${text.slice(0, 60)}"`);

      detections.push({
        id: generateId(),
        guideline: 13,
        guidelineName: '가격비교 방해',
        severity: 'medium',
        confidence: 'suspicious',
        module: 'dom',
        description: `"${matchedTerm}" 문구로 가격 정보를 감추어 소비자의 직접 비교를 차단합니다.`,
        evidence: {
          type: 'dom_element',
          raw: parent.outerHTML.slice(0, 300),
          detail: { matchedTerm, text: text.slice(0, 100) },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 15번: 반복간섭 (Nagging) ────────────────────────────────
  // 마케팅 CTA나 FOMO 문구를 포함한 팝업·모달·다이얼로그가 활성화된 경우 탐지
  private detectNagging(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    for (const selector of (domSelectors.selectors as Record<string, string[]>)['nagging'] ?? []) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        // 화면에 실제로 보이는 요소만 처리
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const elText = el.textContent ?? '';
        const hasCTA  = NAGGING_CTA_KEYWORDS.some((kw) => elText.includes(kw));
        const hasFOMO = fomoKeywords.keywords.some((kw) => elText.includes(kw));

        if (!hasCTA && !hasFOMO) return;

        logger.log('DOM:반복간섭',
          `selector="${selector}" CTA=${hasCTA} FOMO=${hasFOMO} text="${elText.slice(0, 60)}"`);

        detections.push({
          id: generateId(),
          guideline: 15,
          guidelineName: '반복간섭',
          severity: hasCTA && hasFOMO ? 'high' : 'medium',
          confidence: hasCTA ? 'confirmed' : 'suspicious',
          module: 'dom',
          description: '마케팅 팝업/모달이 사용자의 주요 작업을 방해하며 반복 노출될 수 있습니다.',
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, hasCTA, hasFOMO },
          },
          element: getElementInfo(el),
        });
      });
    }

    return detections;
  }

  // ─── 공정위 기준 6번: 유인판매 (Bait and Switch) ────────────────────────────
  // 품절·단종 상태인 상품 페이지에서 다른 상품으로 대체 유도하는 패턴 탐지
  private detectBaitAndSwitch(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    // 1) CSS 선택자로 품절 요소를 먼저 찾기
    for (const selector of (domSelectors.selectors as Record<string, string[]>)['bait_and_switch'] ?? []) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        // 리뷰·Q&A 영역 내부면 판매자 패턴이 아니므로 제외
        if (el.closest(REVIEW_CTX_SELECTOR)) return;
        const productCtx = el.closest(PRODUCT_CTX_SELECTOR) ?? el.parentElement;
        if (!productCtx) return;

        const ctxText = productCtx.textContent ?? '';
        const altTerm = BAIT_SWITCH_ALT_TERMS.find((t) => ctxText.includes(t));
        if (!altTerm) return;

        seen.add(el);
        logger.log('DOM:유인판매',
          `selector="${selector}" alt="${altTerm}" text="${ctxText.slice(0, 60)}"`);

        detections.push({
          id: generateId(),
          guideline: 6,
          guidelineName: '유인판매',
          severity: 'high',
          confidence: 'suspicious',
          module: 'dom',
          description: `품절·판매중지 상품 페이지에서 다른 상품으로 유도("${altTerm}")하는 패턴이 감지되었습니다.`,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, altTerm, contextText: ctxText.slice(0, 100) },
          },
          element: getElementInfo(el),
        });
      });
    }

    // 2) 텍스트 노드 기반 보완 탐지
    const walker = makeTextWalker();
    let node: Node | null;
    let count = 0;

    while ((node = walker.nextNode()) && count < MAX_TEXT_DETECTIONS) {
      const text = node.textContent ?? '';
      const soldoutTerm = SOLDOUT_TERMS.find((t) => text.includes(t));
      if (!soldoutTerm) continue;

      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;

      // 리뷰·Q&A 영역 내부면 판매자 패턴이 아니므로 제외
      if (parent.closest(REVIEW_CTX_SELECTOR)) continue;
      const productCtx = parent.closest(PRODUCT_CTX_SELECTOR);
      if (!productCtx) continue;

      const ctxText = productCtx.textContent ?? '';
      const altTerm = BAIT_SWITCH_ALT_TERMS.find((t) => ctxText.includes(t));
      if (!altTerm) continue;

      seen.add(parent);
      count++;

      logger.log('DOM:유인판매',
        `soldout="${soldoutTerm}" alt="${altTerm}" text="${text.trim().slice(0, 60)}"`);

      detections.push({
        id: generateId(),
        guideline: 6,
        guidelineName: '유인판매',
        severity: 'high',
        confidence: 'suspicious',
        module: 'dom',
        description: `"${soldoutTerm}"으로 표시된 상품 페이지에서 다른 상품으로 유도("${altTerm}")하는 패턴이 감지되었습니다.`,
        evidence: {
          type: 'dom_element',
          raw: parent.outerHTML.slice(0, 300),
          detail: { soldoutTerm, altTerm, text: text.trim().slice(0, 100) },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 2번: 순차공개 가격책정 (Drip Pricing) ──────────────────────
  // 추가 비용(배송비·수수료·세금 등)이 결제 직전까지 숨겨지거나 소자로 표시되는 패턴 탐지
  private detectDripPricingDOM(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    // 1) CSS 선택자 기반 탐지
    for (const selector of (domSelectors.selectors as Record<string, string[]>)['drip_pricing'] ?? []) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        const text = (el.textContent ?? '').trim();
        const matchedTerm = DRIP_PRICE_TERMS.find((t) => text.includes(t));
        if (!matchedTerm) return;
        // 무료 배송·무료 제공 텍스트는 오탐 — 비용 없음이 명시된 경우 스킵
        if (/무료|공짜|0\s*원|free/i.test(text)) return;

        seen.add(el);
        const style = getComputedStyle(el);
        logger.log('DOM:드립프라이싱',
          `selector="${selector}" term="${matchedTerm}" display="${style.display}"`);

        detections.push({
          id: generateId(),
          guideline: 2,
          guidelineName: '순차공개 가격책정',
          severity: 'high',
          confidence: 'suspicious',
          module: 'dom',
          description: `추가 비용("${matchedTerm}")이 숨겨진 요소로 처리되어 실제 결제 금액이 초기 표시 가격보다 높을 수 있습니다.`,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, matchedTerm, display: style.display, visibility: style.visibility },
          },
          element: getElementInfo(el),
        });
      });
    }

    // 2) 텍스트 노드 기반 보완 탐지: 추가 비용 키워드가 포함된 요소 중 숨겨지거나 소자인 경우
    //
    // 사전 수집: 페이지에 이미 보이는(visible) 상태로 표시된 추가비용 키워드 목록.
    // 쿠팡 등 반응형 페이지는 "배송비 2,500원"을 화면에 표시하면서 동시에
    // display:none 복사본을 DOM에 두는 경우가 많다. 이미 공개된 정보의 숨겨진
    // 복사본을 드립 프라이싱으로 오탐하지 않기 위해 먼저 제외 목록을 만든다.
    const visibleTerms = new Set<string>();
    {
      const preWalker = makeTextWalker();
      let preNode: Node | null;
      while ((preNode = preWalker.nextNode())) {
        const preText = preNode.textContent ?? '';
        const term = DRIP_PRICE_TERMS.find((t) => preText.includes(t));
        if (!term) continue;
        const p = preNode.parentElement;
        if (!p) continue;
        const s = getComputedStyle(p);
        const isVisible =
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          parseFloat(s.opacity) !== 0 &&
          parseFloat(s.fontSize) >= DRIP_HIDDEN_FONT_THRESHOLD;
        if (isVisible) visibleTerms.add(term);
      }
    }

    const walker = makeTextWalker();
    let node: Node | null;
    let count = 0;

    while ((node = walker.nextNode()) && count < MAX_TEXT_DETECTIONS) {
      const text = node.textContent ?? '';
      const matchedTerm = DRIP_PRICE_TERMS.find((t) => text.includes(t));
      if (!matchedTerm) continue;

      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;

      const style = getComputedStyle(parent);
      const isHidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity) === 0;
      const fontSize = parseFloat(style.fontSize);
      const isSmallFont = !isNaN(fontSize) && fontSize < DRIP_HIDDEN_FONT_THRESHOLD;

      if (!isHidden && !isSmallFont) continue;

      // 같은 키워드가 페이지 어딘가에 이미 보이는 상태로 표시되어 있으면
      // 반응형 레이아웃의 숨겨진 복사본이므로 드립 프라이싱 오탐 → 스킵
      if (isHidden && visibleTerms.has(matchedTerm)) {
        logger.warn('DOM:드립프라이싱',
          `보이는 복사본 존재 — 숨겨진 요소 스킵 term="${matchedTerm}"`);
        continue;
      }

      seen.add(parent);
      count++;

      const reason = isHidden ? '숨김 처리' : `${fontSize}px 소자 표기`;
      logger.log('DOM:드립프라이싱',
        `텍스트 탐지 — term="${matchedTerm}" reason="${reason}"`);

      detections.push({
        id: generateId(),
        guideline: 2,
        guidelineName: '순차공개 가격책정',
        severity: isHidden ? 'high' : 'medium',
        confidence: isHidden ? 'confirmed' : 'suspicious',
        module: 'dom',
        description: `"${matchedTerm}" 항목이 ${reason}되어 있어 최종 결제 금액이 처음 표시된 가격보다 높을 수 있습니다.`,
        evidence: {
          type: 'dom_element',
          raw: parent.outerHTML.slice(0, 300),
          detail: { matchedTerm, isHidden, fontSize, reason },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 19번: 다른 소비자의 활동 알림 (Social Proof) ────────────────
  // "현재 N명 구경 중", "방금 구매했습니다" 등 다른 소비자의 실시간 활동을 표시하여
  // 허위 사회적 증거로 구매 압박을 유도하는 패턴 탐지
  private detectSocialProofDOM(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    // 1) CSS 선택자 기반 탐지
    for (const selector of (domSelectors.selectors as Record<string, string[]>)['social_proof'] ?? []) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        // 텍스트 패턴 검증 — 실시간 활동 문구가 없으면 리뷰 카운트 등 오탐으로 스킵
        const fullText = el.textContent ?? '';
        // 200자 초과 요소는 컨테이너 전체가 선택된 것 — 실제 소셜 프루프 문구는 항상 짧음
        if (fullText.trim().length > 200) return;
        if (!SOCIAL_PROOF_RE.test(fullText) && !SOCIAL_PROOF_NUMBER_RE.test(fullText)) return;

        seen.add(el);
        const text = fullText.trim().slice(0, 100);
        logger.log('DOM:소비자활동알림', `selector="${selector}" text="${text}"`);

        detections.push({
          id: generateId(),
          guideline: 19,
          guidelineName: '다른 소비자의 활동 알림',
          severity: 'medium',
          confidence: 'suspicious',
          module: 'dom',
          description: '다른 소비자의 실시간 활동(조회 수·구매 수)을 표시하여 구매 압박을 유도할 수 있습니다.',
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, text },
          },
          element: getElementInfo(el),
        });
      });
    }

    // 2) 텍스트 패턴 보완: 요소 전체 텍스트에서 소비자 활동 패턴 탐지
    //    textContent를 사용하므로 자식 요소에 걸쳐 분산된 텍스트도 감지
    const walker = makeTextWalker();
    let node: Node | null;
    let count = 0;

    while ((node = walker.nextNode()) && count < MAX_TEXT_DETECTIONS) {
      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;

      // 텍스트 노드 자체의 내용으로만 매칭 — parent.textContent를 쓰면
      // 자손 전체 텍스트가 합산되어 페이지 상단 skip-link 등 엉뚱한 부모가 탐지됨
      const nodeText = node.textContent ?? '';
      // 200자 초과 텍스트 노드는 여러 섹션이 합쳐진 컨테이너 — 전용 소셜 프루프 요소가 아님
      if (nodeText.trim().length > 200) continue;
      const matchSP  = SOCIAL_PROOF_RE.exec(nodeText);
      const matchSPN = matchSP ? null : SOCIAL_PROOF_NUMBER_RE.exec(nodeText);
      const matchObj = matchSP ?? matchSPN;
      if (!matchObj) continue;

      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      // 이미 탐지한 요소의 조상/자손이면 스킵
      let alreadyCovered = false;
      for (const s of seen) {
        if ((s as HTMLElement).contains(parent) || parent.contains(s as HTMLElement)) {
          alreadyCovered = true;
          break;
        }
      }
      if (alreadyCovered) continue;

      seen.add(parent);
      count++;

      // snippet은 실제 매칭된 위치 기준으로 추출 (앞 skip-link 등이 잘리지 않도록)
      const matchStart = Math.max(0, matchObj.index - 10);
      const snippet = nodeText.slice(matchStart, matchStart + 60).trim();
      logger.log('DOM:소비자활동알림', `텍스트 탐지 — "${snippet}"`);

      detections.push({
        id: generateId(),
        guideline: 19,
        guidelineName: '다른 소비자의 활동 알림',
        severity: 'medium',
        confidence: 'suspicious',
        module: 'dom',
        description: `"${snippet}" — 다른 소비자의 실시간 활동을 표시하여 구매 압박을 유발할 수 있습니다.`,
        evidence: {
          type: 'dom_element',
          raw: parent.outerHTML.slice(0, 300),
          detail: { text: nodeText.trim().slice(0, 100) },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 14번: 클릭 피로감 유발 (Click Fatigue) ──────────────────────
  // 과도한 진행 단계 또는 동의 팝업 내 과다한 체크박스로 불필요한 클릭을 유발하는 패턴 탐지
  private detectClickFatigue(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    // 신호 1: 과도한 단계 수 (체크아웃/회원가입 플로우)
    for (const selector of (domSelectors.selectors as Record<string, string[]>)['click_fatigue_steps'] ?? []) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        // 직계 자식 li 또는 step 클래스 요소를 단계로 카운트
        const stepChildren = el.querySelectorAll(':scope > li, :scope > [class*="step"]');
        const stepCount = stepChildren.length;
        if (stepCount < CLICK_FATIGUE_STEP_THRESHOLD) return;

        seen.add(el);
        logger.log('DOM:클릭피로감',
          `단계 초과 — selector="${selector}" count=${stepCount}`);

        detections.push({
          id: generateId(),
          guideline: 14,
          guidelineName: '클릭 피로감 유발',
          severity: stepCount >= 7 ? 'high' : 'medium',
          confidence: 'suspicious',
          module: 'dom',
          description: `${stepCount}단계의 과도한 진행 단계가 감지되었습니다. 불필요한 클릭을 유발할 수 있습니다.`,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, stepCount },
          },
          element: getElementInfo(el),
        });
      });
    }

    // 신호 2: 동의 팝업 내 과다한 체크박스
    const visibleDialogs = Array.from(
      document.querySelectorAll<HTMLElement>(
        'dialog[open], [role="dialog"], [class*="modal"], [class*="popup"], [class*="layer-pop"]',
      ),
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    for (const dialog of visibleDialogs) {
      if (seen.has(dialog)) continue;

      const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length < CLICK_FATIGUE_CHECKBOX_THRESHOLD) continue;

      const dialogText = dialog.textContent ?? '';
      const isConsentContext = CONSENT_KEYWORDS.some((kw) => dialogText.includes(kw));
      if (!isConsentContext) continue;

      seen.add(dialog);
      logger.log('DOM:클릭피로감',
        `동의 체크박스 과다 — count=${checkboxes.length}`);

      detections.push({
        id: generateId(),
        guideline: 14,
        guidelineName: '클릭 피로감 유발',
        severity: 'medium',
        confidence: 'suspicious',
        module: 'dom',
        description: `동의·약관 팝업에 ${checkboxes.length}개의 체크박스가 있어 과도한 클릭을 유발합니다.`,
        evidence: {
          type: 'dom_element',
          raw: dialog.outerHTML.slice(0, 300),
          detail: { checkboxCount: checkboxes.length },
        },
        element: getElementInfo(dialog),
      });
    }

    return detections;
  }

  /**
   * 같은 가이드라인 번호로 탐지된 요소들 중 DOM 중첩 관계에 있는 경우
   * 가장 바깥쪽 조상 요소 하나만 남기고 자손 요소의 탐지 결과를 제거한다.
   *
   * 추가로 같은 가이드라인의 두 요소가 동일 UI 컴포넌트 안의 형제 수준(LCA가
   * 양쪽으로부터 maxDepth=3 이내)이면 렌더 면적이 큰 쪽 하나만 유지한다.
   * 예) G17: .countdown-wrap 과 .flash-timer 가 같은 .urgency-banner 내 형제인 경우
   *    → 더 큰 .countdown-wrap 하나만 유지
   */
  private deduplicateOverlapping(detections: DarkPatternDetection[]): DarkPatternDetection[] {
    // element 정보가 없는 탐지(NLP·네트워크 전용)는 필터링 대상에서 제외
    const resolved: Array<{ d: DarkPatternDetection; node: HTMLElement }> = [];
    const unresolvable: DarkPatternDetection[] = [];

    for (const d of detections) {
      if (!d.element?.xpath) {
        unresolvable.push(d);
        continue;
      }
      const node = this.resolveXPath(d.element.xpath);
      if (node) {
        resolved.push({ d, node });
      } else {
        unresolvable.push(d);
      }
    }

    const kept: typeof resolved = [];

    for (let i = 0; i < resolved.length; i++) {
      const { d: di, node: ni } = resolved[i];
      let isInner = false;

      const ri = ni.getBoundingClientRect();
      const areaI = ri.width * ri.height;

      for (let j = 0; j < resolved.length; j++) {
        if (i === j) continue;
        const { d: dj, node: nj } = resolved[j];
        if (di.guideline !== dj.guideline || nj === ni) continue;

        // Case 1: ni가 nj의 자손이면 제거
        if (nj.contains(ni)) { isInner = true; break; }

        // Case 2: 같은 UI 컴포넌트 안의 형제 수준 — 면적이 작은 쪽 제거
        if (this.isCloseRelative(ni, nj, 3)) {
          const rj = nj.getBoundingClientRect();
          const areaJ = rj.width * rj.height;
          // nj가 더 크거나, 면적이 같을 때 문서 순서가 앞이면 ni 제거
          if (areaJ > areaI || (areaJ === areaI && j < i)) {
            isInner = true;
            break;
          }
        }
      }

      if (!isInner) kept.push(resolved[i]);
    }

    const result = [...unresolvable, ...kept.map(({ d }) => d)];
    const removed = detections.length - result.length;
    if (removed > 0) {
      logger.log('DOM', `중첩 중복 제거: ${removed}건 필터링 (${detections.length} → ${result.length})`);
    }

    return result;
  }

  /**
   * a와 b의 최근 공통 조상(LCA)이 양쪽 모두로부터 maxDepth 단계 이내인지 확인.
   * true면 같은 UI 컴포넌트 안의 형제 수준 요소로 판단한다.
   */
  private isCloseRelative(a: HTMLElement, b: HTMLElement, maxDepth: number): boolean {
    let ancestor: HTMLElement | null = a.parentElement;
    for (let depthA = 0; depthA < maxDepth && ancestor; depthA++, ancestor = ancestor.parentElement) {
      if (!ancestor.contains(b)) continue;
      // ancestor가 b를 포함함 — b에서 ancestor까지의 깊이 계산
      let depthB = 0;
      let cur: HTMLElement | null = b.parentElement;
      while (cur && cur !== ancestor) { depthB++; cur = cur.parentElement; }
      if (depthB <= maxDepth) return true;
    }
    return false;
  }

  /** XPath 문자열로 DOM 요소를 조회한다. */
  private resolveXPath(xpath: string): HTMLElement | null {
    try {
      const result = document.evaluate(
        xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null,
      );
      return result.singleNodeValue as HTMLElement | null;
    } catch {
      return null;
    }
  }

  /**
   * target 버튼 근처에 있는 후보 버튼을 반환.
   * 1) 공통 조상 컨테이너(최대 5단계) 내 동일 그룹 탐색
   * 2) 없으면 뷰포트 거리 300px 이내 최근접 버튼
   */
  private findNearbyButton(target: HTMLElement, candidates: HTMLElement[]): HTMLElement | null {
    // 1) 공통 조상 탐색
    let ancestor: HTMLElement | null = target.parentElement;
    for (let depth = 0; depth < 5 && ancestor; depth++) {
      for (const candidate of candidates) {
        if (ancestor.contains(candidate)) return candidate;
      }
      ancestor = ancestor.parentElement;
    }

    // 2) 뷰포트 좌표 기반 최근접 탐색
    const targetRect = target.getBoundingClientRect();
    let closest: HTMLElement | null = null;
    let minDist = Infinity;

    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const dx = targetRect.left - rect.left;
      const dy = targetRect.top - rect.top;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist && dist <= 300) {
        minDist = dist;
        closest = candidate;
      }
    }

    return closest;
  }

  // input과 연결된 label 텍스트 추출
  private findLabel(input: HTMLInputElement): string | null {
    if (input.id) {
      const el = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (el?.textContent) return el.textContent;
    }
    return input.closest('label')?.textContent ?? null;
  }

  // ─── 인프라 ──────────────────────────────────────────────────────────────────

  /**
   * HTMLInputElement.prototype.checked setter를 프록시하여
   * JS 코드가 input.checked = true 로 동적 선택하는 순간을 탐지한다.
   *
   * 조건: value=true && 이전값=false && defaultChecked=false
   *   → HTML attribute 없이 스크립트가 처음 선택 → 재스캔 트리거
   *
   * 주의: 사용자 클릭도 이 setter를 거치므로 debounce(300ms)로 flood 방지.
   */
  private watchInputPropertyChanges(): void {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    if (!desc?.set || !desc.get) return;

    const originalSet = desc.set;
    const originalGet = desc.get;
    const triggerRescan = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.scan(), 300);
    };

    Object.defineProperty(HTMLInputElement.prototype, 'checked', {
      set(this: HTMLInputElement, value: boolean) {
        const was = (originalGet as () => boolean).call(this);
        originalSet.call(this, value);
        // HTML attribute 없이 JS가 처음으로 checked=true 를 세팅하는 경우만 재스캔
        if (value && !was && !this.defaultChecked) {
          triggerRescan();
        }
      },
      get: desc.get,
      configurable: true,
    });
  }

  private watchDynamicChanges(): void {
    this.observer = new MutationObserver((mutations) => {
      // 연속 DOM 변경을 debounce하여 과도한 재스캔 방지
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      const reason = mutations.some((m) => m.type === 'attributes')
        ? 'attribute 변경'
        : '자식 노드 추가/삭제';
      logger.log('MutationObserver', `재스캔 예약 (${reason})`);

      this.debounceTimer = setTimeout(() => this.scan(), 500);
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      // checked 속성 변경(상품 옵션 선택 시)을 감지하기 위해 attribute 감시 추가
      attributes: true,
      attributeFilter: ['checked'],
    });
  }

  private watchSPANavigation(): void {
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      originalPushState(...args);
      this.scan();
    };
    window.addEventListener('popstate', () => this.scan());
  }

  private sendToBackground(detections: DarkPatternDetection[]): void {
    chrome.runtime.sendMessage({ type: 'DOM_DETECTIONS', payload: detections });
  }
}
