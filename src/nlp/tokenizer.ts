// WordPiece 토크나이저 — KoELECTRA-small-v3 호환
//
// vocab은 rules/koelectra-vocab.json (배열: index = token ID)
// scripts/export-onnx.py 실행 후 생성된다.
//
// vocab이 없으면 char-level 폴백으로 동작한다 (keyword-only 모드와 동일 수준).

/** 최대 시퀀스 길이 (KoELECTRA 기본값) */
export const MAX_SEQ_LEN = 128;

const SPECIAL = { PAD: 0, UNK: 100, CLS: 101, SEP: 102 } as const;

// char-level 폴백 상수 (vocab 미초기화 시 사용)
const CHAR_OFFSET = 200;
const CHAR_MOD    = 30000;

/** token → id 맵 (initTokenizer 호출 후 채워짐) */
let vocabMap: Map<string, number> | null = null;

/**
 * koelectra-vocab.json을 로드하여 WordPiece vocab 맵을 초기화한다.
 * OnnxSession.load() / offscreen-nlp.ts getSession() 에서 한 번 호출한다.
 * 이후 호출은 no-op. 로드 실패 시 char-level 폴백이 유지된다.
 */
export async function initTokenizer(vocabUrl: string): Promise<void> {
  if (vocabMap !== null) return;
  try {
    const resp = await fetch(vocabUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const tokens: string[] = await resp.json();
    vocabMap = new Map(tokens.map((tok, id) => [tok, id]));
  } catch (e) {
    console.warn('[Tokenizer] vocab 로드 실패 — char-level 폴백:', e);
  }
}

/**
 * 단어 하나를 WordPiece 서브워드 ID 배열로 변환.
 * vocab 없으면 char-level 폴백.
 */
function wordPiece(word: string): number[] {
  if (!vocabMap) return charFallback(word);

  const ids: number[] = [];
  let rest = word;
  let isFirst = true;

  while (rest.length > 0) {
    let matched = false;
    for (let end = rest.length; end > 0; end--) {
      const sub = (isFirst ? '' : '##') + rest.slice(0, end);
      const id = vocabMap.get(sub);
      if (id !== undefined) {
        ids.push(id);
        rest = rest.slice(end);
        isFirst = false;
        matched = true;
        break;
      }
    }
    if (!matched) {
      ids.push(SPECIAL.UNK);
      break;
    }
  }

  return ids.length > 0 ? ids : [SPECIAL.UNK];
}

/** vocab 없을 때 기존 char-level 변환 */
function charFallback(word: string): number[] {
  return Array.from(word).map((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 33 ? SPECIAL.UNK : CHAR_OFFSET + (code % CHAR_MOD);
  });
}

export interface TokenizerOutput {
  inputIds:      BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds:  BigInt64Array;
}

/**
 * 텍스트를 KoELECTRA ONNX 입력 텐서(int64)로 변환.
 * vocab 초기화 됐으면 WordPiece, 아니면 char-level 폴백.
 * 형식: [CLS] + 서브워드 토큰(truncate) + [SEP] + [PAD]...
 */
export function tokenize(text: string, maxLen = MAX_SEQ_LEN): TokenizerOutput {
  const words = text.trim().toLowerCase().split(/\s+/);
  const ids: number[] = [SPECIAL.CLS];

  for (const word of words) {
    if (ids.length >= maxLen - 1) break; // [SEP] 자리 예약
    for (const id of wordPiece(word)) {
      if (ids.length >= maxLen - 1) break;
      ids.push(id);
    }
  }
  ids.push(SPECIAL.SEP);

  const seqLen = ids.length;
  const inputIds      = new BigInt64Array(maxLen);
  const attentionMask = new BigInt64Array(maxLen);
  const tokenTypeIds  = new BigInt64Array(maxLen);

  for (let i = 0; i < maxLen; i++) {
    inputIds[i]      = BigInt(i < seqLen ? ids[i] : SPECIAL.PAD);
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
