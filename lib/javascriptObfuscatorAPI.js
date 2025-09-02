const glob = require('glob');
const { mkdirp, readFile, writeFile } = require('fs-extra');
const path = require('path');
var JavaScriptObfuscator = require('javascript-obfuscator');
var convert = require('convert-source-map');
var combine = require('combine-source-map');
var generatedSourceMapLocation = "index.android.bundle.map";

module.exports = async function({ config, filesSrc, filesDest, cwd, runConfig }) {
  console.log({ config, filesSrc, filesDest, cwd });
  
  try {
    // Use glob v10+ promise-based API with proper options
    let files = await glob(filesSrc, { 
      cwd,
      absolute: false,
      ignore: ['**/node_modules/**', '**/.git/**']
    });
    
    console.log('Glob result:', files);
    console.log('Glob result type:', typeof files);
    console.log('Glob result is array:', Array.isArray(files));
    
    // Ensure files is an array
    if (!Array.isArray(files)) {
      console.warn('Glob did not return an array, converting to array');
      files = files ? [files] : [];
    }
    
    // Filter out any undefined or invalid filenames
    const validFiles = files.filter(f => f && typeof f === 'string' && f.trim().length > 0);
    
    console.log('Valid files count:', validFiles.length);
    console.log('Sample valid files:', validFiles.slice(0, 5));
    
    if (validFiles.length === 0) {
      console.warn('No valid files found to obfuscate');
      return;
    }
    
    if (validFiles.length !== files.length) {
      console.warn(`Filtered out ${files.length - validFiles.length} invalid filenames`);
    }

    const postData = {};
    postData.Items = await Promise.all(validFiles.map(async (f) => {
      return {
        FileName: f,
        FileCode: await readFile(`${cwd}/${f}`, 'utf8'),
      };
    }));
  
    var sourceMaps = combine.create('index.android.bundle.map');
    var offset = { line: 2 };

    // Process each file individually to handle errors gracefully
    for (const item of postData.Items) {
      try {
        sourceMaps = sourceMaps.addFile({source:`${item.FileCode}`,sourceFile:item.FileName},offset);
        const obfuscationResult = JavaScriptObfuscator.obfuscate(`${item.FileCode}`, config);
        item.FileCode= obfuscationResult.getObfuscatedCode();
        // item.SourceMap = obfuscationResult.getSourceMap();
      }
      catch(error){
        console.log("Error while obfuscating, Error : ",error);
        // Continue with other files instead of exiting
        continue;
      }
    }

    sourceMaps  = sourceMaps.base64();
    var sm = convert.fromBase64(sourceMaps).toJSON();
    
    await Promise.all(postData.Items.map(async (item) => {
      if (item.FileName && typeof item.FileName === 'string' && item.FileName.trim().length > 0) {
        await mkdirp(`${filesDest}/${path.dirname(item.FileName)}`);
        await writeFile(`${filesDest}/${item.FileName}`, item.FileCode);
      } else {
        console.warn('Skipping item with invalid filename:', item.FileName);
      }
    }));
    
    if(config && config.sourceMap){
      generatedSourceMapLocation = runConfig && runConfig.sourceMapLocation ? runConfig.sourceMapLocation : generatedSourceMapLocation;
      console.log("generating source map .....");
      await writeFile(`${generatedSourceMapLocation}`, sm); // generated source map of unobfuscated code 
      console.log(`generated source map file located at ${generatedSourceMapLocation}`);
    }
  } catch (error) {
    console.error('Error in obfuscation process:', error);
    throw error;
  }
};
