import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the Grind shell, installable assets, and database sync connected", async () => {
  const [page, css, layout, manifestText, serviceWorker, logo, supabase, schema, vercel] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/scheming-white-mark.png", import.meta.url)),
    readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "Grind");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons[0].src, "/grind-icon.png");
  assert.equal(manifest.icons[1].src, "/grind-android-maskable.png");
  assert.equal(logo.subarray(1, 4).toString("ascii"), "PNG");

  assert.match(page, /localStorage\.getItem\("grind-v2"\)/);
  assert.match(page, /grind_states/);
  assert.match(page, /accent: nextAccent/);
  assert.match(page, /signInWithPassword/);
  assert.doesNotMatch(page, /signUp/);
  assert.match(page, /function rolloverPendingTasks\(\)/);
  assert.match(page, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(layout, /title: "Grind"/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /\.checked \.check\{/);
  assert.match(serviceWorker, /grind-android-maskable\.png/);
  assert.match(serviceWorker, /caches\.delete/);
  assert.match(supabase, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(schema, /enable row level security/);
  assert.match(schema, /auth\.uid\(\)/);
  assert.match(vercel, /"framework": "nextjs"/);
});
