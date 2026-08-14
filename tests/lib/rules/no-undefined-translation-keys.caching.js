/**
 * @fileoverview Regression tests for translation file loading in
 * no-undefined-translation-keys.
 *
 * ESLint calls a rule's `create()` once per linted file. Version 1.1.2 and
 * earlier loaded the namespace mapping file and every translation file on each
 * of those calls via a `delete require.cache[...]` + `require()` helper. That
 * had two consequences on a real codebase:
 *
 *   1. A large en.json was re-read and re-parsed once per linted file.
 *   2. It leaked. Removing a module from `require.cache` does not detach it,
 *      because Node keeps appending each freshly-required Module to the
 *      requiring module's `module.children` array. Every parsed copy stayed
 *      strongly reachable, so heap use grew linearly with the number of linted
 *      files (~0.4 MB per file for a 320 KB en.json) until Node's default
 *      ~4 GB heap was exhausted.
 *
 * These tests pin the invariants that prevent a regression: load each file at
 * most once per edit, retain nothing per lint, and still pick up edits made
 * while a long-lived process (e.g. a dev server) is running.
 *
 * @author Guilherme Haschel
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const { Linter } = require("eslint");

const RULE_PATH = require.resolve(
  "../../../lib/rules/no-undefined-translation-keys"
);
const rule = require(RULE_PATH);

const RULE_NAME = "i18next-aid/no-undefined-translation-keys";

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

/**
 * Writes a throwaway mapping + translation file pair into a unique temp dir, so
 * every test starts with a path the module-scope cache has never seen.
 *
 * @param {object} translations - Contents of the translation file
 * @param {object} [opts]
 * @param {"json"|"js"} [opts.format] - Translation file format
 * @returns {{ dir: string, mappingPath: string, translationPath: string, options: object[] }}
 */
