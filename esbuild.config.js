import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

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

      if (!isWatch) {
        console.log('Assets copied to dist/.');
      }
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
  { in: 'src/content/index.ts',            out: 'content'           },
  { in: 'src/background/index.ts',         out: 'background'        },
  { in: 'src/popup/index.ts',              out: 'popup'             },
  { in: 'src/overlay/index.ts',            out: 'overlay'           },
  { in: 'src/content/page-interceptor.ts', out: 'page-interceptor'  },
];

if (isWatch) {
  const ctx = await esbuild.context({ ...baseConfig, entryPoints });
  await ctx.watch();
  console.log('Watching... (output → dist/)');
} else {
  await esbuild.build({ ...baseConfig, entryPoints });
  console.log('Build complete (Production: ' + isProd + ').');
}
