import type { ElementInfo } from '../types';

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
