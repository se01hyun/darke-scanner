import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isProd  = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

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
  outdir: '.',
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
  console.log('Watching...');
} else {
  await esbuild.build({ ...baseConfig, entryPoints });
  console.log('Build complete (Production: ' + isProd + ').');
}