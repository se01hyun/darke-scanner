/**
 * Script Analyzer — content script
 * 페이지 내 인라인·외부 JS 소스에서 다크 패턴 조작 로직을 탐지한다.
 *
 * 탐지 패턴 (PRD NET-05, NET-06):
 *   - random_counter : Math.random() 또는 Math.floor(Math.random()) 이 setInterval/setTimeout과 함께 카운터를 조작
 *   - timer_reset    : 카운트다운 타이머가 0 이하가 되면 초기값으로 리셋
 */

import type { ScriptPatternPayload } from '../types';

// 탐지 패턴 정의
const PATTERNS: Array<{ type: ScriptPatternPayload['patternType']; re: RegExp }> = [
  {
    type: 'random_counter',
    // Math.random()이 setInterval 또는 setTimeout 블록 내에서 변수에 더하거나 빼는 패턴
    re: /set(?:Interval|Timeout)\s*\([^)]*Math\.random\(\)[^)]*\)/,
  },
  {
    type: 'random_counter',
    // 별도 줄에 분리된 패턴: random 결과를 += / -= 로 카운터에 누적
    re: /[a-zA-Z_$][\w$]*\s*[+-]=\s*Math\.(?:floor|ceil|round)\s*\(\s*Math\.random\(\)/,
  },
  {
    type: 'timer_reset',
    // timer <= 0 또는 timer === 0 조건 후 초기값 대입 패턴
    re: /if\s*\(\s*[a-zA-Z_$][\w$]*\s*(?:<=|===|==)\s*0\s*\)[^{]*[a-zA-Z_$][\w$]*\s*=\s*[a-zA-Z_$][\w$]+/,
  },
];

function extractSnippet(source: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 60);
  const end = Math.min(source.length, match.index + match[0].length + 60);
  return source.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 300);
}

function analyzeSource(source: string, src: string): ScriptPatternPayload[] {
  const results: ScriptPatternPayload[] = [];
  for (const { type, re } of PATTERNS) {
    const match = re.exec(source);
    if (match) {
      results.push({ src, snippet: extractSnippet(source, match), patternType: type });
    }
  }
  return results;
}

export class ScriptAnalyzer {
  analyze(): void {
    const findings: ScriptPatternPayload[] = [];

    // 인라인 스크립트 스캔
    document.querySelectorAll<HTMLScriptElement>('script:not([src])').forEach((el) => {
      const source = el.textContent ?? '';
      if (source.length < 10) return;
      findings.push(...analyzeSource(source, 'inline'));
    });

    // 외부 스크립트는 same-origin만 fetch 가능 (cross-origin은 CORS로 차단됨)
    const externalPromises = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[src]')
    )
      .map((el) => el.src)
      .filter((src) => src.startsWith(window.location.origin))
      .map((src) =>
        fetch(src)
          .then((r) => r.text())
          .then((source) => analyzeSource(source, src))
          .catch(() => [] as ScriptPatternPayload[])
      );

    Promise.all(externalPromises).then((results) => {
      const allFindings = [...findings, ...results.flat()];
      allFindings.forEach((payload) => {
        chrome.runtime.sendMessage({ type: 'SCRIPT_PATTERN', payload });
      });
    });

    // 인라인 결과는 즉시 전송
    findings.forEach((payload) => {
      chrome.runtime.sendMessage({ type: 'SCRIPT_PATTERN', payload });
    });
  }
}
