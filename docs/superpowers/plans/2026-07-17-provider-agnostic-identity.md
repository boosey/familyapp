# Provider-Agnostic Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor identity on a portable verified contact (email) and make the auth vendor's user id a swappable pointer, so a login is matched by verified email when its vendor id is unknown — healing dev→prod duplicates, surviving Clerk deletion and vendor switches, without ever letting an unverified contact adopt an existing account.

**Architecture:** Two new tables — `account_identities` (`(provider, provider_user_id)` unique; `provider` = the auth *vendor* e.g. `clerk`) and `account_contacts` (`(kind, value)` unique; `verified_at` NULL = never a match key). Resolution: known identity → verified-email attach → create. `accounts` stays the spine; `accounts.auth_provider_user_id` becomes vestigial (dropped in a later migration).

**Tech Stack:** Drizzle ORM, PGlite (in-process Postgres for tests), Vitest, Next.js 15, pnpm workspaces. Spec: `docs/superpowers/specs/2026-07-17-provider-agnostic-identity-design.md`.

---

## File Structure

- `packages/db/src/schema.ts` — add `accountIdentities`, `accountContacts` tables + type exports (after the `accounts` table, ~line 320).
- `packages/db/drizzle/migrations/NNNN_*.sql` — generated CREATE TABLE + **hand-added** backfill.
- `packages/core/src/accounts.ts` — add `resolveAccountByIdentity`, `resolveAccountIdByVerifiedEmail`, `attachIdentity`; extend `createAccountWithPerson`; repoint `reconcileAccountProfile` / `deactivateAccountByAuthProviderUserId` to identities.
- `packages/core/src/index.ts` — export the new functions.
- `apps/web/lib/clerk-server.ts` — extend `ClerkUserLite` with verified emails; rewrite `provisionOrResolveClerkUser` to the 4-step engine.
- `apps/web/lib/auth-clerk.ts` — `resolvePersonRow` + `resolveAuthProviderUserId` resolve through `account_identities`.
- Tests alongside each package's existing suites (PGlite harness as in `packages/core/test/accounts.test.ts`).

---

## Task 1: Schema — add `account_identities` and `account_contacts`

**Files:**
- Modify: `packages/db/src/schema.ts` (insert after the `accounts` table, ~line 320; add type exports near line 1659)
- Generate: `packages/db/drizzle/migrations/NNNN_*.sql`, `packages/db/drizzle/schema.sql`
- Test: `packages/db/test/account-identity-contacts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/account-identity-contacts.test.ts` (follow the PGlite bootstrap in `packages/db/test/invariants.test.ts`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb } from "./helpers"; // same helper the other db tests use
import { accounts, accountIdentities, accountContacts } from "../src/schema";

describe("account_identities / account_contacts", () => {
  let db: Awaited<ReturnType<typeof makeTestDb>>;
  beforeEach(async () => { db = await makeTestDb(); });

  it("stores an identity and enforces (provider, provider_user_id) uniqueness", async () => {
    const [acct] = await db.insert(accounts)
      .values({ authProviderUserId: "user_a", email: "a@x.com" }).returning();
    await db.insert(accountIdentities)
      .values({ accountId: acct!.id, provider: "clerk", providerUserId: "user_a" });
    await expect(
      db.insert(accountIdentities)
        .values({ accountId: acct!.id, provider: "clerk", providerUserId: "user_a" }),
    ).rejects.toThrow();
  });

  it("enforces (kind, value) uniqueness on contacts", async () => {
    const [a1] = await db.insert(accounts).values({ authProviderUserId: "u1", email: "one@x.com" }).returning();
    const [a2] = await db.insert(accounts).values({ authProviderUserId: "u2", email: "two@x.com" }).returning();
    await db.insert(accountContacts).values({ accountId: a1!.id, kind: "email", value: "shared@x.com", verifiedAt: new Date() });
    await expect(
      db.insert(accountContacts).values({ accountId: a2!.id, kind: "email", value: "shared@x.com", verifiedAt: new Date() }),
    ).rejects.toThrow();
  });
});
```

> If `./helpers`/`makeTestDb` differ in name, use whatever the sibling tests in `packages/db/test/` import — match the existing harness exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/db exec vitest run test/account-identity-contacts.test.ts`
Expected: FAIL — `accountIdentities`/`accountContacts` not exported from `../src/schema`.

