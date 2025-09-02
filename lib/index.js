const { emptyDir, mkdirp, readFile, writeFile, remove } = require('fs-extra');
const obfuscate = require('./javascriptObfuscatorAPI');
const fs = require('fs');
const path = require('path');
const {
  TEMP_FOLDER,
  DIST_TEMP_FOLDER,
  SRC_TEMP_FOLDER,
  BEG_ANNOTATION,
  END_ANNOTATION,
  EXTS
} = require('./constants');
const {
  buildNormalizePath,
  wrapCodeWithTags,
  getBundlePath,
  skipObfuscation,
  stripTags
} = require('./utils');
const glob = require('glob');
const JavaScriptObfuscator = require('javascript-obfuscator');
const combine = require('combine-source-map');
const convert = require('convert-source-map');

const debug = !!process.env.DEBUG;

async function obfuscateBundle(
  {bundlePath, bundleSourceMapPath},
  fileNames,
  config,
  runConfig
) {
  // Filter out any undefined or invalid filenames
  const validFileNames = fileNames.filter(name => name && typeof name === 'string' && name.trim().length > 0);
  
  if (validFileNames.length === 0) {
    return;
  }
  
  await emptyDir(TEMP_FOLDER);

  const metroBundle = await readFile(bundlePath, 'utf8');
  const metroBundleChunks = metroBundle.split(BEG_ANNOTATION);
  const metroUserFilesOnly = metroBundleChunks
    .filter((c, i) => i > 0)
    .map(c => c.split(END_ANNOTATION)[0]);

  // Process files in smaller batches to reduce memory usage
  const BATCH_SIZE = 10;
  const batches = [];
  for (let i = 0; i < validFileNames.length; i += BATCH_SIZE) {
    batches.push(validFileNames.slice(i, i + BATCH_SIZE));
  }

  // build tmp src folders structure
  await Promise.all(
    validFileNames.map(n =>
      mkdirp(`${SRC_TEMP_FOLDER}/${path.dirname(n)}`)
    )
  );

  // write user files to tmp folder
  await Promise.all(
    metroUserFilesOnly.map((c, i) =>
      writeFile(`${SRC_TEMP_FOLDER}/${validFileNames[i]}`, c)
    )
  );

  // Process each batch separately to reduce memory usage
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    try {
      await obfuscateBatch(batch, config, runConfig);
      
      // Force garbage collection between batches if available
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      throw error;
    }
  }

  // read obfuscated user files
  const obfusctedUserFiles = await Promise.all(metroUserFilesOnly.map((c, i) => {
    const fileName = validFileNames[i];
    if (!fileName) {
      return '';
    }
    return readFile(`${DIST_TEMP_FOLDER}/${fileName}`, 'utf8');
  }));

  // build final bundle (with JSO TAGS still)
  const finalBundle = metroBundleChunks.reduce((acc, c, i) => {
    if (i === 0) {
      return c;
    }

    const obfuscatedCode = obfusctedUserFiles[i - 1];
    const tillCodeEnd = c.substr(
      c.indexOf(END_ANNOTATION),
      c.length
    );
    return acc + BEG_ANNOTATION + obfuscatedCode + tillCodeEnd;
  }, '');

  await writeFile(bundlePath, stripTags(finalBundle));
}

async function obfuscateBatch(batch, config, runConfig) {
  const { filesDest, cwd } = {
    filesDest: DIST_TEMP_FOLDER,
    cwd: SRC_TEMP_FOLDER
  };

  try {
    // Use the batch files directly since they already exist in the temp folder
    const batchFiles = batch;
    
    if (batchFiles.length === 0) {
      return;
    }

    const postData = {};
    postData.Items = await Promise.all(batchFiles.map(async (f) => {
      return {
        FileName: f,
        FileCode: await readFile(`${cwd}/${f}`, 'utf8'),
      };
    }));

    var sourceMaps = combine.create('index.android.bundle.map');
    var offset = { line: 2 };

    // Process each file in the batch
    for (const item of postData.Items) {
      try {
        const obfuscationResult = JavaScriptObfuscator.obfuscate(`${item.FileCode}`, config);
        item.FileCode = obfuscationResult.getObfuscatedCode();
        
        // Add to source maps
        sourceMaps = sourceMaps.addFile({source: `${item.FileCode}`, sourceFile: item.FileName}, offset);
      } catch (error) {
        // Continue with other files instead of exiting
        continue;
      }
    }

    // Write obfuscated files
    await Promise.all(postData.Items.map(async (item) => {
      if (item.FileName && typeof item.FileName === 'string' && item.FileName.trim().length > 0) {
        await mkdirp(`${filesDest}/${path.dirname(item.FileName)}`);
        await writeFile(`${filesDest}/${item.FileName}`, item.FileCode);
      }
    }));

    // Handle source maps if needed
    if (config && config.sourceMap) {
      const generatedSourceMapLocation = runConfig && runConfig.sourceMapLocation ? runConfig.sourceMapLocation : "index.android.bundle.map";
      console.log("generating source map .....");
      const sm = convert.fromBase64(sourceMaps.base64()).toJSON();
      await writeFile(`${generatedSourceMapLocation}`, sm);
      console.log(`generated source map file located at ${generatedSourceMapLocation}`);
    }
  } catch (error) {
    console.error('Error in obfuscateBatch:', error);
    throw error;
  }
}

