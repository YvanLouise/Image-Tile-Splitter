# Cloudflare Visit Counter

This optional Worker records one visit per IP hash and returns the global count:

```json
{ "uniqueVisitors": 123 }
```

The frontend reads the endpoint from `VITE_VISIT_COUNTER_ENDPOINT`. Without that env var, the app still works and the help dialog shows that visit counting is not configured.

## Setup

1. Create a Cloudflare D1 database.
2. Run `schema.sql` against that database.
3. Deploy `worker.js` as a Cloudflare Worker.
4. Bind the D1 database as `DB`.
5. Add Worker environment variables:
   - `VISIT_COUNTER_SALT`: a private random string used before hashing IPs.
   - `ALLOWED_ORIGIN`: your site origin, for example `https://yvanlouise.github.io`.
6. Set the Vite build env var:

```bash
VITE_VISIT_COUNTER_ENDPOINT=https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
```

For GitHub Pages, add it as an Actions variable or secret and expose it during the build step.

## Privacy Note

The Worker does not store raw IP addresses. It stores only a salted SHA-256 hash and the first seen time. If you change the salt, all future visitors will be counted against a new hash set.
