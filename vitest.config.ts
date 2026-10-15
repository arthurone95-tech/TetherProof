import { defineConfig } from 'vitest/config';

/**
 * Unit test configuration.
 *
 * Scoped to `apps` and `packages` on purpose. The `scripts/` directory holds the
 * existing integration suites — fraud, security, integrity, scrub and the live
 * smoke run — which assert against a real database and real storage through
 * `tsx`. They are not unit tests and are not collected here; running them remains
 * `npm run fraud-check` and friends.
 *
 * What this is for is the layer none of those reach: the pure functions that
 * decide something, called directly, with no database and no network. That is
 * where a wrong answer is cheap to prove and cheap to fix.
 *
 * No jsdom environment. Nothing here renders; a test that needed a DOM would be
 * testing the framework rather than this code, and the lightbox and the forms are
 * covered by the live suite's assertions on the responses they produce.
 */
export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
    // A unit test that needs the network or a database has stopped being one.
    // Failing loudly here is the point.
    environmentMatchGlobs: [],
    reporters: 'default',
  },
});
