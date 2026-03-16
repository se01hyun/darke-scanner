// Module 3: Network Sniffer
// 1안(기본): chrome.webRequest 응답 로그 비동기 수집
// 2안(고급): chrome.debugger — 사용자 명시 활성화 시에만 사용

import type { RuleEngine } from './rule-engine';

export class NetworkSniffer {
  constructor(private readonly ruleEngine: RuleEngine) {}

  init(): void {
    // TODO: Phase 2에서 구현
  }
}
