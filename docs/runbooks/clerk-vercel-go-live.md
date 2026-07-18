# Runbook — Production go-live on `tellmeagain.app` (Clerk + Vercel + all prod env)

Closes issue **#9**. Domain: **`tellmeagain.app`** (DNS hosted by Vercel — nameservers
`ns1/ns2.vercel-dns.com`, confirmed via `nslookup -type=ns tellmeagain.app`).

> **Scope reality check.** "Clerk go-live" is a misnomer. The Vercel **build** runs
> `apps/web/scripts/check-env.mjs`, which **fails the deploy** if any *required* prod secret
> is missing — and that list includes **R2, Groq, and Inngest**, not just the Clerk keys.
> Flipping Clerk live without those already provisioned = a red build. §0 is the full
> inventory; do it first. For a small beta you can **defer** the two optional OAuth features
> (Clerk social sign-in, Google Photos import) — both are feature-gated OFF when unset.

Order: **§0** env inventory → **§A** Clerk dev acceptance → **§B** Clerk prod instance + DNS →
**§C** Clerk social OAuth (optional) → **§D** Google Photos OAuth (optional) → **§E** the other
required secrets → **§F** set env + flip + redeploy → **§G** verify → **§H** optional user seed.

---

## §0. Complete production env inventory

Source of truth: `apps/web/scripts/check-env.mjs` (`REQUIRED` fails the build; `RECOMMENDED`
only warns). All set in **Vercel → Project → Settings → Environment Variables → Production**.

