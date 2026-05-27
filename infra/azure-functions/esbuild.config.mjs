import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(__dirname, 'src/functions/sbomCrawl.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: resolve(__dirname, 'dist/src/functions'),
  sourcemap: true,
  // Resolve @/app/* path aliases to the shared source in the repo root
  alias: {
    '@/app': resolve(__dirname, '../../app'),
  },
  // Ensure esbuild finds pg and other deps when resolving shared code from ../../app/
  nodePaths: [resolve(__dirname, 'node_modules')],
  // @azure/functions must be external — it loads @azure/functions-core from the host runtime
  // at a special resolution path. Bundling it breaks that resolution.
  // pg-native is an optional native binding — skip it.
  external: ['@azure/functions', 'pg-native'],
  banner: {},
};

if (isWatch) {
  const ctx = await build({ ...options, logLevel: 'info' });
  // esbuild watch mode is automatic with context
  console.log('Watching for changes...');
} else {
  await build(options);
  console.log('Build complete.');
}
