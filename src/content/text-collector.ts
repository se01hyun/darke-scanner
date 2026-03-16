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
    const texts: string[] = [];
    const seen = new Set<string>();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.textContent?.trim();
        if (t && t.length > 10 && !seen.has(t)) {
          seen.add(t);
          texts.push(t);
        }
        if (texts.length >= MAX_REVIEW_TEXTS) return texts;
      }
    }
    return texts;
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
