/**
 * @fileoverview Disallows use of translation keys which have no definition
 * @author Kevin Dice
 * @author Guilherme Haschel
 */
"use strict";

const fs = require("fs");
const path = require("path");

//------------------------------------------------------------------------------
// Translation file loading
//------------------------------------------------------------------------------

/**
 * ESLint calls `create()` once per linted file. Loading the mapping file and
 * every translation file on each call is both slow (a large en.json re-parsed
 * once per file) and, when done with `require()`, a memory leak: deleting the
 * `require.cache` entry does not detach the module, because Node keeps
 * appending each freshly-required Module to the parent's `module.children`.
 * Nothing is ever reclaimable, so heap use grows linearly with the number of
 * linted files — roughly 0.4 MB per file for a 320 KB en.json, which is enough
 * to exhaust Node's default ~4 GB heap on a few thousand files.
 *
 * Instead, cache parsed contents at module scope keyed by resolved path, and
 * invalidate on mtime. That preserves the original reason for bypassing the
 * require cache — long-lived processes such as a webpack dev server must pick
 * up edits to translation files without a restart — while parsing each file at
 * most once per edit.
 *
 * @type {Map<string, { mtimeMs: number | null, value: any }>}
 */
const fileCache = new Map();

/**
 * Loads and caches a mapping or translation file.
 *
 * @param {string} filePath - The path to load (absolute, or relative to basePath)
 * @param {string} [basePath] - Base directory for relative paths (defaults to process.cwd())
 * @returns {any} The parsed file contents
 */
function loadFile(filePath, basePath = process.cwd()) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(basePath, filePath);

  let mtimeMs = null;
  try {
    mtimeMs = fs.statSync(resolvedPath).mtimeMs;
  } catch {
    // Leave mtimeMs null and let the load below throw a meaningful error.
  }

  const cached = fileCache.get(resolvedPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value;
  }

  let value;
  if (path.extname(resolvedPath) === ".json") {
    value = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } else {
    // Non-JSON mapping/translation modules (e.g. a .js file exporting an
    // object) stay supported via require(). Truncate module.children back to
    // its previous length afterwards so repeated loads cannot pin every parsed
    // copy in memory — the leak described above.
    delete require.cache[require.resolve(resolvedPath)];
    const childCountBefore = module.children.length;
    value = require(resolvedPath);
    if (module.children.length > childCountBefore) {
      module.children.length = childCountBefore;
    }
  }

  fileCache.set(resolvedPath, { mtimeMs, value });
  return value;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const possiblePluralSuffixes = [
  "zero",
  "singular",
  "one",
  "two",
  "few",
  "many",
  "other",
];

