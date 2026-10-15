import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration for the whole workspace.
 *
 * Scoped deliberately. The point of adding this late is to catch real defects, not
 * to restyle a tree that was written under a different convention — so the rules
 * that would fire on stylistic choice (naming, member ordering, import order,
 * exhaustive switch matching) are off, and the rules that stay are the ones that
 * find bugs.
 *
 * Run with `npm run lint`, alongside the type-check and the build in CI.
 *
 * Three things this deliberately does not do:
 *
 * * It does not enforce the project's comment practice. The house style is heavy
 *   explanatory commenting of a kind most rule sets either forbid or ignore, and a
 *   rule about it would be either unenforced or a mass rewrite.
 * * It does not restyle. No formatting rules are enabled, so adding this changed
 *   no existing line's appearance.
 * * It does not lint generated or vendored output. `.next`, `dist` and
 *   `coverage` are ignored so a build artefact can never fail a check.
 *
 * Globals are declared per environment rather than assumed. The workspace mixes
 * three: Node for the API and the scripts, browser for the client components, and
 * both for the isomorphic helpers. Getting this wrong produces a wall of
 * `no-undef` on `process`, `Buffer` and `fetch` that says nothing about the code.
 */
export default tseslint.config(
  {
    // Reports "unused eslint-disable directive" for the historical suppressions
    // left in place for the two rules this config deliberately switches off, and
    // for a few that have since stopped matching. That is noise about the past,
    // not a defect in the present, and acting on it would mean deleting
    // suppressions that still document why the code looks the way it does.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      /*
       * Both are off because a handful of places hold a value whose shape is
       * validated at runtime and asserted at the boundary — an API payload, a
       * signed URL. Turning them off is narrower than pretending those do not
       * exist.
       */
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // A triple-slash reference is how a type-only global is declared. One is
      // used deliberately for the Node fetch typings, and it works.
      '@typescript-eslint/triple-slash-reference': 'off',

      /*
       * Off because it fires on every deliberately non-awaiting async function —
       * a server action that only throws, a wrapper returning a promise — none of
       * which is a defect.
       */
      'require-await': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',

      // Rules below are errors because each has caught or would catch a real
      // defect rather than a matter of taste.
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-async-promise-executor': 'error',
      'no-misleading-character-class': 'error',
      'no-prototype-builtins': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },

  /* The API and the scripts are Node programs: no DOM, full Node globals. */
  {
    files: ['apps/api/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  /*
   * The client. Browser globals, plus the accessibility rules that matter for a
   * correctness bug rather than a style preference: a control with no accessible
   * name, or an image with none, is unusable rather than merely untidy.
   *
   * `@next/next/no-img-element` and `jsx-a11y/media-has-caption` are off on
   * purpose. Every image in this client is evidence loaded from a short-lived
   * signed URL out of a private bucket: `next/image` would have to proxy and cache
   * it, and caching a signed URL extends the life of a link that is supposed to
   * expire, so the component would be the wrong tool rather than the right one in
   * the wrong place. A `<caption>` on a voice note is equally not actionable —
   * a transcription is not guaranteed to exist, and the recording is the record.
   * Both were previously suppressed file by file; doing it once here stops the
   * suppression comments from drifting out of alignment with the line they
   * annotate, which is how two of them stopped working in the first place.
   */
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      // Registered rather than extended. `eslint-config-next` would bring a React
      // and formatting preset this codebase does not follow, so only the two
      // plugins are loaded and only the rules below are switched on.
      '@next/next': nextPlugin,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      /*
       * A curated set, not `jsxA11y.configs.recommended`. The preset is mostly
       * good, but three of its rules express a preference rather than a defect
       * and would fail valid markup in this codebase:
       *
       * - `label-has-associated-control` fires on a `<label>` that *wraps* its
       *   input, the pattern used throughout these forms and valid accessible
       *   HTML. Asserted as `either` below so wrapping counts.
       * - `img-redundant-alt` objects to the word "Photo" in `alt="Photo of …"`.
       *   Redundant to a screen reader, not wrong.
       * - `no-static-element-interactions` fires on any clickable wrapper, and
       *   deciding whether each one is genuinely unreachable by keyboard is a
       *   per-component review rather than something a rule can settle.
       *
       * The rules kept below are the ones that catch an interface that is
       * actually unusable: a control with no accessible name, a handler with no
       * keyboard path, an ARIA attribute with no role or the reverse.
       */
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', depth: 3 }],
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',

      /*
       * Off on purpose, and the reason matters. Every image in this client is
       * evidence loaded from a short-lived signed URL in a private bucket.
       * `next/image` would have to proxy and cache it, and caching a signed URL
       * extends the life of a link that is meant to expire — so the component
       * would be the wrong tool, not the right tool in the wrong place.
       *
       * `media-has-caption` is off for the same spirit: a transcription is not
       * guaranteed to exist, and the recording is the record, so demanding a
       * caption element would demand something the product does not promise.
       *
       * Both were suppressed file by file before this config existed, and two of
       * those comments had drifted off the line they annotated and silently
       * stopped working. Turning the rule off once here is what stops that; the
       * stale directives are then reported as unused, which is noise rather than
       * a defect, so unused-directive reporting is silenced at the top level.
       */
      '@next/next/no-img-element': 'off',
      'jsx-a11y/media-has-caption': 'off',
    },
  },

  /*
   * Server-rendered pages execute on the server and render to the browser, so
   * they get both sets. Without the browser half, a page using `URL` or
   * `Intl` at render time is reported as undefined.
   */
  {
    files: ['apps/web/src/app/**/*.{ts,tsx}', 'apps/web/src/lib/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
