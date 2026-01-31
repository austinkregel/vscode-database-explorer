// @ts-check
const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Native modules and optional dependencies that should not be bundled.
 * These will be loaded from node_modules at runtime.
 */
const externalModules = [
  // VS Code API
  'vscode',
  
  // Native modules with binary components
  'ssh2',
  'cpu-features',
  'pg-native',
  
  // MongoDB optional native dependencies
  'kerberos',
  'snappy', 
  '@mongodb-js/zstd',
  'mongodb-client-encryption',
  'gcp-metadata',
  'socks',
  'aws4',
  '@aws-sdk/credential-providers',
  
  // Any .node binary files
  '*.node',
];

/**
 * Plugin to log build results
 * @type {esbuild.Plugin}
 */
const buildLogPlugin = {
  name: 'build-log',
  setup(build) {
    build.onEnd(result => {
      if (result.errors.length > 0) {
        console.error('Build failed with errors');
      } else {
        console.log(`Build completed: ${new Date().toLocaleTimeString()}`);
        if (result.warnings.length > 0) {
          console.log(`Warnings: ${result.warnings.length}`);
        }
      }
    });
  }
};

/**
 * Plugin to handle native .node files by marking them as external
 * @type {esbuild.Plugin}
 */
const nativeNodePlugin = {
  name: 'native-node',
  setup(build) {
    // Mark all .node files as external
    build.onResolve({ filter: /\.node$/ }, args => ({
      path: args.path,
      external: true
    }));
  }
};

async function main() {
  /** @type {esbuild.BuildOptions} */
  const buildOptions = {
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './dist/extension.js',
    external: externalModules,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: production ? false : 'linked',
    minify: production,
    treeShaking: true,
    plugins: [
      nativeNodePlugin,
      buildLogPlugin
    ],
    // Helpful for debugging bundle issues
    metafile: true,
    logLevel: 'info',
  };

  if (watch) {
    // Watch mode for development
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    // Single build
    const result = await esbuild.build(buildOptions);
    
    // Log bundle size
    if (result.metafile) {
      const outputs = Object.entries(result.metafile.outputs);
      for (const [file, info] of outputs) {
        if (file.endsWith('.js')) {
          const sizeKB = (info.bytes / 1024).toFixed(1);
          const sizeMB = (info.bytes / 1024 / 1024).toFixed(2);
          console.log(`Bundle size: ${sizeKB} KB (${sizeMB} MB)`);
        }
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
