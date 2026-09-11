/**
 * Creates/updates better-auth's tables in `auth.db`.
 *
 * Replaces `bunx @better-auth/cli migrate`, which cannot be used here: the CLI
 * loads `src/auth.ts` through jiti under Node, and that file imports
 * `bun:sqlite`, so the config fails to resolve with MODULE_NOT_FOUND. Running
 * the same migration through better-auth's own API under Bun works fine.
 *
 *   bun run auth:migrate
 */
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../auth";

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
  auth.options,
);

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("[auth:migrate] schema is already up to date");
  process.exit(0);
}

for (const table of toBeCreated) console.log(`  create  ${table.table}`);
for (const table of toBeAdded) console.log(`  alter   ${table.table}`);

await runMigrations();
console.log("[auth:migrate] done");
process.exit(0);
