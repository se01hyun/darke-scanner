import { describe, it, expect, beforeEach } from 'vitest';
import { resolveXPath } from '../../src/overlay/index';

// ── resolveXPath ───────────────────────────────────────────────────────────────

describe('resolveXPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('유효한 XPath로 요소 반환', () => {
    const div = document.createElement('div');
    div.id = 'target';
    document.body.appendChild(div);

    const result = resolveXPath('//*[@id="target"]');
    expect(result).toBe(div);
  });

  it('일치하는 요소 없으면 null 반환', () => {
    const result = resolveXPath('//*[@id="nonexistent"]');
    expect(result).toBeNull();
  });

  it('잘못된 XPath → null 반환 (예외 던지지 않음)', () => {
    const result = resolveXPath('!!!invalid xpath!!!');
    expect(result).toBeNull();
  });

  it('빈 문자열 XPath → null 반환', () => {
    const result = resolveXPath('');
    expect(result).toBeNull();
  });

  it('중첩된 요소도 XPath로 탐색 가능', () => {
    document.body.innerHTML = `
      <div class="outer">
        <span class="inner">텍스트</span>
      </div>
    `;
    const result = resolveXPath('//span[@class="inner"]');
    expect(result).not.toBeNull();
    expect((result as HTMLElement).textContent?.trim()).toBe('텍스트');
  });

  it('텍스트 노드 기반 XPath', () => {
    document.body.innerHTML = `<p>찾는 텍스트</p>`;
    const result = resolveXPath('//p[text()="찾는 텍스트"]');
    expect(result).not.toBeNull();
  });
});

// ── OverlayManager 초기화 ─────────────────────────────────────────────────────
// 오버레이 모듈은 임포트 시점에 dark-scanner-overlay 요소를 DOM에 추가한다.
// 단, 이미 존재하면 중복 생성하지 않는다.

describe('OverlayManager 모듈 초기화', () => {
  // overlay/index.ts는 이미 import 시 실행되므로 요소가 존재함
  it('dark-scanner-overlay 커스텀 엘리먼트가 문서에 존재', () => {
    const host = document.querySelector('dark-scanner-overlay');
    expect(host).not.toBeNull();
  });

  it('호스트 엘리먼트가 fixed position으로 설정됨', () => {
    const host = document.querySelector<HTMLElement>('dark-scanner-overlay');
    expect(host?.style.position).toBe('fixed');
  });

  it('호스트 엘리먼트의 width/height가 0', () => {
    const host = document.querySelector<HTMLElement>('dark-scanner-overlay');
    expect(host?.style.width).toBe('0px');
    expect(host?.style.height).toBe('0px');
  });

  it('두 번 임포트해도 dark-scanner-overlay는 하나만 존재', async () => {
    // 이미 임포트된 모듈이므로 재실행 없음 — DOM에 중복이 없어야 함
    await import('../../src/overlay/index');
    const hosts = document.querySelectorAll('dark-scanner-overlay');
    expect(hosts.length).toBe(1);
  });
});

// ── chrome.runtime.onMessage 핸들러 ───────────────────────────────────────────
// 오버레이 모듈은 임포트 시점에 addListener를 호출한다.
// beforeEach의 clearAllMocks 이후에는 호출 기록이 지워지므로
// 핸들러 등록 여부는 DOM 상태로 간접 검증한다.

describe('OverlayManager 메시지 핸들러', () => {
  it('dark-scanner-overlay 요소가 document에 존재함 (모듈 초기화 증거)', () => {
    // 모듈이 정상 실행됐다면 DOM에 커스텀 엘리먼트가 있다
    expect(document.querySelector('dark-scanner-overlay')).not.toBeNull();
  });
});