function makeFixture(translations, { format = "json" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18next-aid-cache-"));
  const translationPath = path.join(dir, `translations.${format}`);

  writeTranslations(translationPath, translations, format);

  const mappingPath = path.join(dir, "namespaceMapping.json");
  fs.writeFileSync(
    mappingPath,
    JSON.stringify({ default: `./translations.${format}` }),
    "utf8"
  );

  return {
    dir,
    mappingPath,
    translationPath,
    options: [
      {
        namespaceTranslationMappingFile: mappingPath,
        defaultNamespace: "default",
      },
    ],
  };
}

/**
 * @param {string} filePath - Where to write
 * @param {object} translations - Contents
 * @param {"json"|"js"} format - Output format
 * @returns {void}
 */
function writeTranslations(filePath, translations, format) {
  const body =
    format === "js"
      ? `module.exports = ${JSON.stringify(translations)};\n`
      : JSON.stringify(translations);

  fs.writeFileSync(filePath, body, "utf8");
}

/**
 * Lints `code` `times` times, each call going through a fresh `create()` — the
 * same thing ESLint does when it walks a project of `times` files.
 *
 * @param {number} times - How many files to simulate
 * @param {object[]} options - Rule options
 * @param {string} code - Source to lint
 * @returns {import("eslint").Linter.LintMessage[][]} Messages per run
 */
function lintTimes(times, options, code) {
  const linter = new Linter();

  linter.defineRule(RULE_NAME, rule);

  const runs = [];
  for (let i = 0; i < times; i++) {
    runs.push(
      linter.verify(code, {
        parserOptions: { ecmaVersion: 2020 },
        rules: { [RULE_NAME]: ["error", ...options] },
      })
    );
  }

  return runs;
}

/**
 * Counts how many times specific paths are loaded while `fn` runs, counting
 * both loading mechanisms so the assertion is independent of which one the rule
 * happens to use: `fs.readFileSync` (current implementation) and
 * `require()` (the pre-1.1.3 `requireNoCache` implementation, whose `require`
 * call lives in a different module and is therefore invisible to an `fs` spy
 * alone).
 *
 * @param {string[]} watchedPaths - Absolute paths to count loads for
 * @param {Function} fn - Code to run
 * @returns {Map<string, number>} Load counts keyed by watched path
 */
function countLoads(watchedPaths, fn) {
  const counts = new Map(watchedPaths.map((p) => [p, 0]));
  const bump = (target) => {
    if (typeof target === "string" && counts.has(target)) {
      counts.set(target, counts.get(target) + 1);
    }
  };

  const originalReadFileSync = fs.readFileSync;
  const originalRequire = Module.prototype.require;

  fs.readFileSync = function (target, ...rest) {
    bump(target);
    return originalReadFileSync.call(this, target, ...rest);
  };
  Module.prototype.require = function (id, ...rest) {
    bump(id);
    return originalRequire.call(this, id, ...rest);
  };

  try {
    fn();
  } finally {
    fs.readFileSync = originalReadFileSync;
    Module.prototype.require = originalRequire;
  }

  return counts;
}

/**
 * Total number of child Modules retained across every module in the require
 * cache.
 *
 * This is deliberately global rather than scoped to the rule module: the
 * pre-1.1.3 leak accumulated on `lib/requireNoCache.js`'s `module.children`,
 * not the rule's, so a check scoped to one module silently passes. Summing
 * every cached module catches the retention wherever it lands.
 *
 * @returns {number} Total retained child Module count
 */
function totalRetainedChildren() {
  return Object.values(require.cache).reduce(
    (total, mod) => total + (mod && mod.children ? mod.children.length : 0),
    0
  );
}

/**
 * Pushes a file's mtime forward so the change is visible regardless of
 * filesystem timestamp granularity.
 *
 * @param {string} filePath - File to touch
 * @returns {void}
 */
function bumpMtime(filePath) {
  const future = new Date(Date.now() + 5000);

  fs.utimesSync(filePath, future, future);
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("no-undefined-translation-keys: translation file loading", () => {
  describe("caching", () => {
    it("loads the mapping and translation files once, not once per linted file", () => {
      const { mappingPath, translationPath, options } = makeFixture({
        present: "Present",
      });
      const files = 50;

      const counts = countLoads([mappingPath, translationPath], () => {
        lintTimes(files, options, "t('present')");
      });

      // Before the fix both of these were 50 — one load per linted file.
      assert.strictEqual(
        counts.get(translationPath),
        1,
        `translation file should be loaded once, not once per linted file ` +
          `(loaded ${counts.get(translationPath)} times across ${files} files)`
      );
      assert.strictEqual(
        counts.get(mappingPath),
        1,
        `mapping file should be loaded once, not once per linted file ` +
          `(loaded ${counts.get(mappingPath)} times across ${files} files)`
      );
    });

    it("still reports correctly on every linted file while cached", () => {
      const { options } = makeFixture({ present: "Present" });

      const runs = lintTimes(25, options, "t('missing')");

      assert.strictEqual(runs.length, 25);
      for (const messages of runs) {
        assert.strictEqual(
          messages.length,
          1,
          "each run should still flag the missing key"
        );
        assert.match(messages[0].message, /"missing"/);
      }
    });

    it("caches per resolved path, so separate mappings stay independent", () => {
      const first = makeFixture({ onlyInFirst: "1" });
      const second = makeFixture({ onlyInSecond: "2" });

      assert.deepStrictEqual(
        lintTimes(1, first.options, "t('onlyInFirst')")[0],
        [],
        "first mapping should resolve its own key"
      );
      assert.deepStrictEqual(
        lintTimes(1, second.options, "t('onlyInSecond')")[0],
        [],
        "second mapping should resolve its own key"
      );
      assert.strictEqual(
        lintTimes(1, second.options, "t('onlyInFirst')")[0].length,
        1,
        "second mapping must not see the first mapping's keys"
      );
    });
  });

  describe("memory retention", () => {
    it("does not retain a Module per linted file (module.children stays flat)", () => {
      const { options } = makeFixture({ present: "Present" });

      assert.ok(
        require.cache[RULE_PATH],
        "rule module should be in require.cache"
      );

      // Warm the cache so the first load is not counted as growth.
      lintTimes(1, options, "t('present')");

      const childrenBefore = totalRetainedChildren();
      const files = 200;

      lintTimes(files, options, "t('present')");

      const grew = totalRetainedChildren() - childrenBefore;

      // Before the fix this grew by 2 per linted file (400 here), each
      // retained Module holding a fully parsed copy of the translation file.
      assert.strictEqual(
        grew,
        0,
        `linting must not append Modules to any module.children ` +
          `(grew by ${grew} across ${files} linted files)`
      );
    });

    it("does not grow require.cache per linted file", () => {
      const { options } = makeFixture({ present: "Present" });

      lintTimes(1, options, "t('present')");
      const cacheSizeBefore = Object.keys(require.cache).length;

      lintTimes(200, options, "t('present')");

      assert.strictEqual(
        Object.keys(require.cache).length,
        cacheSizeBefore,
        "linting must not add entries to require.cache"
      );
    });

    it("keeps heap growth flat across many linted files", () => {
      // A translation payload big enough that a per-file leak is unmistakable:
      // 2000 keys retained across 500 linted files is hundreds of MB.
      const big = {};
      for (let i = 0; i < 2000; i++) {
        big[`key${i}`] = `value ${i} ${"x".repeat(100)}`;
      }
      const { options } = makeFixture(big);
      const files = 500;

      lintTimes(1, options, "t('key0')");
      global.gc?.();
      const before = process.memoryUsage().heapUsed;

      lintTimes(files, options, "t('key0')");
      global.gc?.();
      const growthMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;

      // Generous bound: the point is constant-vs-linear, not a tight number.
      // The leaky implementation grew by ~170 MB here.
      assert.ok(
        growthMb < 50,
        `heap grew ${growthMb.toFixed(1)} MB across ${files} linted files, ` +
          "which suggests translation data is being retained per file"
      );
    });
  });

  describe("mtime invalidation", () => {
    it("picks up edits to a translation file without a restart", () => {
      const { translationPath, options } = makeFixture({ existing: "Existing" });

      assert.strictEqual(
        lintTimes(1, options, "t('addedLater')")[0].length,
        1,
        "key should be missing before the edit"
      );

      writeTranslations(
        translationPath,
        { existing: "Existing", addedLater: "Added later" },
        "json"
      );
      bumpMtime(translationPath);

      assert.deepStrictEqual(
        lintTimes(1, options, "t('addedLater')")[0],
        [],
        "key should be found after the translation file is edited"
      );
    });

    it("picks up edits to the mapping file without a restart", () => {
      const { dir, mappingPath, options } = makeFixture({ inDefault: "1" });

      const extraPath = path.join(dir, "extra.json");
      fs.writeFileSync(
        extraPath,
        JSON.stringify({ inExtra: "2" }),
        "utf8"
      );

      assert.strictEqual(
        lintTimes(1, options, "t('extra:inExtra')")[0].length,
        1,
        "namespace should be unknown before the mapping is edited"
      );

      fs.writeFileSync(
        mappingPath,
        JSON.stringify({ default: "./translations.json", extra: "./extra.json" }),
        "utf8"
      );
      bumpMtime(mappingPath);

      assert.deepStrictEqual(
        lintTimes(1, options, "t('extra:inExtra')")[0],
        [],
        "newly mapped namespace should resolve after the mapping file is edited"
      );
    });
  });

  describe("non-JSON translation modules", () => {
    it("still supports a .js translation module", () => {
      const { options } = makeFixture({ fromJs: "From JS" }, { format: "js" });

      assert.deepStrictEqual(
        lintTimes(1, options, "t('fromJs')")[0],
        [],
        "keys from a .js translation module should resolve"
      );
      assert.strictEqual(
        lintTimes(1, options, "t('notThere')")[0].length,
        1,
        "missing keys should still be reported for .js modules"
      );
    });

    it("does not retain a Module per linted file for .js modules", () => {
      const { options } = makeFixture({ fromJs: "From JS" }, { format: "js" });

      lintTimes(1, options, "t('fromJs')");
      const childrenBefore = totalRetainedChildren();
      const files = 200;

      lintTimes(files, options, "t('fromJs')");

      const grew = totalRetainedChildren() - childrenBefore;

      assert.strictEqual(
        grew,
        0,
        `require()-based loading must not accumulate module.children ` +
          `(grew by ${grew} across ${files} linted files)`
      );
    });
  });
});