- [ ] **Step 3: Add the tables to `schema.ts`**

Insert immediately after the `accounts` table definition (after the closing `);` near line 320):

```ts
// ---------------------------------------------------------------------------
// account_identities — a login credential from ONE auth VENDOR (provider='clerk',
// NOT 'google'/'sms'). Google/password/SMS inside Clerk still yield ONE Clerk user
// id → one row. A second row only appears on a vendor switch or a dev+prod overlap.
// The vendor id is a swappable POINTER; the durable identity is the Account + its
// verified contacts. UNIQUE(provider, provider_user_id) makes the concurrent-attach
// race safe (loser trips the constraint and re-resolves the winner).
// ---------------------------------------------------------------------------
export const accountIdentities = pgTable(
  "account_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_identities_provider_user_uq").on(t.provider, t.providerUserId),
    index("account_identities_account_id_idx").on(t.accountId),
  ],
);

// ---------------------------------------------------------------------------
// account_contacts — portable, verified match keys for a login. `verified_at` NULL
// means unverified and is NEVER a match key (an unverified contact must never adopt
// an existing account). UNIQUE(kind, value) guarantees a verified contact maps to at
// most one account. v1 matches kind='email' only; 'phone' is accepted but inert.
// ---------------------------------------------------------------------------
export const accountContacts = pgTable(
  "account_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_contacts_kind_value_uq").on(t.kind, t.value),
    index("account_contacts_account_id_idx").on(t.accountId),
  ],
);
```

Add type exports next to `export type Account = ...` (near line 1659):

```ts
export type AccountIdentity = typeof accountIdentities.$inferSelect;
export type NewAccountIdentity = typeof accountIdentities.$inferInsert;
export type AccountContact = typeof accountContacts.$inferSelect;
export type NewAccountContact = typeof accountContacts.$inferInsert;
```

- [ ] **Step 4: Regenerate snapshot + migration**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: a new `drizzle/migrations/NNNN_*.sql` with `CREATE TABLE account_identities` + `account_contacts` and their unique indexes, and an updated `drizzle/schema.sql`.

- [ ] **Step 5: Hand-add the backfill to the emitted migration**

Append to the new `NNNN_*.sql`, AFTER the `CREATE TABLE`/index statements:

```sql
-- Backfill: every existing account becomes matchable by its (clerk) id and verified email.
INSERT INTO account_identities (account_id, provider, provider_user_id)
SELECT id, 'clerk', auth_provider_user_id FROM accounts
ON CONFLICT (provider, provider_user_id) DO NOTHING;

INSERT INTO account_contacts (account_id, kind, value, verified_at)
SELECT id, 'email', lower(trim(email)), now()
FROM accounts
WHERE email IS NOT NULL AND length(trim(email)) > 0
ON CONFLICT (kind, value) DO NOTHING;
```

> The `ON CONFLICT DO NOTHING` is defensive: post-cleanup all prod emails are distinct, so nothing is dropped. If a real duplicate-email pair is ever present, it must be reconciled BEFORE this migration — do not let it silently drop; call it out in the deploy step.

- [ ] **Step 6: Run test + drift guard**

