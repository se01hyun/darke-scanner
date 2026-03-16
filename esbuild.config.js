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
  { in: 'src/content/index.ts',    out: 'dist/content'    },
  { in: 'src/background/index.ts', out: 'dist/background' },
  { in: 'src/popup/index.ts',      out: 'dist/popup'      },
  { in: 'src/overlay/index.ts',    out: 'dist/overlay'    },
];

if (isWatch) {
  const ctx = await esbuild.context({ ...baseConfig, entryPoints });
  await ctx.watch();
  console.log('Watching...');
} else {
  await esbuild.build({ ...baseConfig, entryPoints });
  console.log('Build complete.');
}
