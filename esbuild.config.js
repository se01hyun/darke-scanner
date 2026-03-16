import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
// --prod 플래그 또는 NODE_ENV=production 환경 변수로 프로덕션 빌드 활성화
const isProd  = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

const baseConfig = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: isWatch ? 'inline' : false,
  minify: isProd,
  // __DS_DEBUG__: 개발=true, 프로덕션=false
  // esbuild가 리터럴로 인라인하여 if(!__DS_DEBUG__) 분기를 dead-code로 제거한다.
  define: {
    '__DS_DEBUG__': isProd ? 'false' : 'true',
  },
  outdir: '.',   // entryPoints의 out 경로가 dist/xxx 이므로 outdir은 프로젝트 루트
};

const entryPoints = [
  { in: 'src/content/index.ts',             out: 'dist/content'           },
  { in: 'src/background/index.ts',          out: 'dist/background'        },
  { in: 'src/popup/index.ts',               out: 'dist/popup'             },
  { in: 'src/overlay/index.ts',             out: 'dist/overlay'           },
  // page-interceptor: 페이지 main world에 주입되는 별도 번들 (chrome API 미포함)
  { in: 'src/content/page-interceptor.ts',  out: 'dist/page-interceptor'  },
];

if (isWatch) {
  const ctx = await esbuild.context({ ...baseConfig, entryPoints });
  await ctx.watch();
  console.log('Watching...');
} else {
  await esbuild.build({ ...baseConfig, entryPoints });
  console.log('Build complete.');
}