Run: `pnpm --filter @chronicle/db exec vitest run test/account-identity-contacts.test.ts`
Expected: PASS.
Run: `pnpm --filter @chronicle/db test`
Expected: PASS — including `test/migration-drift.test.ts` (backfill is a no-op on the empty replay, so snapshot ↔ migration chain stay bonded).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/ packages/db/test/account-identity-contacts.test.ts
git commit -m "feat(db): account_identities + account_contacts tables + backfill"
```

---

## Task 2: Core — identity/contact resolution primitives

**Files:**
- Modify: `packages/core/src/accounts.ts`
- Modify: `packages/core/src/index.ts` (export new functions)
- Test: `packages/core/test/accounts-identity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/accounts-identity.test.ts` (use the PGlite harness from `packages/core/test/accounts.test.ts`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestDb } from "./helpers"; // match accounts.test.ts import
import {
  createAccountWithPerson,
  resolveAccountByIdentity,
  resolveAccountIdByVerifiedEmail,
  attachIdentity,
} from "../src";

describe("identity/contact resolution", () => {
  let db: Awaited<ReturnType<typeof makeTestDb>>;
  beforeEach(async () => { db = await makeTestDb(); });

  it("createAccountWithPerson writes a clerk identity and a verified email contact", async () => {
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk", authProviderUserId: "user_1",
      email: "Test@X.com", emailVerified: true, displayName: "Test User",
    });
    const byId = await resolveAccountByIdentity(db, "clerk", "user_1");
    expect(byId?.personId).toBe(personId);
    // normalized + verified → matchable
    const acctId = await resolveAccountIdByVerifiedEmail(db, "test@x.com");
    expect(acctId).not.toBeNull();
  });

  it("an UNVERIFIED email is NOT a match key", async () => {
    await createAccountWithPerson(db, {
      provider: "clerk", authProviderUserId: "user_2",
      email: "unv@x.com", emailVerified: false, displayName: "Unv User",
    });
    expect(await resolveAccountIdByVerifiedEmail(db, "unv@x.com")).toBeNull();
  });

  it("attachIdentity adds a second vendor id to the same account (idempotent)", async () => {
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk", authProviderUserId: "dev_id",
      email: "z@x.com", emailVerified: true, displayName: "Zed",
    });
    const acctId = await resolveAccountIdByVerifiedEmail(db, "z@x.com");
    await attachIdentity(db, acctId!, "clerk", "prod_id");
    await attachIdentity(db, acctId!, "clerk", "prod_id"); // idempotent
    expect((await resolveAccountByIdentity(db, "clerk", "prod_id"))?.personId).toBe(personId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/core exec vitest run test/accounts-identity.test.ts`
Expected: FAIL — `resolveAccountByIdentity` (and siblings) not exported; `createAccountWithPerson` has no `provider`/`emailVerified`.

- [ ] **Step 3: Extend `createAccountWithPerson` and add the primitives**

In `packages/core/src/accounts.ts`, update the imports and the `SignUpAccountInput` interface:

```ts
import { and, eq, isNotNull } from "drizzle-orm";
import { accounts, persons, accountIdentities, accountContacts } from "@chronicle/db/schema";
```

```ts
export interface SignUpAccountInput {
  /** The auth VENDOR (e.g. "clerk"). */
  provider: string;
  /** The vendor's opaque user id. */
  authProviderUserId: string;
  email: string;
  /** Whether the provider VERIFIED this email. Only a verified email becomes a match key. */
  emailVerified: boolean;
  displayName: string;
  spokenName?: string;
}
```

Inside the `db.transaction` of `createAccountWithPerson`, after the `person` insert and before `return`, add the identity + contact rows (keep the existing `accounts.auth_provider_user_id` write for rollback safety):

```ts
    await tx.insert(accountIdentities).values({
      accountId: account!.id,
      provider: input.provider,
      providerUserId: input.authProviderUserId,
    });

    const normEmail = input.email.trim().toLowerCase();
    if (normEmail.length > 0) {
      await tx.insert(accountContacts).values({
        accountId: account!.id,
        kind: "email",
        value: normEmail,
        verifiedAt: input.emailVerified ? new Date() : null,
      });
    }
```

Append the three new functions at the end of the file:

