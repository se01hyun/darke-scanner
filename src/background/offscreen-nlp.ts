// Offscreen Document — ONNX WASM 추론 핸들러
//
// MV3 Service Worker에서 SharedArrayBuffer 미지원으로 ONNX 실행이 막힐 때
// chrome.offscreen API(Chrome 116+)로 이 문서를 열어 WASM 추론을 수행한다.
//
// 메시지 형식:
//   → { type: 'OFFSCREEN_EMBED',    target: 'offscreen', payload: { text } }
//   ← { embedding: number[] }
//
//   → { type: 'OFFSCREEN_PRESSURE', target: 'offscreen', payload: { text } }
//   ← { score: number }

import * as ort from 'onnxruntime-web';
import { initTokenizer, tokenize, MAX_SEQ_LEN } from '../nlp/tokenizer';
import { HIDDEN_SIZE, meanPool, softmaxHighClass } from '../nlp/onnx-utils';

const MODEL_FILENAME = 'models/koelectra-fomo.onnx';

let session: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;

  const modelUrl = chrome.runtime.getURL(MODEL_FILENAME);
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('');

  // WordPiece vocab 초기화 (세션과 함께 로드)
  const vocabUrl = chrome.runtime.getURL('koelectra-vocab.json');
  await initTokenizer(vocabUrl);

  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return session;
}

async function runEmbedding(text: string): Promise<Float32Array> {
  const sess = await getSession();
  const { inputIds, attentionMask, tokenTypeIds } = tokenize(text);

  const results = await sess.run({
    input_ids:      new ort.Tensor('int64', inputIds,      [1, MAX_SEQ_LEN]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, MAX_SEQ_LEN]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds,  [1, MAX_SEQ_LEN]),
  });

  const hidden = results['last_hidden_state']?.data as Float32Array | undefined;
  if (!hidden) throw new Error('last_hidden_state 출력 없음');

  return meanPool(hidden, MAX_SEQ_LEN, HIDDEN_SIZE);
}

async function runPressure(text: string): Promise<number> {
  const sess = await getSession();
  const { inputIds, attentionMask, tokenTypeIds } = tokenize(text);

  const results = await sess.run({
    input_ids:      new ort.Tensor('int64', inputIds,      [1, MAX_SEQ_LEN]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, MAX_SEQ_LEN]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds,  [1, MAX_SEQ_LEN]),
  });

  const logits = results['logits']?.data as Float32Array | undefined;
  if (!logits) throw new Error('logits 출력 없음');

  return softmaxHighClass(logits);
}

// ── 메시지 리스너 ──────────────────────────────────────────────────────────

type OffscreenMessage = {
  type: 'OFFSCREEN_EMBED' | 'OFFSCREEN_PRESSURE';
  target: string;
  payload: { text: string };
};

chrome.runtime.onMessage.addListener(
  (msg: OffscreenMessage, _sender, sendResponse) => {
    if (msg.target !== 'offscreen') return false;

    if (msg.type === 'OFFSCREEN_EMBED') {
      runEmbedding(msg.payload.text)
        .then((emb) => sendResponse({ embedding: Array.from(emb) }))
        .catch((e)  => sendResponse({ error: String(e) }));
      return true; // async response
    }

    if (msg.type === 'OFFSCREEN_PRESSURE') {
      runPressure(msg.payload.text)
        .then((score) => sendResponse({ score }))
        .catch((e)    => sendResponse({ error: String(e) }));
      return true;
    }

    return false;
  },
);


