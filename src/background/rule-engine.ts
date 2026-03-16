import type { DarkPatternDetection, DetectionResult } from '../types';

export class RuleEngine {
  async evaluate(detections: DarkPatternDetection[]): Promise<DetectionResult> {
    const overallRiskScore = this.calcRiskScore(detections);
    return {
      pageUrl: '',
      scanTimestamp: Date.now(),
      overallRiskScore,
      detections,
    };
  }

  private calcRiskScore(detections: DarkPatternDetection[]): number {
    if (detections.length === 0) return 0;
    const weights = { low: 10, medium: 25, high: 50 };
    const raw = detections.reduce((sum, d) => sum + weights[d.severity], 0);
    return Math.min(100, raw);
  }
}
