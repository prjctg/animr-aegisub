import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/animr-aegisub.js',
    format: 'esm',
    sourcemap: true,
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
  ],
};
