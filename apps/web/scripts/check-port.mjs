#!/usr/bin/env node
/**
 * Pre-flight check: hard-fail (with a giant banner) if port 3000 is already bound.
 *
 * Without this, `next dev` silently falls back to 3001/3002/etc when an old dev
 * server is still running — which leads to "why is my change not showing up"
 * confusion, since the browser tab is still pointed at the previous instance.
 */
import net from "node:net";

const PORT = Number(process.env.PORT ?? 3000);

const inUse = await new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", (err) => resolve(err.code === "EADDRINUSE"));
  server.once("listening", () => server.close(() => resolve(false)));
  server.listen(PORT, "0.0.0.0");
});

if (inUse) {
  const bar = "=".repeat(72);
  process.stderr.write(`\n\x1b[41m\x1b[97m${bar}\x1b[0m\n`);
  process.stderr.write(`\x1b[41m\x1b[97m  PORT ${PORT} IS ALREADY IN USE — an existing dev server is still running.${" ".repeat(Math.max(0, 72 - 60 - String(PORT).length))}\x1b[0m\n`);
  process.stderr.write(`\x1b[41m\x1b[97m  Find it:   Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess${" ".repeat(Math.max(0, 72 - 56 - String(PORT).length))}\x1b[0m\n`);
  process.stderr.write(`\x1b[41m\x1b[97m  Kill it:   Stop-Process -Id <pid> -Force${" ".repeat(Math.max(0, 72 - 42))}\x1b[0m\n`);
  process.stderr.write(`\x1b[41m\x1b[97m${bar}\x1b[0m\n\n`);
  process.exit(1);
}
