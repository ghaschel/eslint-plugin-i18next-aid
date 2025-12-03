// Delete the file from the require cache.
// This forces the file to be read from disk again.
// e.g) webpack dev server eslint loader support

const path = require("path");

/**
 * Requires a file without caching, resolving relative paths from a base directory.
 * @param {string} filePath - The path to require (can be relative or absolute)
 * @param {string} [basePath] - The base directory to resolve relative paths from (defaults to process.cwd())
 * @returns {any} The required module
 */
const requireNoCache = (filePath, basePath = process.cwd()) => {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(basePath, filePath);

  delete require.cache[require.resolve(resolvedPath)];
  return require(resolvedPath);
};

module.exports = requireNoCache;
