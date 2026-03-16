import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const baseConfig = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
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
