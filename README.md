# Obfuscator.io Metro Plugin

[![npm version](https://img.shields.io/npm/v/@shahil_m/obfuscator-io-metro-plugin.svg)](https://www.npmjs.com/package/@shahil_m/obfuscator-io-metro-plugin)
[![npm](https://img.shields.io/npm/dt/@shahil_m/obfuscator-io-metro-plugin)](https://www.npmjs.com/package/@shahil_m/obfuscator-io-metro-plugin)
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome!" />


This metro plugin obfuscate your **React Native** bundle using [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator) <br/>
It only obfuscates your code not the code of `node_modules`, you can verify the obfuscated bundle by either extracting the `index.android.bundle` from generated apk
or you can find the file at `project_root\android\app\build\generated\assets\react\release` after `assembleRelease` process

## Installation

```bash
 npm i -D @shahil_m/obfuscator-io-metro-plugin

```

## Docs
[Docs](https://ShahilMangroliya.github.io/obfuscator-io-metro-plugin/)

## Usage

Include the plugin in your `metro.config.js`:

```js
const jsoMetroPlugin = require("@shahil_m/obfuscator-io-metro-plugin")(
  {
    // for these option look javascript-obfuscator library options from  above url
    compact: false,
    sourceMap: false, // source Map generated after obfuscation is not useful right now so use default value i.e. false
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    numbersToExpressions: true,
    simplify: true,
    stringArrayShuffle: true,
    splitStrings: true,
    stringArrayThreshold: 1,
  },
  {
    runInDev: false /* optional */,
    logObfuscatedFiles: true /* optional generated files will be located at ./.jso */,
  }
);

module.exports = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: false,
      },
    }),
  },
  ...jsoMetroPlugin,
};
```

For obfuscation options configuration docs see: [https://github.com/javascript-obfuscator/javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator)
