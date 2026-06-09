# `useTranslations` Namespace Detection Fix — Design Spec

**Date:** 2026-06-09
**Rule affected:** `no-undefined-translation-keys`
**Status:** Approved

---

## Problem

When a project maps multiple namespaces (e.g. `{ "default": "...", "register": "..." }`), calling
`useTranslations("register")` inside a component produces a false positive:

```
Translation key "register.accountFlow.states.startingProvider" in namespace "default"
is used here but missing in the translations file.
```

The plugin treats the `useTranslations` argument as a *prefix path* under the default namespace
instead of as a *namespace key* in the mapping file. It then constructs
`key = "register.<keyArg>"` and looks it up in `"default"` — which fails.

The same defect exists for `getTranslations` (both `await` and sync forms).

The presence of multiple `useTranslations` calls in the same component scope (e.g.
`tAuth = useTranslations("auth.consent")` alongside `t = useTranslations("register")`) does not
cause cross-contamination — the callee-name check already prevents that — but it surfaced the bug
in practice.

---

## Root Cause

`findTranslationFunctionInfo` unconditionally sets `prefix = arg` for `useTranslations` and
`getTranslations`. Because `prefix` is treated as a nested path inside the default namespace,
the subsequent lookup always targets the wrong namespace when `arg` is a registered namespace key.

`useTranslation` (react-i18next) is unaffected — it already sets `namespace` directly.

---

## Solution: Approach A — Smart Detection

Inside `findTranslationFunctionInfo`, which is a closure with access to `translationKeysFromFiles`,
check whether `arg` is a registered namespace key before deciding which variable to set.

**Decision table:**

| `translationKeysFromFiles[arg]` | Result |
|---|---|
| exists (non-undefined) | `namespace = arg`, `prefix = null` — treat as namespace |
| does not exist | `prefix = arg`, `namespace` unchanged — existing prefix-path behaviour |

**Why this is safe for existing tests:**
The test mapping only has `"default"`. All existing `useTranslations` args (`"common"`,
`"errors"`, `"admin.sidebar"`, `"nonExistentPrefix"`) are absent from `translationKeysFromFiles`,
so they all remain in the `prefix` path. No existing test changes.

---

## Changes

### `lib/rules/no-undefined-translation-keys.js`

Three locations in `findTranslationFunctionInfo` get the same treatment:

**`useTranslations` (next-intl client hook):**
```js
if (declaration.init?.callee?.name === "useTranslations") {
  const arg = declaration.init?.arguments?.[0]?.value;
  if (arg !== undefined && translationKeysFromFiles[arg] !== undefined) {
    namespace = arg;
    prefix = null;
  } else {
    prefix = arg;
  }
}
```

**`getTranslations` (sync, without await):**
```js
if (declaration.init?.callee?.name === "getTranslations") {
  const arg = declaration.init?.arguments?.[0]?.value;
  if (arg !== undefined && translationKeysFromFiles[arg] !== undefined) {
    namespace = arg;
    prefix = null;
  } else {
    prefix = arg;
  }
}
```

**`getTranslations` (async, with await):**
```js
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
```

`useTranslation` (react-i18next) is unchanged.

### New test fixtures

**`lib/lang/register.json`** — minimal translation file for the "register" namespace:
```json
{
  "accountFlow": {
    "states": {
      "startingProvider": "Starting with {provider}..."
    },
    "actions": {
      "subscribeNow": "Subscribe now",
      "startTrial": "Start trial"
    }
  }
}
```

**`tests/multiNamespaceMapping.json`** — mapping with both namespaces:
```json
{
  "default": "../lib/lang/en.json",
  "register": "../lib/lang/register.json"
}
```

### `tests/lib/rules/no-undefined-translation-keys.js`

Add a `multiNamespaceOptions` fixture and new test cases:

```js
const multiNamespaceOptions = [{
  namespaceTranslationMappingFile: path.resolve(__dirname, "../../multiNamespaceMapping.json"),
  defaultNamespace: "default",
}];
```

**Valid cases (no error):**
- `useTranslations("register")` + key present in register.json
- `useTranslations("register")` alongside `useTranslations("default")` in the same component (the multi-instance scenario from the bug report)
- `await getTranslations("register")` + key present in register.json

**Invalid cases (error with correct namespace):**
- `useTranslations("register")` + key absent from register.json → error reports `namespace "register"` (not `"default"`)

---

## Scope Boundary

- No changes to `getTranslationKey`, `lookupKey`, the schema, or any other rule.
- No new rule options.
- Fix is entirely inside `findTranslationFunctionInfo` and the new test fixtures.
