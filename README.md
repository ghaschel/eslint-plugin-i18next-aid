# eslint-plugin-i18next-no-undefined-translation-keys

## Why?

This is a fork of the original [eslint-plugin-i18next-no-undefined-translation-keys](https://github.com/kevindice/eslint-plugin-i18next-no-undefined-translation-keys) plugin but with some extra features.

## What?

This plugin gives you two rules:

- `translation-key-string-literal` - Asserts that translation keys should be string literals only - otherwise, we can't statically analyze them
- `no-undefined-translation-keys` - Detects translation keys in your code which are missing from translation files

These are intended to be used in conjunction with:

- `i18n-json/valid-json` (who doesn't love well-formed JSON?)
- `i18n-json/identical-keys` (ensures that amongst all of your languages, the exact same set of keys is defined)
- `i18n-json/sorted-keys` (optional, but it is nice to have your keys alphabetized)

### Operational Note:

Since we know that translations for other languages aren't immediately available, the recommendation here is to put empty strings in place where you are still waiting for a translation. Then, on whatever cadence makes sense, you can run a recursive check on each file to source the empty strings and batch those together for the translators to work on.

## Installation

You'll first need to install [ESLint](https://eslint.org/):

```sh
npm i eslint --save-dev
```

Next, install `eslint-plugin-i18next-aid`:

```sh
npm install eslint-plugin-i18next-aid --save-dev
```

## Usage

Add `i18next-aid` to the plugins section of your `.eslintrc` configuration file. You can omit the `eslint-plugin-` prefix:

```json
{
  "plugins": ["i18next-aid"]
}
```

Then configure the rules you want to use under the rules section.

```json
{
  "rules": {
    "i18next-aid/translation-key-string-literal": "error",
    "i18next-aid/no-undefined-translation-keys": [
      "error",
      {
        "namespaceTranslationMappingFile": "namespaceMapping.json",
        "defaultNamespace": "default"
      }
    ]
  }
}
```

### Allowing `t.has()` Protected Conditionals

If you need to use dynamic translation keys that are guarded by `t.has()`, you can enable the `allow-t-has-protected-conditionals` option:

```json
{
  "rules": {
    "i18next-aid/translation-key-string-literal": [
      "error",
      "allow-t-has-protected-conditionals"
    ]
  }
}
```

This allows patterns like:

```javascript
// ✅ Valid with allow-t-has-protected-conditionals
const label = t.has(item.labelKey) ? t(item.labelKey) : item.labelKey;

// ✅ Also works with multi-line formatting
const label = t.has(item.labelKey) ? t(item.labelKey) : item.labelKey;

// ❌ Still invalid - keys must match
const label = t.has(keyA) ? t(keyB) : fallback;
```

And your `namespaceMapping.json` file should map your namespaces to translation file paths like so:

```json
{
  "shared": "packages/shared/lang/en.json",
  "unitsOfMeasure": "packages/shared/lang/uom-en.json",
  "user": "packages/user/lang/en.json"
}
```

For those who don't use i18next namespaces (most people), you can skip defining `defaultNamespace`, and your `namespaceMapping.json` file can be as simple as this:

```json
{
  "default": "libs/path/to/your/english.json"
}
```

Note: The `no-undefined-translation-keys` rule will ignore any non-string-literal calls to `t()`.

## Supported Rules

- `i18next-aid/translation-key-string-literal`
- `i18next-aid/no-undefined-translation-keys`
