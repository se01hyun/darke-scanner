import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── 빌드 결과물 검증 ────────────────────────────────────────────────────────
// manifest.json 참조 경로 + 필수 NLP 자산이 dist/ 에 모두 존재하는지 확인.
// 누락 파일이 있으면 목록을 출력하고 프로세스를 exit(1)로 종료한다.
function verifyDist() {
  const distDir = 'dist';

  // manifest.json 에서 참조되는 모든 파일 경로 수집
  const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));

  /** @type {string[]} */
  const manifestPaths = [];

  if (manifest.background?.service_worker) {
    manifestPaths.push(manifest.background.service_worker);
  }
  for (const cs of manifest.content_scripts ?? []) {
    for (const js of cs.js ?? []) manifestPaths.push(js);
  }
  if (manifest.action?.default_popup) {
    manifestPaths.push(manifest.action.default_popup);
  }
  for (const src of Object.values(manifest.action?.default_icon ?? {})) {
    manifestPaths.push(String(src));
  }
  for (const src of Object.values(manifest.icons ?? {})) {
    manifestPaths.push(String(src));
  }
  for (const war of manifest.web_accessible_resources ?? []) {
    for (const r of war.resources ?? []) manifestPaths.push(r);
  }

  // 중복 제거
  const required = [...new Set(manifestPaths)];

  // manifest 외 필수 자산 (NLP 어휘 사전, offscreen 문서)
  const extraRequired = [
    'koelectra-vocab.json',  // rules/ → dist/ 복사, NLP 토크나이저가 참조
    'offscreen.html',        // chrome.offscreen API 진입점
    'offscreen.js',          // offscreen-nlp 번들
  ];

  const allRequired = [...required, ...extraRequired];

  const missing = allRequired.filter(f => !existsSync(join(distDir, f)));
  const present = allRequired.filter(f =>  existsSync(join(distDir, f)));

  console.log('\n── dist/ 검증 결과 ──────────────────────────────────────');
  for (const f of present) console.log(`  ✓  ${f}`);
  for (const f of missing) console.log(`  ✗  ${f}  ← 누락`);
  console.log('─────────────────────────────────────────────────────────');

  if (missing.length > 0) {
    console.error(`\n[verify] 빌드 실패: ${missing.length}개 파일 누락 — 위 목록 확인\n`);
    process.exit(1);
  }

  console.log(`[verify] 전체 ${allRequired.length}개 파일 확인 완료.\n`);
}

const isWatch = process.argv.includes('--watch');
const isProd  = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

// ── 정적 자산 복사 플러그인 ─────────────────────────────────────────────────
// 빌드 완료 후 manifest.json, popup.html, 아이콘, rules/*.json 을 dist/ 로 복사.
// Chrome은 dist/ 디렉터리를 확장 프로그램 루트로 인식한다.
const copyAssetsPlugin = {
  name: 'copy-assets',
  setup(build) {
    build.onEnd(() => {
      mkdirSync('dist', { recursive: true });

      // 루트 정적 파일
      const staticFiles = [
        'manifest.json',
        'popup.html',
        'icon-16.png',
        'icon-48.png',
        'icon-128.png',
      ];
      for (const f of staticFiles) {
        copyFileSync(f, join('dist', f));
      }

      // rules/*.json → dist/*.json
      // web_accessible_resources 에서 파일명만으로 참조하므로 dist 루트에 위치해야 한다.
      for (const f of readdirSync('rules')) {
        if (f.endsWith('.json')) {
          copyFileSync(join('rules', f), join('dist', f));
        }
      }

      // offscreen.html → dist/offscreen.html
      if (existsSync('offscreen.html')) {
        copyFileSync('offscreen.html', join('dist', 'offscreen.html'));
      }

      // models/*.onnx → dist/models/*.onnx
      if (existsSync('models')) {
        mkdirSync(join('dist', 'models'), { recursive: true });
        for (const f of readdirSync('models')) {
          if (f.endsWith('.onnx')) {
            copyFileSync(join('models', f), join('dist', 'models', f));
          }
        }
      }

      // onnxruntime-web WASM 파일 → dist/ 루트
      // ort.env.wasm.wasmPaths 가 dist/ 루트를 기준으로 설정된다.
      const ortWasmDir = join('node_modules', 'onnxruntime-web', 'dist');
      if (existsSync(ortWasmDir)) {
        for (const f of readdirSync(ortWasmDir)) {
          if (f.endsWith('.wasm')) {
            copyFileSync(join(ortWasmDir, f), join('dist', f));
          }
        }
      }

      if (isWatch) return;

      console.log('Assets copied to dist/.');
      verifyDist();
    });
  },
};

// ── 빌드 설정 ──────────────────────────────────────────────────────────────
const baseConfig = {
  bundle: true,
  // IIFE: 모든 번들을 즉시실행함수로 감싸 전역 변수 오염을 방지한다.
  // - content.js + overlay.js 는 같은 isolated world에서 동시에 로드되므로
  //   ESM 포맷이면 두 파일의 전역 var 가 서로 충돌할 수 있다.
  // - page-interceptor.js 는 페이지 컨텍스트에 직접 주입되므로 더더욱 필요.
  format: 'iife',
  target: 'chrome120',
  sourcemap: isWatch ? 'inline' : false,
  minify: isProd,
  drop: isProd ? ['console', 'debugger'] : [],
  define: {
    '__DS_DEBUG__': isProd ? 'false' : 'true',
  },
  outdir: 'dist',
  plugins: [copyAssetsPlugin],
};

const entryPoints = [
  { in: 'src/content/index.ts',                out: 'content'           },
  { in: 'src/background/index.ts',             out: 'background'        },
  { in: 'src/popup/index.ts',                  out: 'popup'             },
  { in: 'src/overlay/index.ts',                out: 'overlay'           },
  { in: 'src/content/page-interceptor.ts',     out: 'page-interceptor'  },
  { in: 'src/background/offscreen-nlp.ts',     out: 'offscreen'         },
];

if (isWatch) {
  const ctx = await esbuild.context({ ...baseConfig, entryPoints });
  await ctx.watch();
  console.log('Watching... (output → dist/)');
} else {
  await esbuild.build({ ...baseConfig, entryPoints });
  console.log('Build complete (Production: ' + isProd + ').');
}
