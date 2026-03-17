// DOM에서 NLP 분석용 텍스트 수집
import type { NLPTextsPayload, NLPTextItem } from '../types';
import { getXPath } from '../utils/element';

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

  private collectPageTexts(): NLPTextItem[] {
    const selectors = [
      'h1', 'h2', 'h3',
      '[class*="product-name"]', '[class*="item-name"]',
      '[class*="description"]', '[class*="promo"]',
      '[class*="popup"]', '[class*="modal"]',
      '[class*="sale"]', '[class*="offer"]',
    ];
    const seen = new Map<string, NLPTextItem>(); // text → item (dedup by text)
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent?.trim();
        if (t && t.length > 5 && !seen.has(t)) {
          seen.set(t, { text: t, xpath: getXPath(el as HTMLElement) });
        }
        if (seen.size >= MAX_PAGE_TEXTS) return [...seen.values()];
      }
    }
    return [...seen.values()];
  }

  private collectReviewTexts(): NLPTextItem[] {
    const selectors = [
      '[class*="review"]', '[class*="comment"]',
      '[class*="후기"]', '[class*="opinion"]',
      '[class*="평가"]', '[itemprop="reviewBody"]',
    ];
    const candidates: NLPTextItem[] = [];
    const seen = new Set<string>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent?.trim();
        if (t && t.length > 10 && !seen.has(t)) {
          seen.add(t);
          candidates.push({ text: t, xpath: getXPath(el as HTMLElement) });
        }
        if (candidates.length >= MAX_REVIEW_TEXTS) break;
      }
    }

    // 다른 후보 텍스트를 포함하는 컨테이너 요소를 제거한다.
    // .review-section, .review-list, .review-card 같은 상위 컨테이너가
    // .review-body의 텍스트를 그대로 포함하므로 개별 리뷰 텍스트만 남긴다.
    return candidates.filter(
      (item) => !candidates.some((other) => other.text !== item.text && item.text.includes(other.text)),
    );
  }

  private collectCtaTexts(): NLPTextItem[] {
    const selectors = [
      'button', 'input[type="submit"]', 'input[type="button"]',
      'a[class*="btn"]', 'a[class*="button"]',
      '[class*="cta"]', '[role="button"]',
    ];
    const items: NLPTextItem[] = [];
    const seen = new Set<string>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t =
          el.textContent?.trim() ||
          (el as HTMLInputElement).value?.trim();
        if (t && t.length > 2 && !seen.has(t)) {
          seen.add(t);
          items.push({ text: t, xpath: getXPath(el as HTMLElement) });
        }
        if (items.length >= MAX_CTA_TEXTS) return items;
      }
    }
    return items;
  }
}
