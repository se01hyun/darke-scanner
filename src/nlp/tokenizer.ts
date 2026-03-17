// KoELECTRA 입력 텐서 변환 — 간이 문자 단위 토크나이저
//
// ⚠️  현재 구현은 문자(Unicode code point) 단위 인코딩을 사용하는 간이 구현이다.
//     실제 KoELECTRA 모델과 정확히 매칭하려면 vocab.txt 기반 WordPiece 토크나이저로
//     교체해야 한다. 단, 인터페이스(TokenizerOutput)와 MAX_SEQ_LEN은 그대로 유지된다.

// KoELECTRA 특수 토큰 ID (BERT 호환)
const TOKEN_PAD = 0;
const TOKEN_CLS = 101;
const TOKEN_SEP = 102;
const TOKEN_UNK = 100;

// 문자 → 토큰 ID 오프셋 (특수 토큰 영역 이후)
const CHAR_ID_OFFSET = 200;
// ID 충돌 방지용 모듈러스 (BERT vocab size 30522 기준)
const CHAR_ID_MOD = 30000;

/** 최대 시퀀스 길이 (KoELECTRA 기본값) */
export const MAX_SEQ_LEN = 128;

export interface TokenizerOutput {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
}

/** 유니코드 문자 → 토큰 ID 변환 */
function charToId(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 33) return TOKEN_UNK; // 제어문자·공백
  return CHAR_ID_OFFSET + (code % CHAR_ID_MOD);
}

/**
 * 텍스트를 KoELECTRA ONNX 입력 텐서(int64)로 변환.
 * 형식: [CLS] + 문자열(truncate) + [SEP] + [PAD]...
 */
export function tokenize(text: string, maxLen = MAX_SEQ_LEN): TokenizerOutput {
  // [CLS] + chars + [SEP] 로 구성; 최대 (maxLen - 2) 문자
  const chars = Array.from(text.trim()).slice(0, maxLen - 2);
  const ids   = [TOKEN_CLS, ...chars.map(charToId), TOKEN_SEP];
  const seqLen = ids.length;

  const inputIds      = new BigInt64Array(maxLen);
  const attentionMask = new BigInt64Array(maxLen);
  const tokenTypeIds  = new BigInt64Array(maxLen);

  for (let i = 0; i < maxLen; i++) {
    inputIds[i]      = BigInt(i < seqLen ? ids[i] : TOKEN_PAD);
    attentionMask[i] = i < seqLen ? 1n : 0n;
    tokenTypeIds[i]  = 0n;
  }

  return { inputIds, attentionMask, tokenTypeIds };
}

/**
 * 두 Float32Array 간 코사인 유사도 (0~1).
 * 임베딩 비교에 사용한다.
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
