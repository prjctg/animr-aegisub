import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/animr-aegisub.js',
    format: 'esm',
    sourcemap: true,
    banner: `/*!
 * animr-aegisub — MIT License — Copyright (c) 2026 prjctg
 * Includes fengari-web — MIT License — Copyright (c) 2017-2025 Benoit Giannangeli, Daurnimator
 */`,
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
  ],
};
