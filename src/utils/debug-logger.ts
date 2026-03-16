// Phase 5 QA — 실사이트 검증용 디버그 로거
// 실사이트 확인 완료 후 배포 전 DEBUG_MODE = false 로 변경할 것

export const DEBUG_MODE = true;

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
