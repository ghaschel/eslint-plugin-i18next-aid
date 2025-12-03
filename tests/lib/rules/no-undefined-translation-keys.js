/**
 * @fileoverview Disallows use of translation keys which have no definition
 * @author Kevin Dice
 * @author Guilherme Haschel
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require("../../../lib/rules/no-undefined-translation-keys"),
  RuleTester = require("eslint").RuleTester;
const path = require("path");

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2020,
  },
});

const options = [
  {
    namespaceTranslationMappingFile: path.resolve(
      __dirname,
      "../../namespaceMapping.json"
    ),
    defaultNamespace: "default",
  },
];

ruleTester.run("no-undefined-translation-keys", rule, {
  valid: [
    // Basic translation keys
    {
      code: "t('pizza')",
      options,
    },
    {
      code: "t('records.contracts')",
      options,
    },
    {
      code: "t('distance.milesAway')",
      options,
    },
    // Nested keys with dot notation
    {
      code: "t('common.appName')",
      options,
    },
    // getTranslations with await - valid key
    {
      code: `
        async function test() {
          const t = await getTranslations("common");
          return t("appName");
        }
      `,
      options,
    },
    // getTranslations with await - another valid key
    {
      code: `
        async function test() {
          const t = await getTranslations("common");
          return t("welcome");
        }
      `,
      options,
    },
    // getTranslations with errors namespace
    {
      code: `
        async function test() {
          const t = await getTranslations("errors");
          return t("notFound");
        }
      `,
      options,
    },
    // getTranslations without await (sync version)
    {
      code: `
        function test() {
          const t = getTranslations("common");
          return t("appName");
        }
      `,
      options,
    },
    // useTranslation hook with keyPrefix
    {
      code: `
        function Component() {
          const t = useTranslation("default", { keyPrefix: "common" });
          return t("appName");
        }
      `,
      options,
    },
  ],

  invalid: [
    // Missing key - basic
    {
      code: "t('thisOneIsMissing')",
      options,
      errors: [
        {
          message:
            'Translation key "thisOneIsMissing" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },
    // getTranslations with missing key
    {
      code: `
        async function test() {
          const t = await getTranslations("common");
          return t("missingKey");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "common.missingKey" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },
    // getTranslations with wrong namespace prefix
    {
      code: `
        async function test() {
          const t = await getTranslations("wrong");
          return t("appName");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "wrong.appName" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },
    // Sync getTranslations with missing key
    {
      code: `
        function test() {
          const t = getTranslations("errors");
          return t("serverError");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "errors.serverError" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },
  ],
});
