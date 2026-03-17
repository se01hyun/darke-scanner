// ONNX 세션 관리자 — onnxruntime-web 기반
//
// 실행 전략 (CLAUDE.md §Module 2 WASM 실행 폴백):
//   1) MV3 Service Worker에서 직접 ONNX 추론 시도
//   2) SharedArrayBuffer 미지원 등으로 실패 시 chrome.offscreen API 경유

import * as ort from 'onnxruntime-web';
import { initTokenizer, tokenize, cosineSim, MAX_SEQ_LEN } from './tokenizer';
import { HIDDEN_SIZE, meanPool, softmaxHighClass } from './onnx-utils';

export class OnnxSession {
  private session: ort.InferenceSession | null = null;
  private useOffscreen = false;
  private _ready = false;

  get isReady(): boolean { return this._ready; }

  /** 모델 파일을 로드하고 세션을 초기화한다. */
  async load(modelUrl: string): Promise<void> {
    try {
      await this.loadDirect(modelUrl);
      this.useOffscreen = false;
    } catch {
      // Service Worker에서 WASM 실행이 막힌 경우 Offscreen Document로 폴백
      this.useOffscreen = true;
      await this.ensureOffscreen();
    }
    this._ready = true;
  }

  /**
   * 텍스트 임베딩 추출 (last hidden state mean pooling).
   * @returns Float32Array [HIDDEN_SIZE]
   */
  async embed(text: string): Promise<Float32Array> {
    if (!this._ready) throw new Error('OnnxSession: load() 먼저 호출 필요');
    return this.useOffscreen
      ? this.offscreenRequest<Float32Array>('OFFSCREEN_EMBED', { text },
          (r) => new Float32Array(r.embedding as number[]))
      : this.runEmbedding(text);
  }

  /**
   * 심리적 압박 분류 점수 (0~100).
   * 모델의 logits 출력에서 high_pressure 클래스 확률을 점수로 변환.
   */
  async pressureScore(text: string): Promise<number> {
    if (!this._ready) throw new Error('OnnxSession: load() 먼저 호출 필요');
    return this.useOffscreen
      ? this.offscreenRequest<number>('OFFSCREEN_PRESSURE', { text },
          (r) => r.score as number)
      : this.runPressureClassification(text);
  }

  /**
   * 리뷰 텍스트 목록에서 의심 클러스터 인덱스 쌍을 반환 (semantic cosine 유사도 기반).
   * TF-IDF 대비 의미적 유사도를 측정하므로 표현만 다른 복제 리뷰도 탐지한다.
   */
  async semanticSimilarityMatrix(texts: string[]): Promise<number[][]> {
    if (!this._ready) throw new Error('OnnxSession: load() 먼저 호출 필요');
    const embeddings = await Promise.all(texts.map((t) => this.embed(t)));
    return embeddings.map((a, i) =>
      embeddings.map((b, j) => (i === j ? 1 : cosineSim(a, b))),
    );
  }

  // ── 직접 실행 (Service Worker) ─────────────────────────────────────────────

  private async loadDirect(modelUrl: string): Promise<void> {
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer 미지원');
    }
    // WASM 파일 경로를 확장 프로그램 루트 기준으로 설정 (디렉토리 prefix 방식)
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('');
    // MV3 Service Worker: 멀티스레드 비활성화 (SharedArrayBuffer 제한)
    ort.env.wasm.numThreads = 1;

    // WordPiece vocab 초기화 (모델과 함께 로드)
    const vocabUrl = chrome.runtime.getURL('koelectra-vocab.json');
    await initTokenizer(vocabUrl);

    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }

  private async runEmbedding(text: string): Promise<Float32Array> {
    const { inputIds, attentionMask, tokenTypeIds } = tokenize(text);
    const feeds = this.buildFeeds(inputIds, attentionMask, tokenTypeIds);
    const results = await this.session!.run(feeds);

    const hiddenState = results['last_hidden_state']?.data as Float32Array | undefined;
    if (!hiddenState) throw new Error('last_hidden_state 출력 없음');

    return meanPool(hiddenState, MAX_SEQ_LEN, HIDDEN_SIZE);
  }

  private async runPressureClassification(text: string): Promise<number> {
    const { inputIds, attentionMask, tokenTypeIds } = tokenize(text);
    const feeds = this.buildFeeds(inputIds, attentionMask, tokenTypeIds);
    const results = await this.session!.run(feeds);

    const logits = results['logits']?.data as Float32Array | undefined;
    if (!logits) throw new Error('logits 출력 없음');

    return softmaxHighClass(logits);
  }

  private buildFeeds(
    inputIds: BigInt64Array,
    attentionMask: BigInt64Array,
    tokenTypeIds: BigInt64Array,
  ): Record<string, ort.Tensor> {
    return {
      input_ids:      new ort.Tensor('int64', inputIds,      [1, MAX_SEQ_LEN]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, MAX_SEQ_LEN]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds,  [1, MAX_SEQ_LEN]),
    };
  }

  // ── Offscreen Document 폴백 ────────────────────────────────────────────────

  private async ensureOffscreen(): Promise<void> {
    if (!chrome.offscreen) return; // 권한 없는 환경 안전 처리
    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['WORKERS' as chrome.offscreen.Reason],
        justification: 'ONNX WASM inference requires DOM context',
      });
    } catch {
      // 이미 생성돼 있으면 무시
    }
  }

  private async offscreenRequest<T>(
    type: string,
    payload: Record<string, unknown>,
    extract: (r: Record<string, unknown>) => T,
  ): Promise<T> {
    const resp: Record<string, unknown> = await chrome.runtime.sendMessage({
      type,
      target: 'offscreen',
      payload,
    });
    return extract(resp);
  }
}