```ts
/** Resolve a vendor identity to its ACTIVE account's Person, or null. */
export async function resolveAccountByIdentity(
  db: Database,
  provider: string,
  providerUserId: string,
): Promise<{ personId: string } | null> {
  const [row] = await db
    .select({ personId: persons.id })
    .from(accountIdentities)
    .innerJoin(accounts, eq(accounts.id, accountIdentities.accountId))
    .innerJoin(persons, eq(persons.accountId, accounts.id))
    .where(and(
      eq(accountIdentities.provider, provider),
      eq(accountIdentities.providerUserId, providerUserId),
      eq(accounts.active, true),
    ))
    .limit(1);
  return row ?? null;
}

/** Resolve a VERIFIED email to its ACTIVE account id, or null. Unverified never matches. */
export async function resolveAccountIdByVerifiedEmail(
  db: Database,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const [row] = await db
    .select({ accountId: accounts.id })
    .from(accountContacts)
    .innerJoin(accounts, eq(accounts.id, accountContacts.accountId))
    .where(and(
      eq(accountContacts.kind, "email"),
      eq(accountContacts.value, normalized),
      isNotNull(accountContacts.verifiedAt),
      eq(accounts.active, true),
    ))
    .limit(1);
  return row?.accountId ?? null;
}

/** Attach a vendor identity to an existing account. Idempotent (no-op on conflict). */
export async function attachIdentity(
  db: Database,
  accountId: string,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await db
    .insert(accountIdentities)
    .values({ accountId, provider, providerUserId })
    .onConflictDoNothing({
      target: [accountIdentities.provider, accountIdentities.providerUserId],
    });
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, add to the accounts re-export line(s):

```ts
export {
  createAccountWithPerson,
  findPersonIdByAuthProviderUserId,
  reconcileAccountProfile,
  deactivateAccountByAuthProviderUserId,
  resolveAccountByIdentity,
  resolveAccountIdByVerifiedEmail,
  attachIdentity,
} from "./accounts";
```

> Match the existing export style in `index.ts` — if accounts is re-exported via `export * from "./accounts"`, no change is needed here.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/core exec vitest run test/accounts-identity.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix the now-broken `createAccountWithPerson` callers**

`createAccountWithPerson` now requires `provider` + `emailVerified`. Run typecheck to find every caller:

Run: `pnpm -r typecheck`
Expected: errors in `apps/web/lib/clerk-server.ts`, `apps/web/lib/auth-mock.ts`, and test files calling `createAccountWithPerson`.

For **test/seed callers** update each call to add `provider: "clerk", emailVerified: true`. (Task 3 handles `clerk-server.ts` properly; for now add the two fields so it compiles.) In `auth-mock.ts` add `provider: "mock", emailVerified: true`.

- [ ] **Step 7: Run test + typecheck**

Run: `pnpm --filter @chronicle/core test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/accounts.ts packages/core/src/index.ts packages/core/test/accounts-identity.test.ts apps/web/lib/auth-mock.ts
git commit -m "feat(core): identity/contact resolution + verified-email match primitives"
```

---

## Task 3: Rewrite JIT provisioning to the 4-step engine

**Files:**
- Modify: `apps/web/lib/clerk-server.ts`
- Test: `apps/web/__tests__/clerk-server.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/__tests__/clerk-server.test.ts` (reuse its PGlite harness + `getClerkUser` stub pattern):

```ts
it("STEP 2: unknown vendor id + verified matching email attaches to the existing account", async () => {
  // existing account keyed to an OLD (dev) clerk id, verified email on file
  const { personId } = await createAccountWithPerson(db, {
    provider: "clerk", authProviderUserId: "dev_zzz",
    email: "zach@x.com", emailVerified: true, displayName: "Zach B",
  });
  const stub = async (_id: string) => ({
    id: "prod_zzz", firstName: "Zach", lastName: "B",
    primaryEmailAddress: { emailAddress: "zach@x.com" },
    emailAddresses: [{ emailAddress: "zach@x.com", verified: true }],
  });
  const resolved = await provisionOrResolveClerkUser(db, "prod_zzz", { getClerkUser: stub });
  expect(resolved).toBe(personId); // SAME person, no duplicate
});

it("SECURITY: unknown vendor id + UNVERIFIED matching email does NOT attach — new account", async () => {
  const { personId } = await createAccountWithPerson(db, {
    provider: "clerk", authProviderUserId: "dev_www",
    email: "eve@x.com", emailVerified: true, displayName: "Eve",
  });
  const attacker = async (_id: string) => ({
    id: "prod_attacker", firstName: "Not", lastName: "Eve",
    primaryEmailAddress: { emailAddress: "eve@x.com" },
    emailAddresses: [{ emailAddress: "eve@x.com", verified: false }], // UNVERIFIED
  });
  const resolved = await provisionOrResolveClerkUser(db, "prod_attacker", { getClerkUser: attacker });
  expect(resolved).not.toBe(personId); // a SEPARATE account, no takeover
});

