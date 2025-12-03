/**
 * @fileoverview Disallows translation keys that aren't string literals
 * @author Kevin Dice
 * @author Guilherme Haschel
 */
"use strict";

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/**
 * @type {import('eslint').Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: "suggestion", // `problem`, `suggestion`, or `layout`
    docs: {
      description: "Disallows translation keys that aren't string literals",
      category: "internationalization",
      recommended: false,
      url: "https://github.com/ghaschel/eslint-plugin-i18next-aid/blob/master/README.md",
    },
    fixable: null, // Or `code` or `whitespace`
    schema: [
      {
        enum: ["allow-t-has-protected-conditionals"],
      },
    ],
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const allowTHasProtectedConditionals =
      context.options[0] === "allow-t-has-protected-conditionals";

    //----------------------------------------------------------------------
    // Helpers
    //----------------------------------------------------------------------

    /**
     * Gets the source code text of a node, normalized (whitespace collapsed)
     */
    function getNormalizedSource(node) {
      return sourceCode.getText(node).replace(/\s+/g, " ").trim();
    }

    /**
     * Checks if a node is a t.has() call
     */
    function isTHasCall(node) {
      return (
        node?.type === "CallExpression" &&
        node.callee?.type === "MemberExpression" &&
        node.callee.object?.name === "t" &&
        node.callee.property?.name === "has"
      );
    }

    /**
     * Checks if the t() call is guarded by t.has() with the same key
     * Pattern: t.has(key) ? t(key) : fallback
     */
    function isGuardedByTHas(node, ancestors) {
      // Look for a ConditionalExpression parent
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];

        if (ancestor.type === "ConditionalExpression") {
          // Check if the test is t.has() and the consequent contains our t() call
          if (isTHasCall(ancestor.test)) {
            const tHasArg = ancestor.test.arguments?.[0];
            const tArg = node.arguments?.[0];

            if (tHasArg && tArg) {
              // Compare the normalized source of both arguments
              const tHasArgSource = getNormalizedSource(tHasArg);
              const tArgSource = getNormalizedSource(tArg);

              if (tHasArgSource === tArgSource) {
                return true;
              }
            }
          }
        }
      }

      return false;
    }

    //----------------------------------------------------------------------
    // Public
    //----------------------------------------------------------------------

    return {
      CallExpression(node) {
        if (node.callee.name === "t") {
          if (node.arguments?.[0]?.type !== "Literal") {
            // Check for t.has() guard only if the option is enabled
            if (allowTHasProtectedConditionals) {
              // Support both ESLint 8 and ESLint 9+
              const ancestors = context.getAncestors
                ? context.getAncestors()
                : sourceCode.getAncestors(node);

              // Allow if guarded by t.has() with the same key
              if (isGuardedByTHas(node, ancestors)) {
                return;
              }
            }

            context.report({
              node: node,
              message: "Translation keys must be string literals",
            });
          }
        }
      },
    };
  },
};
