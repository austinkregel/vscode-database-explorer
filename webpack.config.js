//@ts-check

'use strict';

const path = require('path');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // modules added here also need to be added in the .vscodeignore file
    
    // Native modules that can't be bundled by webpack
    'ssh2': 'commonjs ssh2',
    'cpu-features': 'commonjs cpu-features',
    
    // MongoDB optional native dependencies
    'kerberos': 'commonjs kerberos',
    'snappy': 'commonjs snappy',
    '@mongodb-js/zstd': 'commonjs @mongodb-js/zstd',
    'mongodb-client-encryption': 'commonjs mongodb-client-encryption',
    '@napi-rs/snappy-linux-x64-gnu': 'commonjs @napi-rs/snappy-linux-x64-gnu',
    'gcp-metadata': 'commonjs gcp-metadata',
    'socks': 'commonjs socks',
    'aws4': 'commonjs aws4',
    '@aws-sdk/credential-providers': 'commonjs @aws-sdk/credential-providers',
    
    // PostgreSQL native bindings (optional)
    'pg-native': 'commonjs pg-native'
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ],
    // Don't parse native .node files
    noParse: /\.node$/
  },
  // Ignore warnings for optional dependencies
  ignoreWarnings: [
    { module: /node_modules\/mongodb/ },
    { module: /node_modules\/kerberos/ },
    { module: /node_modules\/snappy/ },
    { module: /node_modules\/@mongodb-js/ },
    { module: /node_modules\/mongodb-client-encryption/ }
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};
module.exports = [ extensionConfig ];