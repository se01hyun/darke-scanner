import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../src/background/rule-engine';
import type { DarkPatternDetection } from '../../src/types';

function makeDet(severity: DarkPatternDetection['severity']): DarkPatternDetection {
  return {
    id: 'test-id',
    guideline: 17,
    guidelineName: '시간제한 알림',
    severity,
    confidence: 'confirmed',
    module: 'dom',
    description: 'test detection',
    evidence: { type: 'dom_element', raw: '', detail: {} },
  };
}

describe('RuleEngine.evaluate()', () => {
  const engine = new RuleEngine();

  it('탐지 없으면 점수 0, detections 빈 배열', async () => {
    const result = await engine.evaluate([], 'https://example.com');
    expect(result.overallRiskScore).toBe(0);
    expect(result.detections).toHaveLength(0);
  });

  it('low 1건 → 점수 10', async () => {
    const result = await engine.evaluate([makeDet('low')], 'https://example.com');
    expect(result.overallRiskScore).toBe(10);
  });

  it('medium 1건 → 점수 25', async () => {
    const result = await engine.evaluate([makeDet('medium')], 'https://example.com');
    expect(result.overallRiskScore).toBe(25);
  });

  it('high 1건 → 점수 50', async () => {
    const result = await engine.evaluate([makeDet('high')], 'https://example.com');
    expect(result.overallRiskScore).toBe(50);
  });

  it('혼합 심각도: low + medium + high = 85', async () => {
    const dets = [makeDet('low'), makeDet('medium'), makeDet('high')];
    const result = await engine.evaluate(dets, 'https://example.com');
    expect(result.overallRiskScore).toBe(85);
  });

  it('점수는 100을 초과하지 않음 (cap)', async () => {
    const many = Array.from({ length: 10 }, () => makeDet('high'));
    const result = await engine.evaluate(many, 'https://example.com');
    expect(result.overallRiskScore).toBe(100);
  });

  it('pageUrl과 detections가 결과에 그대로 포함됨', async () => {
    const url = 'https://shop.example.com/product/123';
    const dets = [makeDet('medium')];
    const result = await engine.evaluate(dets, url);
    expect(result.pageUrl).toBe(url);
    expect(result.detections).toStrictEqual(dets);
  });

  it('scanTimestamp는 호출 시각과 일치 (±50ms)', async () => {
    const before = Date.now();
    const result = await engine.evaluate([], 'https://example.com');
    const after = Date.now();
    expect(result.scanTimestamp).toBeGreaterThanOrEqual(before);
    expect(result.scanTimestamp).toBeLessThanOrEqual(after);
  });

  it('medium × 4 = 100 (cap)', async () => {
    const dets = Array.from({ length: 4 }, () => makeDet('medium')); // 25 × 4 = 100
    const result = await engine.evaluate(dets, 'https://example.com');
    expect(result.overallRiskScore).toBe(100);
  });

  it('medium × 3 = 75 (cap 미도달)', async () => {
    const dets = Array.from({ length: 3 }, () => makeDet('medium')); // 25 × 3 = 75
    const result = await engine.evaluate(dets, 'https://example.com');
    expect(result.overallRiskScore).toBe(75);
  });
});
