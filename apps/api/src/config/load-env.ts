import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Locates the single `.env` file at the repository root.
 *
 * Workspace scripts run with their cwd set to the package directory, so a plain
 * `dotenv()` would only look in `apps/api` and silently miss the root file. This
 * walks upward from this module until it finds one, keeping one source of
 * configuration for every process in the monorepo.
 */
function findEnvFile(): string | undefined {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return undefined;
}

export function loadEnvFiles(): void {
  const envFile = findEnvFile();
  if (envFile) loadDotenv({ path: envFile });
}