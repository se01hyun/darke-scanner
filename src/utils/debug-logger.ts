// src/utils/debug-logger.ts

export const DEBUG_MODE: boolean = __DS_DEBUG__;

const P = '[DarkScanner]';

// 객체 리터럴 대신, 각 함수를 직접 할당하는 가장 안전한 방식을 사용합니다.
export const logger = {
  group: function(label: string) {
    if (DEBUG_MODE && typeof console !== 'undefined' && console.group) {
      console.group(`${P} ${label}`);
    }
  },
  groupEnd: function() {
    if (DEBUG_MODE && typeof console !== 'undefined' && console.groupEnd) {
      console.groupEnd();
    }
  },
  log: function(tag: string, ...args: unknown[]) {
    if (DEBUG_MODE && typeof console !== 'undefined') {
      console.log(`${P}[${tag}]`, ...args);
    }
  },
  warn: function(tag: string, ...args: unknown[]) {
    if (DEBUG_MODE && typeof console !== 'undefined') {
      console.warn(`${P}[${tag}]`, ...args);
    }
  },
  detections: function(tag: string, detections: unknown[]) {
    if (DEBUG_MODE && typeof console !== 'undefined' && detections.length > 0) {
      console.log(`${P}[${tag}] 탐지 결과:`, detections);
    }
  }
};