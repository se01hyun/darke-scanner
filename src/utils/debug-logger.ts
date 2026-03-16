// Phase 5 QA — 실사이트 검증용 디버그 로거
//
// DEBUG_MODE는 빌드 시점에 esbuild `define`으로 주입되는 __DS_DEBUG__ 값을 따릅니다.
//   개발:        npm run build       → __DS_DEBUG__ = true  (로그 활성)
//   프로덕션:   npm run build:prod  → __DS_DEBUG__ = false (로그 비활성 + dead-code 제거)

export const DEBUG_MODE: boolean = __DS_DEBUG__;

const P = '[DarkScanner]';

interface DetectionSummary {
  guideline: number;
  name: string;
  severity: string;
  confidence: string;
  module: string;
  evidence: string;
}

export const logger = {
  group(label: string): void {
    if (!DEBUG_MODE) return;
    console.group(`${P} ${label}`);
  },
  groupEnd(): void {
    if (!DEBUG_MODE) return;
    console.groupEnd();
  },
  log(tag: string, ...args: unknown[]): void {
    if (!DEBUG_MODE) return;
    console.log(`${P}[${tag}]`, ...args);
  },
  warn(tag: string, ...args: unknown[]): void {
    if (!DEBUG_MODE) return;
    console.warn(`${P}[${tag}]`, ...args);
  },
  /** 탐지 결과 배열을 콘솔 테이블로 출력 */
  detections(tag: string, detections: Array<{ guideline: number; guidelineName: string; severity: string; confidence: string; module: string; evidence: { type: string; detail?: unknown } }>): void {
    if (!DEBUG_MODE || detections.length === 0) return;
    const rows: DetectionSummary[] = detections.map((d) => ({
      guideline: d.guideline,
      name: d.guidelineName,
      severity: d.severity,
      confidence: d.confidence,
      module: d.module,
      evidence: d.evidence.type + (d.evidence.detail ? ' ' + JSON.stringify(d.evidence.detail).slice(0, 80) : ''),
    }));
    console.log(`${P}[${tag}] — ${detections.length}건 탐지:`);
    console.table(rows);
  },
};
