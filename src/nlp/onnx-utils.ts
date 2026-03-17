// ONNX 추론 공용 유틸 — onnx-session.ts 와 offscreen-nlp.ts 에서 공유

import * as ort from 'onnxruntime-web';
import { MAX_SEQ_LEN } from './tokenizer';

/** KoELECTRA-small hidden size. base 모델이면 768로 변경. */
export const HIDDEN_SIZE = 256;

/**
 * KoELECTRA 입력 텐서 피드 맵 생성.
 * onnx-session.ts(Service Worker)와 offscreen-nlp.ts(Offscreen Document) 양쪽에서 공유.
 */
export function buildFeeds(
  inputIds:      BigInt64Array,
  attentionMask: BigInt64Array,
  tokenTypeIds:  BigInt64Array,
): Record<string, ort.Tensor> {
  return {
    input_ids:      new ort.Tensor('int64', inputIds,      [1, MAX_SEQ_LEN]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, MAX_SEQ_LEN]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds,  [1, MAX_SEQ_LEN]),
  };
}

/**
 * last_hidden_state [seqLen × hiddenSize] → mean pooling → [hiddenSize]
 */
export function meanPool(hidden: Float32Array, seqLen: number, hiddenSize: number): Float32Array {
  const pooled = new Float32Array(hiddenSize);
  for (let t = 0; t < seqLen; t++) {
    for (let h = 0; h < hiddenSize; h++) {
      pooled[h] += hidden[t * hiddenSize + h];
    }
  }
  for (let h = 0; h < hiddenSize; h++) pooled[h] /= seqLen;
  return pooled;
}

/**
 * logits → softmax → 마지막 클래스(high_pressure) 확률 → 0~100 점수
 */
export function softmaxHighClass(logits: Float32Array): number {
  const arr  = Array.from(logits);
  const max  = Math.max(...arr);
  const exps = arr.map((l) => Math.exp(l - max));
  const sum  = exps.reduce((a, b) => a + b, 0);
  return Math.round((exps[exps.length - 1] / sum) * 100);
}