/**
 * @type {import('eslint').Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallows use of translation keys which have no definition",
      category: "internationalization",
      recommended: false,
      url: "https://github.com/ghaschel/eslint-plugin-i18next-aid/blob/master/README.md",
    },
    fixable: null, // Or `code` or `whitespace`
    schema: [
      {
        type: "object",
        properties: {
          namespaceTranslationMappingFile: {
            type: "string",
          },
          defaultNamespace: {
            type: "string",
            default: "default",
          },
        },
        required: ["namespaceTranslationMappingFile"],
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0];

    // Resolve the mapping file path relative to cwd (project root)
    const mappingFilePath = options?.namespaceTranslationMappingFile;
    const namespaceTranslationMappingFile = loadFile(mappingFilePath);

    // Get the directory of the mapping file to resolve translation file paths relative to it
    const resolvedMappingPath = path.isAbsolute(mappingFilePath)
      ? mappingFilePath
      : path.resolve(process.cwd(), mappingFilePath);
    const mappingFileDir = path.dirname(resolvedMappingPath);

    // Load translation files, resolving paths relative to the mapping file's directory
    const translationKeysFromFiles = {};
    for (const namespace of Object.keys(namespaceTranslationMappingFile)) {
      translationKeysFromFiles[namespace] = loadFile(
        namespaceTranslationMappingFile[namespace],
        mappingFileDir,
      );
    }

    const defaultNamespace = options?.defaultNamespace || "default";

    //----------------------------------------------------------------------
    // Helpers
    //----------------------------------------------------------------------

    function lookupKey(obj, key) {
      const arr = key.split(".");
      while (arr.length) {
        const keyToAccess = arr.shift();
        const prevObj = obj;
        obj = obj?.[keyToAccess];

        /* If we're at the last key segment and appear to have a miss,
         * let's try the plural suffixes */
        if (!arr.length && !obj && keyToAccess) {
          for (let i = 0; i < possiblePluralSuffixes.length; i++) {
            obj = prevObj?.[`${keyToAccess}_${possiblePluralSuffixes[i]}`];
            if (obj) {
              break;
            }
          }
        }
      }
      return obj;
    }

    function getTranslationKey(namespace, key) {
      let obj = translationKeysFromFiles[namespace];

      // If the namespace exists, look up the key directly
      if (obj !== undefined) {
        return lookupKey(obj, key);
      }

      // Fallback: if namespace doesn't exist in mapping, treat it as a prefix
      // under the default namespace. This supports react-i18next usage where
      // useTranslation("login") is used with a single translation file that
      // has nested keys like { "login": { "signInSubtitle": "..." } }
      if (namespace !== defaultNamespace) {
        obj = translationKeysFromFiles[defaultNamespace];
        if (obj !== undefined) {
          return lookupKey(obj, `${namespace}.${key}`);
        }
      }

      return undefined;
    }

    //----------------------------------------------------------------------
    // Public
    //----------------------------------------------------------------------

    /**
     * Finds the variable name that the t function was assigned to
     * and looks up how it was initialized (useTranslation, useTranslations, or getTranslations)
     */
    function findTranslationFunctionInfo(node, ancestors) {
      const calleeName = node.callee.name;
      let prefix = null;
      let namespace = null;
      let isParameter = false;

      ancestors?.forEach((ancestor) => {
        // Detect if calleeName is a parameter of an enclosing function —
        // if so, we cannot know the namespace statically.
        if (
          ancestor.type === "FunctionDeclaration" ||
          ancestor.type === "FunctionExpression" ||
          ancestor.type === "ArrowFunctionExpression"
        ) {
          ancestor.params?.forEach((param) => {
            // Plain parameter: function helper(t) {}
            if (param.type === "Identifier" && param.name === calleeName) {
              isParameter = true;
            }
            // Parameter with default value: function helper(t = null) {}
            if (
              param.type === "AssignmentPattern" &&
              param.left?.type === "Identifier" &&
              param.left.name === calleeName
            ) {
              isParameter = true;
            }
          });
        }

        // Check in block body statements
        if (ancestor.body?.length > 0) {
          ancestor.body.forEach((body) => {
            if (body.declarations?.length > 0) {
              body.declarations.forEach((declaration) => {
                // Check if this declaration matches our callee name
                if (declaration.id?.name !== calleeName) {
                  return;
                }

                // Handle: const { t } = useTranslation(...)
                if (declaration.init?.callee?.name === "useTranslation") {
                  prefix = declaration.init?.arguments[1]?.properties?.find(
                    (p) => p.key?.name === "keyPrefix",
                  )?.value?.value;
                  namespace = declaration.init?.arguments[0]?.value;
                }

                // Handle: const t = await getTranslations("namespace")
                if (
                  declaration.init?.type === "AwaitExpression" &&
                  declaration.init?.argument?.callee?.name === "getTranslations"
                ) {
                  const getTranslationsCall = declaration.init.argument;
                  const arg = getTranslationsCall.arguments?.[0]?.value;
                  if (arg !== undefined && translationKeysFromFiles[arg] !== undefined) {
                    namespace = arg;
                    prefix = null;
                  } else {
                    prefix = arg;
                  }
                }

                // Handle: const t = getTranslations("namespace") (without await)
                if (declaration.init?.callee?.name === "getTranslations") {
                  const arg = declaration.init?.arguments?.[0]?.value;
                  if (arg !== undefined && translationKeysFromFiles[arg] !== undefined) {
                    namespace = arg;
                    prefix = null;
                  } else {
                    prefix = arg;
                  }
                }

                // Handle: const t = useTranslations("namespace") (next-intl client hook)
                if (declaration.init?.callee?.name === "useTranslations") {
                  const arg = declaration.init?.arguments?.[0]?.value;
                  if (arg !== undefined && translationKeysFromFiles[arg] !== undefined) {
                    namespace = arg;
                    prefix = null;
                  } else {
                    prefix = arg;
                  }
                }
              });
            }
          });
        }

        // Also check for destructuring patterns like: const { t } = useTranslation(...)
        if (ancestor.body?.length > 0) {
          ancestor.body.forEach((body) => {
            if (body.declarations?.length > 0) {
              body.declarations.forEach((declaration) => {
                if (declaration.id?.type === "ObjectPattern") {
                  const hasMatchingProperty = declaration.id.properties?.some(
                    (prop) =>
                      (prop.value?.name || prop.key?.name) === calleeName,
                  );
                  if (
                    hasMatchingProperty &&
                    declaration.init?.callee?.name === "useTranslation"
                  ) {
                    prefix = declaration.init?.arguments[1]?.properties?.find(
                      (p) => p.key?.name === "keyPrefix",
                    )?.value?.value;
                    namespace = declaration.init?.arguments[0]?.value;
                  }
                }
              });
            }
          });
        }
      });

      return { prefix, namespace, isParameter };
    }

    return {
      CallExpression(node) {
        // Check if it's a function call (not a method call like obj.t())
        if (node.callee.type !== "Identifier") {
          return;
        }

        const calleeName = node.callee.name;

        // Skip if not a potential translation function
        // Common names: t, translate, etc.
        if (calleeName !== "t" && calleeName !== "translate") {
          return;
        }

        if (node.arguments?.[0]?.type !== "Literal") {
          // The translation-key-string-literal rule handles this case
          // If it's not a literal, we can't proceed.
          return;
        }

        // Support both ESLint 8 (context.getAncestors) and ESLint 9+ (context.sourceCode.getAncestors)
        const ancestors = context.getAncestors
          ? context.getAncestors()
          : context.sourceCode.getAncestors(node);
        let { prefix, namespace, isParameter } = findTranslationFunctionInfo(
          node,
          ancestors,
        );

        // When t is a function parameter we cannot statically determine the namespace.
        // Any prefix/namespace found came from an ancestor scope leak (Mode 2 bug),
        // not from the actual hook that created t — skip entirely.
        if (isParameter) {
          return;
        }

        const key = prefix
          ? [prefix, node.arguments?.[0]?.value].join(".")
          : node.arguments?.[0]?.value;
        const keyWithoutNamespace =
          key.indexOf(":") === -1 ? key : key.slice(key.indexOf(":") + 1);
        namespace =
          key === keyWithoutNamespace
            ? (namespace ?? defaultNamespace)
            : key.slice(0, key.indexOf(":"));

        if (getTranslationKey(namespace, keyWithoutNamespace) === undefined) {
          context.report({
            node: node,
            message: `Translation key "${keyWithoutNamespace}" in namespace "${namespace}" is used here but missing in the translations file.`,
          });
        }
      },
    };
  },
};
