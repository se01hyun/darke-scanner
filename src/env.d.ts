/**
 * esbuild `define` 옵션으로 빌드 시점에 주입되는 전역 상수 타입 선언.
 *
 * - 개발 빌드 (`npm run build`):       __DS_DEBUG__ = true
 * - 프로덕션 빌드 (`npm run build:prod`): __DS_DEBUG__ = false
 *
 * esbuild가 해당 식별자를 리터럴로 인라인하므로
 * `if (!__DS_DEBUG__) return;` 분기는 프로덕션 번들에서 dead-code로 제거된다.
 */
declare const __DS_DEBUG__: boolean;
