/**
 * Dev-only PGlite inspector. PGlite is in-process and single-connection, so only ONE process can
 * open a data dir at a time — stop the dev server before pointing this at the live dir, or point
 * it at a backup copy (which is never locked).
 *
 * Usage (run from repo root or apps/web):
 *   node apps/web/scripts/db-view.mjs                       # list tables + row counts (live dir)
 *   node apps/web/scripts/db-view.mjs "select * from persons limit 20"
 *   node apps/web/scripts/db-view.mjs --db .pglite/backup-20260630 "select * from accounts"
 *   node apps/web/scripts/db-view.mjs --dump dump.sql        # full pg_dump-style SQL dump
 */
import { PGlite } from "@electric-sql/pglite";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
let dbArg = "./.pglite/dev";
let dumpPath = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--db") dbArg = argv[++i];
  else if (argv[i] === "--dump") dumpPath = argv[++i] ?? "dump.sql";
  else rest.push(argv[i]);
}
const dataDir = isAbsolute(dbArg) ? dbArg : resolve(webDir, dbArg);
const sql = rest.join(" ").trim();

const pg = new PGlite(dataDir);

try {
  if (dumpPath) {
    // Self-rolled INSERT dump (pglite-tools pg_dump wasm is unreliable against a file-backed
    // dataDir). Emits data-only INSERTs for every public table in FK-safe-ish order. Re-load
    // into a freshly-migrated DB (schema already applied), not a populated one.
    const { rows: tables } = await pg.query(`
      select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE' order by table_name`);
    // `SELECT *` crashes this PGlite build's result parser, so enumerate columns and cast each to
    // text. Every value comes back as a string (or null); Postgres coerces text literals back into
    // uuid / jsonb / timestamp / enum on INSERT, so an all-strings dump round-trips cleanly.
    const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
    let outSql = `-- Chronicle data dump from ${dataDir}\nSET session_replication_role = replica;\n\n`;
    for (const { table_name } of tables) {
      const { rows: colRows } = await pg.query(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name=$1 order by ordinal_position`,
        [table_name],
      );
      const names = colRows.map((c) => c.column_name);
      const selectList = names.map((n) => `"${n}"::text as "${n}"`).join(", ");
      const { rows } = await pg.query(`select ${selectList} from "${table_name}"`);
      if (!rows.length) continue;
      const cols = names.map((n) => `"${n}"`).join(", ");
      outSql += `-- ${table_name} (${rows.length})\n`;
      for (const r of rows) {
        const vals = names.map((n) => q(r[n])).join(", ");
        outSql += `INSERT INTO "${table_name}" (${cols}) VALUES (${vals});\n`;
      }
      outSql += "\n";
    }
    outSql += "SET session_replication_role = DEFAULT;\n";
    const out = isAbsolute(dumpPath) ? dumpPath : resolve(process.cwd(), dumpPath);
    writeFileSync(out, outSql);
    console.log(`Wrote SQL dump → ${out}`);
  } else if (!sql) {
    const { rows } = await pg.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`);
    console.log(`Tables in ${dataDir}:\n`);
    for (const { table_name } of rows) {
      const c = await pg.query(`select count(*)::int as n from "${table_name}"`);
      console.log(`  ${table_name.padEnd(24)} ${c.rows[0].n}`);
    }
    console.log(`\nRun a query:  node apps/web/scripts/db-view.mjs "select * from persons limit 20"`);
  } else {
    const { rows } = await pg.query(sql);
    console.table(rows);
    console.log(`(${rows.length} rows)`);
  }
} catch (err) {
  console.error(`\nSQL error: ${err.message ?? err}`);
  process.exitCode = 1;
} finally {
  await pg.close();
}
