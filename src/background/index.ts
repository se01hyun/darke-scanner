import { NetworkSniffer } from './network-sniffer';
import { RuleEngine } from './rule-engine';
import type { MessageType } from '../types';

const ruleEngine = new RuleEngine();
const sniffer = new NetworkSniffer(ruleEngine);

sniffer.init();

chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    if (message.type === 'DOM_DETECTIONS') {
      ruleEngine.evaluate(message.payload).then(sendResponse);
      return true; // 비동기 응답
    }
  }
);
