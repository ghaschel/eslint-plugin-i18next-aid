# Disallows use of translation keys which have no definition (no-undefined-translation-keys)

Please describe the origin of the rule here.

## Rule Details

This rule aims to...

Examples of **incorrect** code for this rule:

```js

// fill me in

```

Examples of **correct** code for this rule:

```js

// fill me in

```

### Options

If there are any options, describe them here. Otherwise, delete this section.

## When Not To Use It

Give a short description of when it would be appropriate to turn off this rule.

## Further Reading

If there are other links that describe the issue this rule addresses, please include them here in a bulleted list.

## Known limitations

### Parameter-passed translation functions

When `t` is received as a **function parameter**, the rule cannot statically determine which namespace it belongs to. Validation is skipped for all `t()` calls inside such helpers to avoid false positives.

```js
// ✅ No errors reported — namespace is unresolvable from inside helper
function helper(t) {
  return t("some.key");
}

// ✅ Also safe when helper is nested inside a component with its own useTranslations
function Page() {
  const t = useTranslations("common");
  function helper(t) {       // t here is a different t, passed from a caller
    return t("some.key");    // skipped — not validated against "common"
  }
  return helper(t);
}
```

To get validation on keys used inside helper functions, declare `t` locally:

```js
// ✅ Validated — t is declared directly in this scope
async function helper(locale) {
  const t = await getTranslations({ locale, namespace: "common" });
  return t("appName");
}
```
