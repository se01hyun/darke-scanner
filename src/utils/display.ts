// 화면 표시용 공통 매핑 상수
import type { Severity, Confidence } from '../types';

export const SEVERITY_KO: Record<Severity, string> = {
  high:   '높음',
  medium: '보통',
  low:    '낮음',
};

export const CONFIDENCE_KO: Record<Confidence, string> = {
  confirmed:  '확정',
  suspicious: '의심',
};

export const MODULE_KO: Record<string, string> = {
  dom:     'DOM',
  nlp:     'NLP',
  network: '네트워크',
};
