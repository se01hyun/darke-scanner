// DOM에서 NLP 분석용 텍스트 수집
import type { NLPTextsPayload } from '../types';

const MAX_PAGE_TEXTS = 50;
const MAX_REVIEW_TEXTS = 100;
const MAX_CTA_TEXTS = 30;

export class TextCollector {
  collect(): NLPTextsPayload {
    return {
      pageTexts: this.collectPageTexts(),
      reviewTexts: this.collectReviewTexts(),
      ctaTexts: this.collectCtaTexts(),
    };
  }

  private collectPageTexts(): string[] {
    const selectors = [
      'h1', 'h2', 'h3',
      '[class*="product-name"]', '[class*="item-name"]',
      '[class*="description"]', '[class*="promo"]',
      '[class*="popup"]', '[class*="modal"]',
      '[class*="sale"]', '[class*="offer"]',
    ];
    const texts = new Set<string>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent?.trim();
        if (t && t.length > 5) texts.add(t);
        if (texts.size >= MAX_PAGE_TEXTS) return [...texts];
      }
    }
    return [...texts];
  }

  private collectReviewTexts(): string[] {
    const selectors = [
      '[class*="review"]', '[class*="comment"]',
      '[class*="후기"]', '[class*="opinion"]',
      '[class*="평가"]', '[itemprop="reviewBody"]',
    ];
    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent?.trim();
        if (t && t.length > 10 && !seen.has(t)) {
          seen.add(t);
          candidates.push(t);
        }
        if (candidates.length >= MAX_REVIEW_TEXTS) break;
      }
    }

    // 다른 후보 텍스트를 포함하는 컨테이너 요소를 제거한다.
    // .review-section, .review-list, .review-card 같은 상위 컨테이너가
    // .review-body의 텍스트를 그대로 포함하므로 개별 리뷰 텍스트만 남긴다.
    return candidates.filter(
      (t) => !candidates.some((other) => other !== t && t.includes(other)),
    );
  }

  private collectCtaTexts(): string[] {
    const selectors = [
      'button', 'input[type="submit"]', 'input[type="button"]',
      'a[class*="btn"]', 'a[class*="button"]',
      '[class*="cta"]', '[role="button"]',
    ];
    const texts: string[] = [];
    const seen = new Set<string>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t =
          el.textContent?.trim() ||
          (el as HTMLInputElement).value?.trim();
        if (t && t.length > 2 && !seen.has(t)) {
          seen.add(t);
          texts.push(t);
        }
        if (texts.length >= MAX_CTA_TEXTS) return texts;
      }
    }
    return texts;
  }
}