it("STEP 1: a known vendor id fast-paths to its person with no new rows", async () => {
  const { personId } = await createAccountWithPerson(db, {
    provider: "clerk", authProviderUserId: "known_id",
    email: "k@x.com", emailVerified: true, displayName: "Kay",
  });
  const stub = async (_id: string) => { throw new Error("must not fetch Clerk on fast path"); };
  expect(await provisionOrResolveClerkUser(db, "known_id", { getClerkUser: stub })).toBe(personId);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/clerk-server.test.ts`
Expected: FAIL — provisioning still id-only; `emailAddresses` unknown on the stub type.

- [ ] **Step 3: Extend `ClerkUserLite` + `defaultGetClerkUser`**

In `apps/web/lib/clerk-server.ts`:

```ts
export interface ClerkEmail {
  emailAddress: string;
  /** True only when the provider marks this email verified — the sole match-key gate. */
  verified: boolean;
}

export interface ClerkUserLite {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
  /** ALL emails with verification status — the candidate match keys for linking. */
  emailAddresses: ClerkEmail[];
}
```

In `defaultGetClerkUser`, map the verification status (Clerk exposes `emailAddress.verification.status`):

```ts
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    primaryEmailAddress: user.primaryEmailAddress
      ? { emailAddress: user.primaryEmailAddress.emailAddress }
      : null,
    emailAddresses: (user.emailAddresses ?? []).map((e) => ({
      emailAddress: e.emailAddress,
      verified: e.verification?.status === "verified",
    })),
  };
```

> Confirm `verification.status === "verified"` against current Clerk Backend SDK docs before shipping — this flag is the security linchpin. If the field differs, fix the mapping here (the rest of the engine is agnostic).

- [ ] **Step 4: Rewrite `provisionOrResolveClerkUser`**

Replace the body with the 4-step engine. Update the import to pull the new primitives:

```ts
import {
  createAccountWithPerson,
  resolveAccountByIdentity,
  resolveAccountIdByVerifiedEmail,
  attachIdentity,
} from "@chronicle/core";
```

```ts
export async function provisionOrResolveClerkUser(
  db: Database,
  userId: string,
  opts: { getClerkUser?: GetClerkUser } = {},
): Promise<string> {
  const PROVIDER = "clerk";

  // 1. Known identity → fast path.
  const known = await resolveAccountByIdentity(db, PROVIDER, userId);
  if (known) return known.personId;

  const getClerkUser = opts.getClerkUser ?? defaultGetClerkUser;
  const user = await getClerkUser(userId);
  const displayName = clerkDisplayName(user);
  const primaryEmail = user.primaryEmailAddress?.emailAddress ?? "";
  const verifiedEmails = user.emailAddresses.filter((e) => e.verified).map((e) => e.emailAddress);

  // 2. Unknown id but a VERIFIED email matches an existing account → attach + resolve.
  for (const email of verifiedEmails) {
    const accountId = await resolveAccountIdByVerifiedEmail(db, email);
    if (accountId) {
      await attachIdentity(db, accountId, PROVIDER, userId);
      const attached = await resolveAccountByIdentity(db, PROVIDER, userId);
      if (attached) return attached.personId;
    }
  }

  // 3. Otherwise create a fresh account (identity + contact written inside).
  try {
    const { personId } = await createAccountWithPerson(db, {
      provider: PROVIDER,
      authProviderUserId: userId,
      email: primaryEmail,
      emailVerified: verifiedEmails.includes(primaryEmail),
      displayName,
    });
    return personId;
  } catch (err) {
    // Concurrent landing provisioned this id between our checks — re-resolve by identity.
    const retry = await resolveAccountByIdentity(db, PROVIDER, userId);
    if (retry) return retry.personId;
    throw err;
  }
}
```

Delete the now-unused `findPersonIdByAuthProviderUserId` import if nothing else in the file uses it (typecheck will flag it).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/clerk-server.test.ts`
Expected: PASS — including the SECURITY (unverified) and STEP 2 (heal) tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/clerk-server.ts apps/web/__tests__/clerk-server.test.ts
git commit -m "feat(web): verified-email account linking in JIT provisioning (model B)"
```

---

## Task 4: Switch the auth read path to identities

**Files:**
- Modify: `apps/web/lib/auth-clerk.ts`
- Test: `apps/web/__tests__/auth-clerk.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/__tests__/auth-clerk.test.ts` (its helper `createAccountWithPerson`-style seed writes an identity now, so add one asserting resolution via a SECOND attached identity):

```ts
it("resolves a session for an identity attached AFTER account creation (healed account)", async () => {
  const { personId, accountId } = await createAccountWithPerson(db, {
    provider: "clerk", authProviderUserId: "dev_old",
    email: "h@x.com", emailVerified: true, displayName: "Healed",
  });
  await attachIdentity(db, accountId, "clerk", "prod_new");
  const provider = createClerkAuthProvider(db, { auth: async () => ({ userId: "prod_new" }) });
  expect(await provider.getCurrentAuthContext()).toEqual({ kind: "account", personId });
});
```

> If the local `createAccountWithPerson` helper in this test file returns only `personId`, extend it to also return `accountId`, or fetch the account id via `resolveAccountIdByVerifiedEmail(db, "h@x.com")`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/auth-clerk.test.ts`
Expected: FAIL — `resolvePersonRow` still joins `accounts.auth_provider_user_id`, so the second (attached) id `prod_new` resolves to anonymous.

- [ ] **Step 3: Repoint `resolvePersonRow` through `account_identities`**

In `apps/web/lib/auth-clerk.ts`, update the import and the query inside `resolvePersonRow`:

```ts
import { accounts, persons, accountIdentities } from "@chronicle/db/schema";
```

```ts
      const [row] = await db
        .select({ personId: persons.id })
        .from(accountIdentities)
        .innerJoin(accounts, eq(accounts.id, accountIdentities.accountId))
        .innerJoin(persons, eq(persons.accountId, accounts.id))
        .where(and(
          eq(accountIdentities.provider, "clerk"),
          eq(accountIdentities.providerUserId, userId),
          eq(accounts.active, true),
        ))
        .limit(1);
      return row ?? null;
```

- [ ] **Step 4: Repoint `resolveAuthProviderUserId` (magic-link mint) to identities**

This returns the vendor id to mint a Clerk sign-in ticket for a Person. A healed account may hold MORE THAN ONE clerk identity (dead dev id + live prod id); mint for the **newest**, which is the current-instance one. Add `desc` to the drizzle import and rewrite:

```ts
import { and, desc, eq } from "drizzle-orm";
```

```ts
export async function resolveAuthProviderUserId(
  db: Database,
  personId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ providerUserId: accountIdentities.providerUserId })
    .from(persons)
    .innerJoin(accounts, eq(accounts.id, persons.accountId))
    .innerJoin(accountIdentities, and(
      eq(accountIdentities.accountId, accounts.id),
      eq(accountIdentities.provider, "clerk"),
    ))
    .where(and(eq(persons.id, personId), eq(accounts.active, true)))
    .orderBy(desc(accountIdentities.createdAt))
    .limit(1);
  return row?.providerUserId ?? null;
}
```

> Known limitation (documented in the spec): the newest-identity heuristic assumes the most recently attached clerk id is the live-instance one. A proper fix prunes dead identities on heal — deferred.

- [ ] **Step 4b: Update direct-seed test helpers (cross-cutting)**

Switching `resolvePersonRow` to `account_identities` breaks any test that seeds an `accounts` row **directly** without an identity row. Find them:

Run: `pnpm dlx rg -l "insert\(accounts\)" apps/web/__tests__ packages/core/test`
Expected hits include `auth-clerk.test.ts`, `auth-mock.test.ts`, `clerk-webhook.test.ts` (its `acct()` helper), `clerk-server.test.ts`.

For each local seed helper that inserts `accounts` + `persons` by hand, also insert the matching identity (and a contact if the test matches by email). Minimal fix inside each helper, right after the `accounts` insert:

```ts
await db.insert(accountIdentities).values({
  accountId: account.id, provider: "clerk", providerUserId: /* the same id the helper used */,
});
```

Prefer switching these helpers to call `createAccountWithPerson` (which now writes identity + contact) where the test doesn't specifically need a hand-built row.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/auth-clerk.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/auth-clerk.ts apps/web/__tests__/auth-clerk.test.ts
git commit -m "feat(web): resolve auth sessions + magic-link mint through account_identities"
```

---

## Task 5: Repoint the Clerk webhook reconcilers to identities

**Files:**
- Modify: `packages/core/src/accounts.ts` (`reconcileAccountProfile`, `deactivateAccountByAuthProviderUserId`)
- Test: `apps/web/__tests__/clerk-webhook.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/__tests__/clerk-webhook.test.ts`:

```ts
it("reconciles/deactivates by an ATTACHED identity, not just the creation id", async () => {
  const { personId, accountId } = await createAccountWithPerson(db, {
    provider: "clerk", authProviderUserId: "dev_id9",
    email: "w9@x.com", emailVerified: true, displayName: "Old Name",
  });
  await attachIdentity(db, accountId, "clerk", "prod_id9");
  const r = await reconcileAccountProfile(db, {
    authProviderUserId: "prod_id9", displayName: "New Name", email: "w9@x.com",
  });
  expect(r).toEqual({ matched: true, personId });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/clerk-webhook.test.ts`
Expected: FAIL — reconciler looks up `accounts.auth_provider_user_id`, which never held `prod_id9`.

- [ ] **Step 3: Resolve the account via identities in both reconcilers**

In `packages/core/src/accounts.ts`, in BOTH `reconcileAccountProfile` and `deactivateAccountByAuthProviderUserId`, replace the opening `accounts`-by-`authProviderUserId` lookup with an identity lookup. For `reconcileAccountProfile`:

```ts
    const [ident] = await tx
      .select({ accountId: accountIdentities.accountId })
      .from(accountIdentities)
      .where(and(
        eq(accountIdentities.provider, "clerk"),
        eq(accountIdentities.providerUserId, input.authProviderUserId),
      ))
      .limit(1);
    if (!ident) return { matched: false };
    const account = { id: ident.accountId };
```

Do the same substitution in `deactivateAccountByAuthProviderUserId` (it flips `accounts.active=false` on `account.id` — unchanged after this lookup). The rest of both function bodies (the `accounts`/`persons` updates keyed on `account.id`) stays as-is.

> `deactivate` still severs the whole account (all its identities) — correct: a Clerk `user.deleted` removes that vendor login, and the account-level `active=false` gate already blocks every identity via the `eq(accounts.active, true)` filters added in Task 2–4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/clerk-webhook.test.ts && pnpm --filter @chronicle/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/accounts.ts apps/web/__tests__/clerk-webhook.test.ts
git commit -m "feat(core): reconcile/deactivate Clerk webhooks via account_identities"
```

---

## Task 6: Full-suite green + deploy checklist

**Files:** none (verification + deploy)

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r test && pnpm -r lint`
Expected: PASS across all packages. Fix any remaining `createAccountWithPerson` callers still missing `provider`/`emailVerified`.

- [ ] **Step 2: Architecture test**

Run: `pnpm --filter @chronicle/core exec vitest run test/architecture.test.ts`
Expected: PASS — new tables are auth plumbing (not Story/Media content); no content-front-door allowlist change needed.

- [ ] **Step 3: Deploy (migration runs in the Vercel build)**

Merge to `master`. The Vercel build runs `db:migrate` against prod Neon (`br-wispy-resonance-ats2pprr`), creating the tables and running the backfill. **Before merge**, re-confirm prod has no duplicate-email accounts (`SELECT lower(trim(email)), count(*) FROM accounts GROUP BY 1 HAVING count(*)>1;` → 0 rows), so the backfill drops nothing.

- [ ] **Step 4: Post-deploy verification**

After deploy, confirm the backfill:
`SELECT (SELECT count(*) FROM accounts) AS accts, (SELECT count(*) FROM account_identities) AS ids, (SELECT count(*) FROM account_contacts) AS contacts;`
Expected: `ids == accts` and `contacts == accts` (every account got one clerk identity + one email contact).

- [ ] **Step 5: Confirm Zachary heals (the acceptance case)**

Have Zachary sign into prod. Expected: he lands in his EXISTING account (story "Boston" present), and `account_identities` now has a second `clerk` row for his account (dev + prod). No duplicate Person created.

---

## Deferred (separate follow-up plans)

- **Drop `accounts.auth_provider_user_id`** — a later migration once the identity path is proven in prod (kept nullable for one release for rollback).
- **Prune dead identities** on heal (removes the newest-identity heuristic in `resolveAuthProviderUserId`).
- **Phone/SMS matching** — flip on `kind='phone'` in `resolveAccountIdByVerifiedEmail`'s sibling + design account-merge for the ambiguous multi-contact case.
- **Person-erasure carve-out** for `kinship_assertions` (ADR-0016 gap surfaced during the John/Alex cleanup).
