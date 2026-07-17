/**
 * CLI: list registered users (accounts) from a Postgres branch.
 *
 * An "account" is a registration (one per auth-provider user); its linked `persons` row carries the
 * human-facing name and onboarding state. This joins the two and prints a table sorted newest-first,
 * plus totals and a signed-up-today count.
 *
 * WIRING
 * ------
 * Connects via `DATABASE_URL` (same env the migrate/parity scripts use), so `pnpm --filter
 * @chronicle/db db:users` reports on whatever branch DATABASE_URL points at. To inspect PROD, run it
 * with the prod Neon connection string in scope, e.g.:
 *   DATABASE_URL="postgres://…prod…" pnpm --filter @chronicle/db db:users
 * Read-only: issues a single SELECT, never mutates. Fails loud on a missing DATABASE_URL.
 *
 * Flags:
 *   --today   only show accounts created since 00:00 UTC today.
 *   --json    emit raw JSON instead of the formatted table (for piping).
 */
import { pathToFileURL } from "node:url";
import { createPostgresDatabase } from "../src/postgres-client";

type UserRow = {
  account_id: string;
  email: string | null;
  active: boolean;
  display_name: string | null;
  spoken_name: string | null;
  onboarded_at: Date | null;
  created_at: Date;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "[list-users] DATABASE_URL is not set — nothing to query. " +
        'Set it to the target branch, e.g. DATABASE_URL="postgres://…" pnpm --filter @chronicle/db db:users',
    );
    process.exit(1);
  }

  const todayOnly = process.argv.includes("--today");
  const asJson = process.argv.includes("--json");

  const db = createPostgresDatabase(url);
  try {
    const rows = (await db.$postgres`
      SELECT
        a.id            AS account_id,
        a.email,
        a.active,
        p.display_name,
        p.spoken_name,
        p.onboarded_at,
        a.created_at
      FROM accounts a
      LEFT JOIN persons p ON p.account_id = a.id
      ${todayOnly ? db.$postgres`WHERE a.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')` : db.$postgres``}
      ORDER BY a.created_at DESC
    `) as unknown as UserRow[];

    if (asJson) {
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    }

    if (rows.length === 0) {
      console.log(todayOnly ? "No accounts registered today." : "No registered users.");
      process.exit(0);
    }

    const iso = (d: Date | null): string => (d ? new Date(d).toISOString() : "—");
    const table = rows.map((r) => ({
      name: r.display_name ?? r.spoken_name ?? "(no name)",
      email: r.email ?? "—",
      created_utc: iso(r.created_at),
      onboarded: r.onboarded_at ? "yes" : "no",
      active: r.active ? "yes" : "no",
      account_id: r.account_id,
    }));

    console.log(
      `\nRegistered users${todayOnly ? " (today, UTC)" : ""}: ${rows.length}` +
        (todayOnly ? "" : ` — onboarded: ${rows.filter((r) => r.onboarded_at).length}`),
    );
    console.table(table);
    process.exit(0);
  } catch (err) {
    console.error("[list-users] ✗ query failed:\n", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await db.$postgres.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
