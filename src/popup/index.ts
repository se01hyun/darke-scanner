import type { DetectionResult, DarkPatternDetection, Severity, Confidence } from '../types';
import { escHtml } from '../utils/html';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const SEVERITY_KO: Record<Severity, string> = {
  high:   '높음',
  medium: '보통',
  low:    '낮음',
};
const CONFIDENCE_KO: Record<Confidence, string> = {
  confirmed:  '확정',
  suspicious: '의심',
};
const MODULE_KO: Record<string, string> = {
  dom:     'DOM',
  nlp:     'NLP',
  network: '네트워크',
};

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function scoreVerdict(score: number): { label: string; cls: string; fillCls: string } {
  if (score <= 30) return { label: '안전',  cls: 'verdict-safe',    fillCls: 'fill-safe'    };
  if (score <= 60) return { label: '주의',  cls: 'verdict-caution', fillCls: 'fill-caution' };
  return               { label: '위험',  cls: 'verdict-danger',  fillCls: 'fill-danger'  };
}

// ── 렌더러 ────────────────────────────────────────────────────────────────────

function renderNoResult(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'state-view';
  el.innerHTML = `
    <span class="state-icon">⏳</span>
    <span class="state-title">아직 스캔 전입니다</span>
    <span class="state-desc">페이지를 새로고침하면<br>자동으로 스캔이 시작됩니다.</span>
  `;
  return el;
}

function renderClean(result: DetectionResult): HTMLElement {
  const el = document.createElement('div');
  el.className = 'state-view';

  const ts = new Date(result.scanTimestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit',
  });

  el.innerHTML = `
    <span class="state-icon">✅</span>
    <span class="state-title">다크 패턴이 탐지되지 않았습니다</span>
    <span class="state-desc">스캔 시각: ${escHtml(ts)}</span>
  `;
  return el;
}

function renderScoreSection(result: DetectionResult): HTMLElement {
  const { overallRiskScore: score, detections } = result;
  const { label, cls, fillCls } = scoreVerdict(score);

  const ts = new Date(result.scanTimestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit',
  });

  const highCount   = detections.filter(d => d.severity === 'high').length;
  const medCount    = detections.filter(d => d.severity === 'medium').length;
  const confirmedCt = detections.filter(d => d.confidence === 'confirmed').length;

  const summaryParts: string[] = [];
  if (highCount)  summaryParts.push(`높음 ${highCount}건`);
  if (medCount)   summaryParts.push(`보통 ${medCount}건`);
  const lowCount = detections.length - highCount - medCount;
  if (lowCount > 0) summaryParts.push(`낮음 ${lowCount}건`);
  const summaryText = summaryParts.length
    ? summaryParts.join(' · ') + ` (확정 ${confirmedCt}건)`
    : '';

  const section = document.createElement('div');
  section.className = 'score-section';
  section.innerHTML = `
    <div class="score-row">
      <span class="score-label">위험도</span>
      <span class="score-number" style="color: var(--text)">${score}</span>
      <span class="score-unit">/ 100</span>
      <span class="score-verdict ${escHtml(cls)}">${escHtml(label)}</span>
    </div>
    <div class="score-bar-track">
      <div class="score-bar-fill ${escHtml(fillCls)}" id="score-fill"></div>
    </div>
    <div class="score-summary">
      탐지 ${detections.length}건${summaryText ? ' · ' + escHtml(summaryText) : ''} &middot; 스캔 ${escHtml(ts)}
    </div>
  `;
  return section;
}

function renderCard(d: DarkPatternDetection): HTMLElement {
  const card = document.createElement('div');
  card.className = 'detection-card';
  card.innerHTML = `
    <div class="card-bar bar-${escHtml(d.severity)}"></div>
    <div class="card-body">
      <div class="card-top">
        <span class="guideline-num">기준 ${d.guideline}</span>
        <span class="card-name">${escHtml(d.guidelineName)}</span>
      </div>
      <div class="chips">
        <span class="chip chip-${escHtml(d.confidence)}">${escHtml(CONFIDENCE_KO[d.confidence])}</span>
        <span class="chip chip-${escHtml(d.severity)}">심각도 ${escHtml(SEVERITY_KO[d.severity])}</span>
      </div>
      <div class="card-desc">${escHtml(d.description)}</div>
      <div class="card-meta">${escHtml(MODULE_KO[d.module] ?? d.module)} 모듈</div>
    </div>
  `;
  return card;
}

function renderDetections(result: DetectionResult): DocumentFragment {
  const frag = document.createDocumentFragment();

  frag.appendChild(renderScoreSection(result));

  const listHeader = document.createElement('div');
  listHeader.className = 'list-header';
  listHeader.textContent = `탐지 항목 ${result.detections.length}건`;
  frag.appendChild(listHeader);

  // severity 내림차순 (high → medium → low), 같으면 confirmed 우선
  const sorted = [...result.detections].sort((a, b) => {
    const sv = { high: 2, medium: 1, low: 0 };
    const cv = { confirmed: 1, suspicious: 0 };
    return (sv[b.severity] - sv[a.severity]) || (cv[b.confidence] - cv[a.confidence]);
  });

  for (const d of sorted) {
    frag.appendChild(renderCard(d));
  }

  frag.appendChild(renderExportButton(result));

  return frag;
}

// ── JSON 내보내기 ──────────────────────────────────────────────────────────────

function downloadJson(result: DetectionResult): void {
  const json = JSON.stringify(result, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const ts = new Date(result.scanTimestamp)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  let domain = '';
  try { domain = new URL(result.pageUrl).hostname + '-'; } catch { /* pageUrl 없는 경우 */ }

  const a = document.createElement('a');
  a.href = url;
  a.download = `dark-scanner-${domain}${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderExportButton(result: DetectionResult): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'export-row';

  const btn = document.createElement('button');
  btn.className = 'export-btn';
  btn.textContent = '결과 내보내기 (JSON)';
  btn.addEventListener('click', () => downloadJson(result));

  wrap.appendChild(btn);
  return wrap;
}

// ── 점수 바 애니메이션 ────────────────────────────────────────────────────────
// transition이 작동하려면 초기 width: 0 → requestAnimationFrame 후 목표값 설정

function animateScoreBar(score: number): void {
  const fill = document.getElementById('score-fill') as HTMLElement | null;
  if (!fill) return;

  // 첫 프레임: width=0이 페인트된 뒤 다음 프레임에서 목표값으로 변경
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fill.style.width = `${score}%`;
    });
  });
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('root')!;

  // 로딩 상태는 popup.html 초기 HTML이 보여주므로 별도 교체 불필요.
  // storage 조회 실패 시를 대비해 try/catch 처리한다.

  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch {
    // 권한 없는 탭(chrome:// 등) — 빈 상태 표시
  }

  if (tabId === undefined) {
    root.innerHTML = '';
    root.appendChild(renderNoResult());
    return;
  }

  let result: DetectionResult | null = null;
  try {
    const key = `result:${tabId}`;
    const data = await chrome.storage.session.get(key);
    result = (data[key] as DetectionResult | undefined) ?? null;
  } catch {
    // storage 접근 실패 시 미스캔 상태로 표시
  }

  root.innerHTML = '';

  if (!result) {
    root.appendChild(renderNoResult());
    return;
  }

  if (result.detections.length === 0) {
    root.appendChild(renderClean(result));
    return;
  }

  root.appendChild(renderDetections(result));
  animateScoreBar(result.overallRiskScore);
});
