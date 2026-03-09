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

// Using relative path from the tests directory (demonstrates relative path support)
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
    //------------------------------------------------------------------
    // Basic translation keys (direct t() calls)
    //------------------------------------------------------------------
    {
      code: "t('pizza')",
      options,
    },
    {
      code: "t('records.contracts')",
      options,
    },
    // Plural key support (matches milesAway_one / milesAway_other)
    {
      code: "t('distance.milesAway')",
      options,
    },
    // Nested keys with dot notation
    {
      code: "t('common.appName')",
      options,
    },

    //------------------------------------------------------------------
    // react-i18next: useTranslation hook
    //------------------------------------------------------------------
    // useTranslation with keyPrefix option
    {
      code: `
        function Component() {
          const t = useTranslation("default", { keyPrefix: "common" });
          return t("appName");
        }
      `,
      options,
    },
    // useTranslation with destructuring
    {
      code: `
        function Component() {
          const { t } = useTranslation("default", { keyPrefix: "errors" });
          return t("notFound");
        }
      `,
      options,
    },
    // useTranslation with namespace that doesn't exist in mapping but exists as prefix
    // This is the react-i18next pattern with fallback to default namespace
    {
      code: `
        function Component() {
          const { t } = useTranslation("login");
          return t("signInSubtitle");
        }
      `,
      options,
    },
    // useTranslation with namespace fallback (direct assignment)
    {
      code: `
        function Component() {
          const t = useTranslation("login");
          return t("forgotPassword");
        }
      `,
      options,
    },
    // useTranslation with namespace fallback - arrow function component
    {
      code: `
        const Component = () => {
          const { t } = useTranslation("login");
          return t("signInSubtitle");
        };
      `,
      options,
    },
    // useTranslation with namespace fallback - multiple t() calls
    {
      code: `
        function Component() {
          const { t } = useTranslation("login");
          return (
            t("signInSubtitle") + t("forgotPassword")
          );
        }
      `,
      options,
    },

    //------------------------------------------------------------------
    // next-intl: getTranslations (server components)
    //------------------------------------------------------------------
    // getTranslations with await
    {
      code: `
        async function Page() {
          const t = await getTranslations("common");
          return t("appName");
        }
      `,
      options,
    },
    {
      code: `
        async function Page() {
          const t = await getTranslations("common");
          return t("welcome");
        }
      `,
      options,
    },
    {
      code: `
        async function Page() {
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

    //------------------------------------------------------------------
    // next-intl: useTranslations (client components)
    //------------------------------------------------------------------
    {
      code: `
        function Component() {
          const t = useTranslations("common");
          return t("appName");
        }
      `,
      options,
    },
    {
      code: `
        function Component() {
          const t = useTranslations("common");
          return t("welcome");
        }
      `,
      options,
    },
    {
      code: `
        function Component() {
          const t = useTranslations("errors");
          return t("notFound");
        }
      `,
      options,
    },
    // Nested prefix (e.g., "admin.sidebar")
    {
      code: `
        function Component() {
          const t = useTranslations("admin.sidebar");
          return t("emailTemplates");
        }
      `,
      options,
    },
    {
      code: `
        function Component() {
          const t = useTranslations("admin.sidebar");
          return t("toggleSidebar");
        }
      `,
      options,
    },
    // Arrow function component
    {
      code: `
        const Component = () => {
          const t = useTranslations("admin.sidebar");
          return t("comingSoon");
        };
      `,
      options,
    },
    // Multiple t() calls in same component
    {
      code: `
        function Component() {
          const t = useTranslations("admin.sidebar");
          return (
            t("emailTemplates") + t("toggleSidebar") + t("comingSoon")
          );
        }
      `,
      options,
    },

    //------------------------------------------------------------------
    // Namespace syntax (namespace:key)
    //------------------------------------------------------------------
    {
      code: "t('default:pizza')",
      options,
    },
    {
      code: "t('default:common.appName')",
      options,
    },

    //------------------------------------------------------------------
    // Dynamic keys are ignored (handled by translation-key-string-literal rule)
    //------------------------------------------------------------------
    // t.has() guard pattern - dynamic keys are skipped
    {
      code: "const label = t.has(item.labelKey) ? t(item.labelKey) : item.labelKey;",
      options,
    },
    // Variable key - skipped
    {
      code: "t(someVariable)",
      options,
    },
    // Template literal - skipped
    {
      code: "t(`dynamic.${key}`)",
      options,
    },
  ],

  invalid: [
    //------------------------------------------------------------------
    // Missing keys - basic
    //------------------------------------------------------------------
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
    {
      code: "t('common.missingNestedKey')",
      options,
      errors: [
        {
          message:
            'Translation key "common.missingNestedKey" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },

    //------------------------------------------------------------------
    // next-intl: getTranslations with missing keys
    //------------------------------------------------------------------
    {
      code: `
        async function Page() {
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
    // getTranslations with non-existent prefix
    {
      code: `
        async function Page() {
          const t = await getTranslations("nonExistentPrefix");
          return t("appName");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "nonExistentPrefix.appName" in namespace "default" is used here but missing in the translations file.',
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

    //------------------------------------------------------------------
    // next-intl: useTranslations with missing keys
    //------------------------------------------------------------------
    {
      code: `
        function Component() {
          const t = useTranslations("common");
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
    // useTranslations with non-existent prefix
    {
      code: `
        function Component() {
          const t = useTranslations("nonExistentPrefix");
          return t("appName");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "nonExistentPrefix.appName" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },

    //------------------------------------------------------------------
    // react-i18next: useTranslation with missing keys
    //------------------------------------------------------------------
    {
      code: `
        function Component() {
          const t = useTranslation("default", { keyPrefix: "common" });
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
    // useTranslation with namespace fallback - missing key
    {
      code: `
        function Component() {
          const { t } = useTranslation("login");
          return t("nonExistentKey");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "nonExistentKey" in namespace "login" is used here but missing in the translations file.',
        },
      ],
    },
    // useTranslation with namespace fallback - direct assignment, missing key
    {
      code: `
        function Component() {
          const t = useTranslation("login");
          return t("missingKey");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "missingKey" in namespace "login" is used here but missing in the translations file.',
        },
      ],
    },
    // useTranslation with completely non-existent namespace (not in mapping, not as prefix)
    {
      code: `
        function Component() {
          const { t } = useTranslation("completelyUnknown");
          return t("someKey");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "someKey" in namespace "completelyUnknown" is used here but missing in the translations file.',
        },
      ],
    },

    //------------------------------------------------------------------
    // next-intl: useTranslations with nested prefix and missing key
    //------------------------------------------------------------------
    {
      code: `
        function Component() {
          const t = useTranslations("admin.sidebar");
          return t("nonExistentKey");
        }
      `,
      options,
      errors: [
        {
          message:
            'Translation key "admin.sidebar.nonExistentKey" in namespace "default" is used here but missing in the translations file.',
        },
      ],
    },
  ],
});
