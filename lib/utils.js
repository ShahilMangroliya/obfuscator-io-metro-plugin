const readline = require('readline');
const {Command} = require('commander');
const {Readable} = require('stream');
const {
  EXTS,
  END_ANNOTATION,
  BEG_ANNOTATION,
  BUNDLE_OUTPUT_CLI_ARG,
  BUNDLE_SOURCEMAP_OUTPUT_CLI_ARG,
  BUNDLE_DEV_CLI_ARG,
  BUNDLE_CMD
} = require('./constants');

/**
 * Only 'bundle' command triggers obfuscation.
 * Development bundles will be ignored (--dev true). Use JSO_METRO_DEV to override this behaviour.
 * @returns {string} skip reason. If falsy value dont skip obfuscation
 */
function skipObfuscation({ runInDev }) {
  let isBundleCmd = false;
  const command = new Command();
  command
    .command(BUNDLE_CMD)
    .allowUnknownOption()
    .action(() => (isBundleCmd = true));
  command.option(`${BUNDLE_DEV_CLI_ARG} <boolean>`).parse(process.argv);
  if (!isBundleCmd) {
    return 'Not a *bundle* command';
  }
  if (command.dev === 'true') {
    return (
      !runInDev &&
      'Development mode. Override with JSO_METRO_DEV=true environment variable'
    );
  }
  return null;
}

/**
 * Get bundle path based CLI arguments
 * @returns {{bundlePath: string, bundleSourceMapPath: string}}
 * @throws {Error} when bundle output was not found
 */
function getBundlePath() {
  const command = new Command();
  command
    .option(`${BUNDLE_OUTPUT_CLI_ARG} <string>`)
    .option(`${BUNDLE_SOURCEMAP_OUTPUT_CLI_ARG} <string>`)
    .parse(process.argv);
  if (command.bundleOutput) {
    return {
      bundlePath: command.bundleOutput,
      bundleSourceMapPath: command.sourcemapOutput
    };
  }
  console.error('Bundle output path not found.');
  throw new Error('Bundle output path not found. Please provide --bundle-output argument.');
}

/**
 * Strip all  tags from code
 * @param {string} code
 * @returns {string}
 */
function stripTags(code) {
  return code.replace(new RegExp(BEG_ANNOTATION, 'g'), '')
    .replace(new RegExp(END_ANNOTATION, 'g'), '')
}

/**
 * When next character is a new line (\n or \r\n),
 * we should increment startIndex to avoid user code starting with a new line.
 * @param {string} startIndex
 * @param {string} code
 * @returns {number}
 * @example
 *    __d(function(g,r,i,a,m,e,d){(detect new line here and start below)
 *      // user code
 *      ...
 *    }
 */
function shiftStartIndexOnNewLine(startIndex, code) {
  switch (code[startIndex + 1]) {
    case '\r':
      startIndex++;
      return shiftStartIndexOnNewLine(startIndex, code);
    case '\n':
      startIndex++;
      break;
  }
  return startIndex;
}

/**
 * Wrap user code with  TAGS {BEG_ANNOTATION and END_ANNOTATION}
 * @param {{code: string}} data
 */
function wrapCodeWithTags(data) {
  // Check if annotations are already present to avoid duplicates
  if (data.code.includes(BEG_ANNOTATION) && data.code.includes(END_ANNOTATION)) {
    return; // Skip if annotations are already present
  }
  
  let startIndex = data.code.indexOf('{');
  const endIndex = data.code.lastIndexOf('}');
  startIndex = shiftStartIndexOnNewLine(startIndex, data.code);
  const init = data.code.substring(0, startIndex + 1);
  const clientCode = data.code.substring(startIndex + 1, endIndex);
  const end = data.code.substr(endIndex, data.code.length);
  data.code = init + BEG_ANNOTATION + clientCode + END_ANNOTATION + end;
}

/**
 * @param {string} path
 * @param {string} projectRoot
 * @returns {string} undefined if path is empty or invalid
 *
 * @example
 *    <project_root>/react-native0.59-grocery-list/App/index.js -> App/index.js
 *    <project_root>/react-native0.59-grocery-list/App/index.ts -> App/index.js
 */
function buildNormalizePath(path, projectRoot) {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return;
  }
  
  if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    return;
  }
  
  try {
    // Ensure projectRoot ends with path separator for consistent behavior
    const normalizedProjectRoot = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
    
    // Instead of using path.relative, manually remove the project root prefix
    let relativePath;
    if (path.startsWith(normalizedProjectRoot)) {
      relativePath = path.substring(normalizedProjectRoot.length);
    } else if (path.startsWith(projectRoot)) {
      relativePath = path.substring(projectRoot.length);
    } else {
      // If the path doesn't start with project root, try to find the src directory
      const srcIndex = path.indexOf('/src/');
      if (srcIndex !== -1) {
        relativePath = path.substring(srcIndex + 1); // +1 to remove the leading '/'
      } else {
        return;
      }
    }
    
    if (relativePath === '') {
      return;
    }
    
    // Check if the relative path contains problematic parent directory references
    // Only reject if it starts with .. or contains /../
    if (relativePath.startsWith('..') || relativePath.includes('/../') || relativePath.includes('\\..\\')) {
      return;
    }
    
    // Replace file extensions and remove leading slash if present
    const normalizedPath = relativePath.replace(EXTS, '.js');
    const result = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
    return result;
  } catch (error) {
    return;
  }
}

module.exports = {
  skipObfuscation,
  getBundlePath,
  stripTags,
  wrapCodeWithTags,
  buildNormalizePath
}
