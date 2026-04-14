/**
 * IN-MEMORY STORAGE — DEMO / DEV ONLY
 *
 * This Map is a module-level singleton. In a long-running Node.js process
 * (local `next dev`) all route handlers share this instance and tokens persist
 * across requests as expected.
 *
 * On Netlify (serverless), each function invocation may be routed to a
 * different warm Lambda container. Tokens stored by the webhook invocation
 * may NOT be visible to a subsequent `/api/mint` invocation.
 *
 * For production use, replace this Map with a persistent KV store such as:
 *   - Netlify Blobs  (built-in, zero config)
 *   - Upstash Redis  (free tier available, works perfectly with serverless)
 *   - Vercel KV / PlanetScale / Supabase
 *
 * For this demo the in-memory approach is acceptable because:
 *   1. Testing is done locally with `next dev` where state IS shared.
 *   2. Netlify functions warm up fast; a single container often handles
 *      back-to-back requests from the same user during a session.
 */
export const tokensByAddress = new Map<string, { url: string; token: string }>();
