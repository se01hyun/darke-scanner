import { DOMScanner } from './dom-scanner';

const scanner = new DOMScanner();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => scanner.init());
} else {
  scanner.init();
}
