import type { ElementInfo } from '../types';

// ─── WCAG 대비율 계산 ─────────────────────────────────────────────────────────

/** "rgb(r, g, b)" 또는 "rgba(r, g, b, a)" 문자열을 [r, g, b, a] 로 파싱 */
function parseRGBA(color: string): [number, number, number, number] | null {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  return [
    parseInt(m[1], 10),
    parseInt(m[2], 10),
    parseInt(m[3], 10),
    m[4] !== undefined ? parseFloat(m[4]) : 1,
  ];
}

/** sRGB 채널 값(0-255) → 선형 광도 변환 (IEC 61966-2-1) */
function linearize(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** 상대 광도 (WCAG 2.1) */
function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * 요소의 실질적 배경색 반환.
 * 투명(rgba alpha=0) 이면 부모 노드를 순회하여 첫 불투명 배경을 사용.
 * 끝까지 투명이면 흰색(255,255,255)으로 fallback.
 */
export function getEffectiveBgColor(el: HTMLElement): [number, number, number] {
  let current: HTMLElement | null = el;
  while (current) {
    const rgba = parseRGBA(getComputedStyle(current).backgroundColor);
    if (rgba && rgba[3] > 0) return [rgba[0], rgba[1], rgba[2]];
    current = current.parentElement;
  }
  return [255, 255, 255];
}

/**
 * 요소의 텍스트 색과 배경색 사이의 WCAG 대비율을 반환.
 * 파싱 실패 시 1 (최저값) 반환.
 */
export function getContrastRatio(el: HTMLElement): number {
  const textRGBA = parseRGBA(getComputedStyle(el).color);
  if (!textRGBA) return 1;

  const [bgR, bgG, bgB] = getEffectiveBgColor(el);
  const L_text = relativeLuminance(textRGBA[0], textRGBA[1], textRGBA[2]);
  const L_bg   = relativeLuminance(bgR, bgG, bgB);

  const lighter = Math.max(L_text, L_bg);
  const darker  = Math.min(L_text, L_bg);
  return (lighter + 0.05) / (darker + 0.05);
}

// ─── ElementInfo ──────────────────────────────────────────────────────────────

export function getElementInfo(el: HTMLElement): ElementInfo {
  const rect = el.getBoundingClientRect();
  return {
    xpath: getXPath(el),
    boundingRect: {
      top: Math.round(rect.top + window.scrollY),
      left: Math.round(rect.left + window.scrollX),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    outerHTML: el.outerHTML.slice(0, 500),
  };
}

export function getXPath(el: HTMLElement): string {
  if (el.id) return `//*[@id="${el.id}"]`;

  const parts: string[] = [];
  let current: HTMLElement | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    const tag = current.tagName.toLowerCase();
    parts.unshift(index > 1 ? `${tag}[${index}]` : tag);
    current = current.parentElement;
  }

  return '/' + parts.join('/');
}