### REQUIRED — build fails if any is missing
| Var | What it is | Where it comes from |
|---|---|---|
| `DATABASE_URL` | Postgres (Neon) | Neon **production** branch conn string (§E.1) |
| `CLERK_SECRET_KEY` | Server auth | Clerk prod instance → API keys (`sk_live_…`) (§B) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client auth (build-inlined) | Clerk prod instance (`pk_live_…`) (§B) |
| `R2_ACCOUNT_ID` | Cloudflare R2 media | R2 dashboard (§E.2) |
| `R2_ACCESS_KEY_ID` | R2 media | R2 API token (§E.2) |
| `R2_SECRET_ACCESS_KEY` | R2 media | R2 API token (§E.2) |
| `R2_BUCKET` | R2 media | R2 bucket name (§E.2) |
| `ALBUM_UPLOAD_TICKET_SECRET` | HMAC for direct-upload tickets (#20) | generate (§E.4) |
| `GROQ_API_KEY` | Transcription + Phase-1 LLM | console.groq.com (§E.3) |
| `INNGEST_EVENT_KEY` | Durable job queue | Inngest dashboard (§E.5) |
| `INNGEST_SIGNING_KEY` | Job queue sig verification | Inngest dashboard (§E.5) |
| `INVITE_TOKEN_ENC_KEY` | Envelope-encrypts the invite token in the `invite.send` payload (#103) | generate: `openssl rand -base64 32` (must decode to 32 bytes) |

### RECOMMENDED — warns only, safe fallback
| Var | Set it if… |
|---|---|
| `CLERK_WEBHOOK_SIGNING_SECRET` | you want the #10 user-sync webhook (§B.5). Not in check-env, but the webhook route 400s without it. Set it. |
| `APP_BASE_URL` | **set to `https://tellmeagain.app`** — pins absolute redirect/link origins (magic links, Google Photos redirect). Recommended for go-live. |
| `ANTHROPIC_API_KEY` | you want the LLM fallback (prod uses Groq by default). |
| `NEXT_PUBLIC_SENTRY_DSN` | you want error observability. |
| `GOOGLE_PHOTOS_OAUTH_STATE_SECRET` | enabling Google Photos import (§D). |

### FEATURE-GATED — not in check-env; only if you enable the feature
| Var | Feature |
|---|---|
| `GOOGLE_PHOTOS_CLIENT_ID` / `_CLIENT_SECRET` / `_TOKEN_ENCRYPTION_KEY` | Google Photos import (§D) |
| `FOLLOW_UPS_ENABLED` | follow-up questions (#77) — set `true` to enable |
| `ALBUM_IMPORT_PROGRESS_ENABLED` | album import progress UI |

> **Already-deployed note:** the Vercel beta is live, so R2/Groq/Inngest/ticket-secret may
> already be set on Production. Verify with `vercel env ls production` before assuming you
> must create them — you likely only need the **live Clerk keys** + confirming the rest.

---

## §A. Clerk — live acceptance on the **development** instance

Validate the real integration before touching DNS. No domain needed.

1. Clerk Dashboard → **dev instance** → **User & Authentication → Personal information** →
   set **Name → Required**. (`app/welcome/` assumes a name exists.)
2. **User & Authentication → Email, Phone, Username** — confirm **Email address** is on and
   your intended sign-in methods (email code / magic link / password) are enabled.
3. Create the five `+clerk_test` fixture users (dev-only test emails; code is always
   `424242`): `eleanor+clerk_test@example.com`, `marco+clerk_test@example.com`,
   `maya+clerk_test@example.com`, `sofia+clerk_test@example.com`, `theo+clerk_test@example.com`.
4. On your **preview deploy** (running dev `pk_test_`/`sk_test_`), run the loop:
   sign-up → sign-in → **magic-link redeem** (`/auth/redeem`) → land `/hub`; confirm JIT
   provisioning wrote an Account + Person row on first landing.
5. ✅ Issue #9 box: "Slice 1 core loop passes live acceptance on dev keys."

---

## §B. Clerk — production instance + DNS + keys + webhook

1. Clerk Dashboard → **Create production instance** (clone settings from dev when offered).
   Set application domain = `tellmeagain.app`. **Re-assert Name → Required** here (settings
   don't always carry across instances).
2. **DNS records** (Dashboard → **Domains** shows the exact targets). Clerk issues CNAMEs on
   subdomains: typically `clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`.
   Add them **in Vercel** (Vercel hosts your DNS):
   - Vercel dashboard → **account/team top-level `Domains`** (the Domains area, *not* the
     project's Settings→Domains) → click **`tellmeagain.app`** → **`DNS Records`** → **Add**.
   - One row per Clerk entry: **Name** = the subdomain label only (`clerk`, not the FQDN),
     **Type** = `CNAME`, **Value** = the exact target Clerk shows.
   - Back in Clerk Domains, click **Verify** once records are in. Propagation up to 48h.
3. Clerk Dashboard (prod) → **API keys** → copy `pk_live_…` and `sk_live_…` → these become
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` in §F.
4. In `tellmeagain.app` (Vercel project → Settings → Domains), add the **apex** domain so
   Vercel serves the app there. (Independent of the Clerk subdomain records above.)
5. **User-sync webhook (#10):** Clerk Dashboard (prod) → **Webhooks** → **Add Endpoint** →
   URL `https://tellmeagain.app/api/webhooks/clerk` → subscribe to **`user.updated`** and
   **`user.deleted`** only → copy the **Signing Secret** (`whsec_…`) → this becomes
   `CLERK_WEBHOOK_SIGNING_SECRET` in §F. (The route rejects unsigned/misconfigured with 400.)

---

## §C. Clerk — social sign-in OAuth (OPTIONAL, conditional)

Your `/sign-in` renders Clerk's hosted `<SignIn/>`, which shows **whatever social providers
are enabled in the Clerk dashboard**. On **dev**, Clerk supplies shared demo OAuth credentials
so Google/etc "just work." On **production, Clerk requires YOUR OWN OAuth credentials** for
each enabled provider — the shared dev creds do not carry over.

**Decide per provider:**

### Option 1 — Launch magic-link/email only (simplest; recommended for beta)
Clerk Dashboard (**prod**) → **User & Authentication → Social Connections** → ensure **all
providers are OFF**. Nothing else to do; no Google Cloud project needed. You can add social
sign-in later without a redeploy (it's dashboard config).

### Option 2 — Enable Google (or another) social sign-in in prod
For **each** provider you want live, e.g. Google:
1. **Google Cloud Console** → create/select a project → **APIs & Services → Credentials** →
   **Create Credentials → OAuth client ID** → type **Web application**.
2. **Authorized redirect URI:** use the exact callback Clerk shows on the provider's config
   panel (Clerk Dashboard → Social Connections → Google → "Use custom credentials"). It is a
   Clerk-hosted URL on your `clerk.tellmeagain.app` Frontend API, **not** an app route.
3. **OAuth consent screen:** configure it, add the scopes Clerk lists (email, profile,
   openid), and **Publish** it (a "Testing"-status screen blocks non-test users).
4. Copy the **Client ID** + **Client Secret** into Clerk's Google panel → **Save**.
5. Repeat per provider. These credentials live **in the Clerk dashboard**, not in Vercel env.

> For a small family beta, Option 1. Skip this whole section unless you specifically want
> "Sign in with Google" on the login screen.

---

## §D. Google Photos import OAuth (OPTIONAL, separate from sign-in)

This powers the album's **"import from Google Photos"** feature — a distinct Google Cloud
OAuth client, unrelated to §C sign-in. `isGooglePhotosConfigured()` gates it: **unset → the
Google chrome stays hidden and the album is file-upload-only.** Safe to defer past launch.

If you want it live:

1. **Google Cloud Console** → project → **APIs & Services → Library** → enable the
   **Photos Picker API** (the app uses the Picker session flow, not the deprecated Library API).
2. **OAuth consent screen** → External → add scopes for the Photos Picker → add your beta
   users as **test users**, or **Publish** the app. (Unpublished + non-test-user = blocked.)
3. **Credentials → Create OAuth client ID → Web application:**
   - **Authorized redirect URI:** `https://tellmeagain.app/api/google-photos/callback`
     (must match exactly — the app builds it from `APP_BASE_URL`, so set `APP_BASE_URL=https://tellmeagain.app` in §F).
4. Copy Client ID + Secret. Set three prod env vars (§F):
   - `GOOGLE_PHOTOS_CLIENT_ID` = the client ID
   - `GOOGLE_PHOTOS_CLIENT_SECRET` = the client secret
   - `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY` = base64-encoded **32-byte** key. Generate:
     `openssl rand -base64 32` (must decode to exactly 32 bytes or the app throws).
5. Also set `GOOGLE_PHOTOS_OAUTH_STATE_SECRET` (any strong random string; `openssl rand -hex 32`)
   — signs the OAuth state cookie.

---

## §E. The other REQUIRED prod secrets

These block the build (§0). Most are likely already set from the beta deploy — verify first
with `vercel env ls production`.

### §E.1 `DATABASE_URL` — Neon production branch
- Neon dashboard → **familyapp** project → **production** branch → connection string (pooled).
- ⚠️ Must be the **production** branch, not the abandoned dev branch — JIT provisioning writes
  real users here. Confirm migrations ran (`db:migrate` runs in the Vercel build).

### §E.2 `R2_*` — Cloudflare R2 media storage (all four together)
- Cloudflare dashboard → **R2** → create bucket (e.g. `chronicle-media`) → `R2_BUCKET`.
- Account ID (R2 overview) → `R2_ACCOUNT_ID`.
- **Manage R2 API Tokens → Create** (Object Read & Write) → `R2_ACCESS_KEY_ID` +
  `R2_SECRET_ACCESS_KEY`.
- Partial config **throws** (`selectMediaStorage` fails loud) — set all four or none.

### §E.3 `GROQ_API_KEY` — transcription + LLM
- console.groq.com → API Keys → create. Without it, prod **silently falls back to scripted
  mocks** (no real transcription/story rendering) — so this matters for a real beta.

### §E.4 `ALBUM_UPLOAD_TICKET_SECRET` — HMAC for #20 upload tickets
- Generate: `openssl rand -hex 32`. `upload-ticket.ts` **throws in prod** without it (this
  was the outage that motivated the build gate). Any strong random string.

### §E.5 `INNGEST_*` — durable job queue
- Inngest dashboard → your app → **EVENT_KEY** and **SIGNING_KEY**. The transcribe→render
  pipeline runs on this; without it durable jobs don't process. Confirm the Inngest app is
  synced to the prod deployment URL.

---

## §F. Vercel — set env, flip, redeploy

1. Set every §0 REQUIRED var + your chosen RECOMMENDED/feature vars on the **Production**
   environment. Dashboard (Settings → Environment Variables) or CLI:
   ```bash
   vercel env ls production                       # see what already exists
   vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
   vercel env add CLERK_SECRET_KEY production
   vercel env add CLERK_WEBHOOK_SIGNING_SECRET production
   vercel env add APP_BASE_URL production          # https://tellmeagain.app
   # …and any missing R2_* / GROQ_API_KEY / INNGEST_* / ALBUM_UPLOAD_TICKET_SECRET
   ```
   Prefer the dashboard for the secret key if you don't want values in shell history.
2. **The flip:** `isClerkConfigured()` returns true only when *both* Clerk keys carry real
   `pk_live_`/`sk_live_` prefixes — so setting them **is** what activates real Clerk (mock
   auth drops). Placeholders like `test` do **not** activate it (intentional).
3. **Redeploy Production** (env changes need a fresh build). The build runs `check-env.mjs` +
   the schema-parity gate first — a red build here means a missing required var; read the log,
   it names each one.

---

## §G. Verify on production (`https://tellmeagain.app`)

1. **Sign-up** a brand-new real email → completes; name captured.
2. **Sign-in** → lands `/hub`.
3. **Magic-link redeem** (`/auth/redeem`) works.
4. **JIT provisioning:** first landing created Account + Person in the **prod Neon** DB.
5. **Webhook:** rename that user in the Clerk dashboard → `user.updated` delivery returns 200
   and the Account row updates (Vercel function logs show `[webhooks/clerk] handled event`).
6. **Capture path (Groq/Inngest/R2):** record a story → transcription + render complete (not
   the scripted mock) → media persists (R2), survives a redeploy.
7. **Album upload (#20 / ticket secret):** upload a real photo file → tile does **not** go to
   "Tap to retry."
8. (If §D) **Google Photos:** connect → picker → import lands in the album.
9. Tick issue #9's acceptance boxes and close it.

**Rollback:** placeholder/unset the two Clerk keys → `isClerkConfigured()` false → app falls
back to mock auth. No data migration needed.

---

## §H. (OPTIONAL) Pre-create real beta accounts

`+clerk_test` fixtures do NOT work in prod — never seed those. To pre-create **real** beta
accounts (so they exist before first login) use the Backend API with your `sk_live_` key.
Real emails only; magic-link app so no password needed; emails come out auto-verified.

`scripts/seed-clerk-prod-users.ts` — run `CLERK_SECRET_KEY=sk_live_... tsx scripts/seed-clerk-prod-users.ts`:
```ts
const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET?.startsWith("sk_live_")) throw new Error("Refusing without a sk_live_ prod key.");

// Real beta emails — EDIT. Never +clerk_test.
const USERS: Array<{ email: string; firstName?: string; lastName?: string }> = [
  // { email: "grandma@example.com", firstName: "Eleanor", lastName: "Marino" },
];

for (const u of USERS) {
  const res = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: [u.email],
      first_name: u.firstName,
      last_name: u.lastName,
      skip_password_requirement: true,
    }),
  });
  console.log(res.ok ? `created: ${u.email}` : `FAILED: ${u.email} ${res.status} ${await res.text()}`);
}
```
This does **not** email anyone — send beta folks the `tellmeagain.app` link so they trigger
their own magic-link sign-in. Simplest of all: skip §H and just let them self-sign-up (JIT
handles the DB rows).

---

## Master checklist

- [ ] §0 Verified full prod env inventory (`vercel env ls production`); know what's missing
- [ ] §A dev acceptance green (Name required, 5 test users, core loop)
- [ ] §B prod Clerk instance created
- [ ] §B Clerk DNS records added in Vercel DNS; Clerk **Verified**
- [ ] §B apex `tellmeagain.app` added as Vercel project domain
- [ ] §B prod webhook + `CLERK_WEBHOOK_SIGNING_SECRET`
- [ ] §C social OAuth decided (OFF for beta, or custom creds per provider)
- [ ] §D Google Photos OAuth (or explicitly deferred — feature stays hidden)
- [ ] §E R2 (×4) / Groq / Inngest (×2) / ticket secret confirmed on Production
- [ ] §E.1 `DATABASE_URL` = Neon **production** branch, migrated
- [ ] §F `pk_live_`/`sk_live_` set; `APP_BASE_URL=https://tellmeagain.app`; redeploy green
- [ ] §G all verify steps pass on `tellmeagain.app`
- [ ] §H (optional) beta accounts pre-created
- [ ] Close #9
