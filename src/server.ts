/**
 * Node.js entry point — serves Hono app + static files.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import app from "./index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Run schema on startup
import { getDb } from "./env";

const schemaPath = resolve(__dirname, "../schema.sql");
if (existsSync(schemaPath)) {
  const schema = readFileSync(schemaPath, "utf-8");
  getDb().exec(schema);
  console.log("Schema applied");
}

// Static assets
const staticDir = existsSync("/app/static") ? "/app/static" : resolve(__dirname, "../frontend/dist");
if (existsSync(staticDir)) {
  app.use("/assets/*", serveStatic({ root: staticDir }));
  app.use("/favicon.ico", serveStatic({ root: staticDir }));
}

// Not-found handler: API routes get 404 JSON, everything else gets index.html (SPA)
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "not found" }, 404);
  }
  if (existsSync(resolve(staticDir, "index.html"))) {
    const html = readFileSync(resolve(staticDir, "index.html"), "utf-8");
    return c.html(html);
  }
  return c.text("Not Found", 404);
});

console.log(`Portal listening on ${HOST}:${PORT}`);
serve({ fetch: app.fetch, hostname: HOST, port: PORT });
