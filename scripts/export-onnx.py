#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
# Windows cp949 터미널에서 torch verbose 출력의 emoji 인코딩 오류 방지
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
KoELECTRA-small-v3-discriminator → ONNX 변환 스크립트
Dark-Scanner NLP 모듈용 임베딩 모델 준비

사용법:
  pip install torch transformers onnxruntime
  python scripts/export-onnx.py

출력:
  models/koelectra-fomo.onnx    INT8 양자화 모델 (≤50MB 목표)
  rules/koelectra-vocab.json    WordPiece 토크나이저 vocab (배열: index = token ID)

모델 사용 용도:
  - last_hidden_state 출력 → mean pooling → 문장 임베딩 → 가짜 리뷰 코사인 유사도 (G5)
  - logits 출력 없음 → 압박 지수는 규칙 기반 calcPressureScore() 폴백으로 처리
"""

import subprocess
import sys
import os
import json

# ── 패키지 자동 설치 ─────────────────────────────────────────────────────────

def pip_install(*pkgs: str) -> None:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', *pkgs])

try:
    from transformers import AutoModel, AutoTokenizer  # type: ignore
except ImportError:
    print('[setup] transformers 설치 중...')
    pip_install('transformers')
    from transformers import AutoModel, AutoTokenizer  # type: ignore

try:
    import torch  # type: ignore
except ImportError:
    print('[setup] torch 설치 중...')
    pip_install('torch')
    import torch  # type: ignore

try:
    from onnxruntime.quantization import quantize_dynamic, QuantType  # type: ignore
except (ImportError, ModuleNotFoundError):
    print('[setup] onnx, onnxruntime 설치 중...')
    pip_install('onnx', 'onnxruntime')
    from onnxruntime.quantization import quantize_dynamic, QuantType  # type: ignore

# ── 설정 ─────────────────────────────────────────────────────────────────────

MODEL_ID  = 'monologg/koelectra-small-v3-discriminator'
MAX_SEQ   = 128
TMP_FP32  = os.path.join('models', '_koelectra_fp32.onnx')
OUT_MODEL = os.path.join('models', 'koelectra-fomo.onnx')
OUT_VOCAB = os.path.join('rules', 'koelectra-vocab.json')

os.makedirs('models', exist_ok=True)

# ── Step 1: 모델 & 토크나이저 다운로드 ───────────────────────────────────────

print(f'\n[1/4] 모델 다운로드: {MODEL_ID}')
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
base_model = AutoModel.from_pretrained(MODEL_ID)
base_model.eval()
print(f'      hidden_size={base_model.config.hidden_size}')

# ── Step 2: vocab 저장 ────────────────────────────────────────────────────────

print('\n[2/4] vocab 저장')
# vocab은 {token: id} dict → id 순 배열로 변환
id2token = {v: k for k, v in tokenizer.vocab.items()}
vocab_list = [id2token.get(i, '[UNK]') for i in range(len(id2token))]
with open(OUT_VOCAB, 'w', encoding='utf-8') as f:
    json.dump(vocab_list, f, ensure_ascii=False)
print(f'      {len(vocab_list)}토큰 → {OUT_VOCAB}')

# ── Step 3: ONNX export ───────────────────────────────────────────────────────
# 래퍼로 last_hidden_state만 출력 (ONNX 그래프 단순화)

class KoELECTRAWrapper(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
        token_type_ids: torch.Tensor,
    ) -> torch.Tensor:
        out = self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
        )
        return out.last_hidden_state  # [batch, seq, hidden]

wrapped = KoELECTRAWrapper(base_model)
wrapped.eval()

dummy_ids  = torch.zeros(1, MAX_SEQ, dtype=torch.long)
dummy_mask = torch.zeros(1, MAX_SEQ, dtype=torch.long)
dummy_type = torch.zeros(1, MAX_SEQ, dtype=torch.long)

print('\n[3/4] ONNX export (FP32)')
with torch.no_grad():
    torch.onnx.export(
        wrapped,
        args=(dummy_ids, dummy_mask, dummy_type),
        f=TMP_FP32,
        input_names=['input_ids', 'attention_mask', 'token_type_ids'],
        output_names=['last_hidden_state'],
        dynamic_axes={
            'input_ids':         {0: 'batch'},
            'attention_mask':    {0: 'batch'},
            'token_type_ids':    {0: 'batch'},
            'last_hidden_state': {0: 'batch'},
        },
        opset_version=14,
        do_constant_folding=True,
    )
fp32_mb = os.path.getsize(TMP_FP32) / 1e6
print(f'      FP32: {fp32_mb:.1f} MB')

# ── Step 4: INT8 동적 양자화 ──────────────────────────────────────────────────

print('\n[4/4] INT8 동적 양자화')
quantize_dynamic(
    TMP_FP32,
    OUT_MODEL,
    weight_type=QuantType.QInt8,
)
# FP32 임시 파일 정리 (torch dynamo exporter가 .data 외부 파일도 생성할 수 있음)
for tmp in [TMP_FP32, TMP_FP32 + '.data']:
    if os.path.exists(tmp):
        os.remove(tmp)

q8_mb = os.path.getsize(OUT_MODEL) / 1e6
print(f'      INT8: {q8_mb:.1f} MB → {OUT_MODEL}')

# ── 결과 요약 ─────────────────────────────────────────────────────────────────

print()
if q8_mb > 50:
    print(f'⚠️  모델 크기({q8_mb:.1f}MB)가 50MB 제한 초과.')
    print('   추가 최적화: quantize_dynamic(..., weight_type=QuantType.QUInt8) 시도')
else:
    print('✅ 변환 완료!')
    print(f'   {OUT_MODEL} ({q8_mb:.1f} MB)')
    print(f'   {OUT_VOCAB}')
    print()
    print('다음 단계: node esbuild.config.js')
