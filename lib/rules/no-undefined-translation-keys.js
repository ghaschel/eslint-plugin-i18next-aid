/**
 * @fileoverview Disallows use of translation keys which have no definition
 * @author Kevin Dice
 * @author Guilherme Haschel
 */
"use strict";

const path = require("path");
const requireNoCache = require("../requireNoCache");

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
    const namespaceTranslationMappingFile = requireNoCache(mappingFilePath);

    // Get the directory of the mapping file to resolve translation file paths relative to it
    const resolvedMappingPath = path.isAbsolute(mappingFilePath)
      ? mappingFilePath
      : path.resolve(process.cwd(), mappingFilePath);
    const mappingFileDir = path.dirname(resolvedMappingPath);

    // Load translation files, resolving paths relative to the mapping file's directory
    const translationKeysFromFiles = Object.keys(
      namespaceTranslationMappingFile
    ).reduce(
      (acc, namespace) => ({
        ...acc,
        [namespace]: requireNoCache(
          namespaceTranslationMappingFile[namespace],
          mappingFileDir
        ),
      }),
      {}
    );

    const defaultNamespace = options?.defaultNamespace || "default";

    //----------------------------------------------------------------------
    // Helpers
    //----------------------------------------------------------------------

    function getTranslationKey(namespace, key) {
      let obj = translationKeysFromFiles[namespace];
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

    //----------------------------------------------------------------------
    // Public
    //----------------------------------------------------------------------

    /**
     * Finds the variable name that the t function was assigned to
     * and looks up how it was initialized (useTranslation or getTranslations)
     */
    function findTranslationFunctionInfo(node, ancestors) {
      const calleeName = node.callee.name;
      let prefix = null;
      let namespace = null;

      ancestors?.forEach((ancestor) => {
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
                    (p) => p.key?.name === "keyPrefix"
                  )?.value?.value;
                  namespace = declaration.init?.arguments[0]?.value;
                }

                // Handle: const t = await getTranslations("namespace")
                // The init is an AwaitExpression wrapping the CallExpression
                if (
                  declaration.init?.type === "AwaitExpression" &&
                  declaration.init?.argument?.callee?.name === "getTranslations"
                ) {
                  const getTranslationsCall = declaration.init.argument;
                  // First argument is the namespace/prefix
                  prefix = getTranslationsCall.arguments?.[0]?.value;
                }

                // Handle: const t = getTranslations("namespace") (without await, for sync versions)
                if (declaration.init?.callee?.name === "getTranslations") {
                  prefix = declaration.init?.arguments?.[0]?.value;
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
                // Handle destructuring: const { t } = useTranslation(...)
                if (declaration.id?.type === "ObjectPattern") {
                  const hasMatchingProperty = declaration.id.properties?.some(
                    (prop) =>
                      (prop.value?.name || prop.key?.name) === calleeName
                  );
                  if (
                    hasMatchingProperty &&
                    declaration.init?.callee?.name === "useTranslation"
                  ) {
                    prefix = declaration.init?.arguments[1]?.properties?.find(
                      (p) => p.key?.name === "keyPrefix"
                    )?.value?.value;
                    namespace = declaration.init?.arguments[0]?.value;
                  }
                }
              });
            }
          });
        }
      });

      return { prefix, namespace };
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
        let { prefix, namespace } = findTranslationFunctionInfo(
          node,
          ancestors
        );

        const key = prefix
          ? [prefix, node.arguments?.[0]?.value].join(".")
          : node.arguments?.[0]?.value;
        const keyWithoutNamespace =
          key.indexOf(":") === -1 ? key : key.slice(key.indexOf(":") + 1);
        namespace =
          key === keyWithoutNamespace
            ? namespace ?? defaultNamespace
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