/**
 * Add serialize.processModuleFilter option to metro and attach listener to beforeExit event.
 * *config.fileSrc* and *config.filesDest* will be ignored.
 * @param {object} _config
 * @param {object} runConfig
 * @param {string} [projectRoot=process.cwd()]
 * @returns {{serializer: {processModuleFilter(*): boolean}}}
 */
module.exports = function (_config = {}, runConfig = {}, projectRoot = process.cwd()) {
  const skipReason = skipObfuscation(runConfig);
  if (skipReason) {
    console.log(`warning:  Obfuscation SKIPPED [${skipReason}]`);
    return {};
  }

  // Validate and normalize projectRoot
  if (!projectRoot || typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    projectRoot = process.cwd();
  }
  
  // Ensure projectRoot is an absolute path
  if (!require('path').isAbsolute(projectRoot)) {
    projectRoot = require('path').resolve(projectRoot);
  }
  
  // The issue is that Metro might be running from a different directory
  // Let's try to find the actual project root by looking for package.json
  const fs = require('fs');
  let actualProjectRoot = projectRoot;
  
  // Walk up the directory tree to find the actual project root
  let currentDir = projectRoot;
  while (currentDir !== '/' && currentDir !== '') {
    if (fs.existsSync(require('path').join(currentDir, 'package.json'))) {
      actualProjectRoot = currentDir;
      break;
    }
    currentDir = require('path').dirname(currentDir);
  }
  
  if (actualProjectRoot !== projectRoot) {
    projectRoot = actualProjectRoot;
  }

  const config = _config;
  let bundlePath;
  try {
    bundlePath = getBundlePath();
  } catch (error) {
    console.warn('Could not determine bundle path from CLI arguments, using default');
    bundlePath = {
      bundlePath: 'android/app/src/main/assets/index.android.bundle',
      bundleSourceMapPath: null
    };
  }
  const fileNames = new Set();

  process.on('beforeExit', async function (exitCode) {
    try{
      if (fileNames.size === 0) {
        console.log('info: No files to obfuscate, skipping obfuscation');
        return;
      }
      console.log('info: Obfuscating Code');
      // start obfuscation
      await obfuscateBundle(bundlePath, Array.from(fileNames), config, runConfig);
      if(!runConfig || !runConfig.logObfuscatedFiles){
        await remove(TEMP_FOLDER); // clear temp folder 
      }
    } catch(err) {
      console.error(err);
      process.exit(1);
    } finally {
      process.exit(exitCode)
    }
  });

  return {
    serializer: {
      /**
       * Select user files ONLY (no vendor) to be obfuscated. That code should be tagged with
       * {@BEG_ANNOTATION} and {@END_ANNOTATION}.
       * @param {{output: Array<*>, path: string, getSource: function():Buffer}} _module
       * @returns {boolean}
       */
      processModuleFilter(_module) {
        if (
          _module.path.indexOf('node_modules') !== -1 ||
          typeof _module.path !== 'string' ||
          !fs.existsSync(_module.path) ||
          !path.extname(_module.path).match(EXTS)
        ) {
          return true;
        }

        const normalizePath = buildNormalizePath(_module.path, projectRoot);
        if (normalizePath) {
          fileNames.add(normalizePath);
          _module.output.forEach(({data}) => {
            wrapCodeWithTags(data);
          });
        }
        return true;
      }
    }
  };
};
