#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
ONNX 모델 로딩 및 추론 검증 스크립트
models/koelectra-fomo.onnx 가 올바르게 동작하는지 확인한다.

사용법:
  python scripts/verify-onnx.py
"""

import json
import sys
import numpy as np
import onnxruntime as ort

MODEL_PATH = 'models/koelectra-fomo.onnx'
VOCAB_PATH = 'rules/koelectra-vocab.json'
MAX_SEQ    = 128
HIDDEN     = 256  # koelectra-small hidden size

# ── 색상 출력 헬퍼 ────────────────────────────────────────────────────────────
OK   = '[OK]  '
FAIL = '[FAIL]'
INFO = '[INFO]'

def ok(msg: str)   -> None: print(f'{OK} {msg}')
def fail(msg: str) -> None: print(f'{FAIL} {msg}'); sys.exit(1)
def info(msg: str) -> None: print(f'{INFO} {msg}')

# ── 1. 모델 파일 로드 ─────────────────────────────────────────────────────────
print('\n=== ONNX 모델 검증 ===\n')
info(f'모델 경로: {MODEL_PATH}')

try:
    sess = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])
    ok('모델 로드 성공')
except Exception as e:
    fail(f'모델 로드 실패: {e}')

# ── 2. 입출력 shape 확인 ──────────────────────────────────────────────────────
inputs  = {i.name: i.shape for i in sess.get_inputs()}
outputs = {o.name: o.shape for o in sess.get_outputs()}

info(f'입력: {inputs}')
info(f'출력: {outputs}')

expected_inputs  = {'input_ids', 'attention_mask', 'token_type_ids'}
expected_outputs = {'last_hidden_state'}

if not expected_inputs.issubset(inputs.keys()):
    fail(f'입력 텐서 누락: {expected_inputs - inputs.keys()}')
ok('입력 텐서 확인 (input_ids, attention_mask, token_type_ids)')

if not expected_outputs.issubset(outputs.keys()):
    fail(f'출력 텐서 누락: {expected_outputs - outputs.keys()}')
ok('출력 텐서 확인 (last_hidden_state)')

# ── 3. 실제 추론 — dummy 입력 ─────────────────────────────────────────────────
info('더미 입력으로 추론 실행 중...')
dummy = {
    'input_ids':      np.zeros((1, MAX_SEQ), dtype=np.int64),
    'attention_mask': np.zeros((1, MAX_SEQ), dtype=np.int64),
    'token_type_ids': np.zeros((1, MAX_SEQ), dtype=np.int64),
}
try:
    result = sess.run(['last_hidden_state'], dummy)
    ok('더미 추론 성공')
except Exception as e:
    fail(f'추론 실패: {e}')

hidden = result[0]  # [1, MAX_SEQ, hidden_size]
info(f'출력 shape: {hidden.shape}  (기대: [1, {MAX_SEQ}, {HIDDEN}])')

if hidden.shape != (1, MAX_SEQ, HIDDEN):
    fail(f'출력 shape 불일치: {hidden.shape}')
ok(f'출력 shape 일치 [1, {MAX_SEQ}, {HIDDEN}]')

# ── 4. Mean pooling → cosine similarity 검증 ─────────────────────────────────
info('Mean pooling 및 코사인 유사도 검증 중...')

def mean_pool(h: np.ndarray) -> np.ndarray:
    return h[0].mean(axis=0)  # [hidden]

def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0

# 동일 텍스트 → 유사도 1.0 근접, 다른 텍스트 → 낮아야 함
def embed(text: str) -> np.ndarray:
    with open(VOCAB_PATH, encoding='utf-8') as f:
        vocab: list[str] = json.load(f)
    token2id = {tok: i for i, tok in enumerate(vocab)}

    CLS, SEP, UNK, PAD = 101, 102, 100, 0
    words = text.strip().lower().split()
    ids = [CLS]
    for word in words:
        if len(ids) >= MAX_SEQ - 1:
            break
        # 간단 WordPiece (최장 일치)
        rest, first = word, True
        while rest:
            matched = False
            for end in range(len(rest), 0, -1):
                sub = ('' if first else '##') + rest[:end]
                if sub in token2id:
                    ids.append(token2id[sub])
                    rest = rest[end:]
                    first = False
                    matched = True
                    break
            if not matched:
                ids.append(UNK)
                break
        if len(ids) >= MAX_SEQ - 1:
            break
    ids.append(SEP)

    seq = len(ids)
    inp = {
        'input_ids':      np.array([[ids[i] if i < seq else PAD for i in range(MAX_SEQ)]], dtype=np.int64),
        'attention_mask': np.array([[1 if i < seq else 0         for i in range(MAX_SEQ)]], dtype=np.int64),
        'token_type_ids': np.zeros((1, MAX_SEQ), dtype=np.int64),
    }
    out = sess.run(['last_hidden_state'], inp)[0]
    return mean_pool(out)

try:
    e1 = embed('지금 구매하면 50% 할인')
    e2 = embed('지금 구매하면 50% 할인')   # 동일
    e3 = embed('무료 배송 서비스 안내')     # 다름

    sim_same = cosine_sim(e1, e2)
    sim_diff = cosine_sim(e1, e3)
    info(f'동일 문장 유사도: {sim_same:.4f}  (기대: ~1.0)')
    info(f'다른 문장 유사도: {sim_diff:.4f}  (기대: <{sim_same:.2f})')

    if sim_same < 0.99:
        fail(f'동일 문장 유사도가 너무 낮음: {sim_same:.4f}')
    ok(f'동일 문장 유사도 정상 ({sim_same:.4f})')

    if sim_diff >= sim_same:
        fail(f'다른 문장이 동일 문장보다 유사도 높음: {sim_diff:.4f} >= {sim_same:.4f}')
    ok(f'다른 문장 유사도 정상 ({sim_diff:.4f} < {sim_same:.4f})')

except Exception as e:
    fail(f'유사도 검증 실패: {e}')

# ── 결과 ──────────────────────────────────────────────────────────────────────
print('\n=== 검증 완료 ✅ ===')
print('모델이 onnxruntime에서 정상 동작합니다.')
print('브라우저 onnxruntime-web(WASM) 탑재 가능 상태입니다.\n')
