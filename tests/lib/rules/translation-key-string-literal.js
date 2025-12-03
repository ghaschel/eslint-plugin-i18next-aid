/**
 * @fileoverview Disallows translation keys that aren't string literals
 * @author Kevin Dice
 * @author Guilherme Haschel
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require("../../../lib/rules/translation-key-string-literal"),
  RuleTester = require("eslint").RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2020,
  },
});

const allowTHasOption = ["allow-t-has-protected-conditionals"];

ruleTester.run("translation-key-string-literal", rule, {
  valid: [
    //------------------------------------------------------------------
    // String literal keys (always valid)
    //------------------------------------------------------------------
    {
      code: "t('hello')",
    },
    {
      code: "t('common.hello')",
    },

    //------------------------------------------------------------------
    // t.has() guard pattern (only valid with option enabled)
    //------------------------------------------------------------------
    // Single line
    {
      code: "const label = t.has(item.labelKey) ? t(item.labelKey) : item.labelKey;",
      options: allowTHasOption,
    },
    // Multi-line
    {
      code: `const label = t.has(item.labelKey)
        ? t(item.labelKey)
        : item.labelKey;`,
      options: allowTHasOption,
    },
    // With extra whitespace
    {
      code: `const label = t.has(  item.labelKey  )
        ? t(  item.labelKey  )
        : item.labelKey;`,
      options: allowTHasOption,
    },
    // Nested property access
    {
      code: "const label = t.has(data.items[0].key) ? t(data.items[0].key) : fallback;",
      options: allowTHasOption,
    },
    // Simple variable
    {
      code: "const label = t.has(key) ? t(key) : key;",
      options: allowTHasOption,
    },
    // With line breaks in arguments
    {
      code: `const label = t.has(
        item.labelKey
      ) ? t(
        item.labelKey
      ) : item.labelKey;`,
      options: allowTHasOption,
    },
  ],

  invalid: [
    //------------------------------------------------------------------
    // Variable/dynamic keys (always invalid)
    //------------------------------------------------------------------
    {
      code: "t(someVariable)",
      errors: [{ message: "Translation keys must be string literals" }],
    },
    {
      code: "t(item.labelKey)",
      errors: [{ message: "Translation keys must be string literals" }],
    },
    // Template literal
    {
      code: "t(`hello.${world}`)",
      errors: [{ message: "Translation keys must be string literals" }],
    },
    // Function call
    {
      code: "t(getKey())",
      errors: [{ message: "Translation keys must be string literals" }],
    },

    //------------------------------------------------------------------
    // t.has() guard WITHOUT the option enabled (should error)
    //------------------------------------------------------------------
    {
      code: "const label = t.has(item.labelKey) ? t(item.labelKey) : item.labelKey;",
      errors: [{ message: "Translation keys must be string literals" }],
    },

    //------------------------------------------------------------------
    // t.has() guard WITH option but mismatched keys (should error)
    //------------------------------------------------------------------
    {
      code: "const label = t.has(item.labelKey) ? t(item.otherKey) : fallback;",
      options: allowTHasOption,
      errors: [{ message: "Translation keys must be string literals" }],
    },
    {
      code: "const label = t.has(keyA) ? t(keyB) : fallback;",
      options: allowTHasOption,
      errors: [{ message: "Translation keys must be string literals" }],
    },
  ],
});
