// Settings for web-ext, so lint, run, build and sign leave out the same files that are not part of the add-on.
export default {
  ignoreFiles: ['test/**', 'node_modules/**', 'package.json', 'package-lock.json', 'README.md', 'amo-metadata.json', 'web-ext-config.mjs'],
  build: { overwriteDest: true },
  sign: { channel: 'listed', amoMetadata: 'amo-metadata.json' },
};
