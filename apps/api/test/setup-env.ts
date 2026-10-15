/**
 * Environment placeholders for the unit test run.
 *
 * The API validates its whole configuration the moment `config/env` is imported,
 * and several of the modules under test reach the database client through an
 * import chain that ends there. On a developer machine the repository-root `.env`
 * satisfies that check; on a CI runner there is no `.env`, so importing a pure
 * function like the search term splitter failed before a single assertion ran.
 *
 * These values exist only to satisfy a schema. Nothing in the unit suite opens a
 * socket, issues a query or authenticates anything — the tests are chosen to be
 * exactly the functions that need none of it — so a placeholder here cannot
 * connect to a real system even by accident.
 *
 * Every value is deliberately obviously fake and obviously not a secret. If one of
 * these ever looks like something real, that is a bug in this file, and the
 * accompanying comment is the reminder of what none of them is.
 */
const PLACEHOLDER_SECRET = 'unit-test-placeholder-not-a-secret';

function apply(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) {
    // Only fills a gap. A value already present in the environment wins, so a
    // developer running the suite against a real `.env` keeps their own.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

apply({
  // A syntactically valid URL, because the schema checks the shape. Never opened.
  SUPABASE_URL: 'https://unit-test-placeholder.supabase.co',
  SUPABASE_ANON_KEY: PLACEHOLDER_SECRET,
  SUPABASE_SERVICE_ROLE_KEY: PLACEHOLDER_SECRET,
  // Parsed as a connection string, never connected to.
  DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder',
  // Makes the run obviously a test run if anything ever prints the environment.
  NODE_ENV: 'test',
});
