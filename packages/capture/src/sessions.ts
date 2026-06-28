/**
 * Elder sessions — the login-free entry. A long, unguessable token IS the elder's identity for
 * the duration of a session (the literal implementation of "the elder never feels they are using
 * software"). The raw token is sent in the invite link and never stored; only its SHA-256 hash
 * lives in the DB, so a database leak does not expose working links.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { AuthorizationError, isActiveMember } from "@chronicle/core";
import { elderSessions } from "@chronicle/db/schema";
import type { Database, ElderSession } from "@chronicle/db";

const DEFAULT_TTL_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/** SHA-256 of the raw token. Lookups hash the incoming token and match on this. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface CreateElderSessionInput {
  /** The elder this token speaks for. */
  personId: string;
  /** The inviting family context. */
  familyId: string;
  /** The family member who generated the invite. */
  invitedByPersonId: string;
  /** Days until expiry; `null` for a non-expiring link. Defaults to 30 days. */
  ttlDays?: number | null;
  now?: Date;
}

export interface CreatedElderSession {
  /** The raw token — returned ONCE, to be embedded in the invite link. Never persisted. */
  token: string;
  session: ElderSession;
}

export async function createElderSession(
  db: Database,
  input: CreateElderSessionInput,
): Promise<CreatedElderSession> {
  const token = randomBytes(32).toString("base64url"); // 256 bits of entropy
  const tokenHash = hashToken(token);
  const now = input.now ?? new Date();
  const ttl = input.ttlDays === undefined ? DEFAULT_TTL_DAYS : input.ttlDays;
  const expiresAt = ttl === null ? null : new Date(now.getTime() + ttl * MS_PER_DAY);

  // The family-membership gate lives here, in the domain — not in the UI that calls it. Both the
  // inviter (who is minting the link) and the elder (the narrator the link speaks for) must hold an
  // ACTIVE membership in this family. One transaction so the two checks and the insert see a
  // consistent snapshot — a membership revoked between check and write cannot slip a session
  // through (mirrors createInvitation's gate in @chronicle/core).
  return db.transaction(async (tx) => {
    const inviterIsMember = await isActiveMember(
      tx,
      input.invitedByPersonId,
      input.familyId,
    );
    if (!inviterIsMember) {
      throw new AuthorizationError(
        "only an active member of the family may create an elder session",
      );
    }
    const elderIsMember = await isActiveMember(tx, input.personId, input.familyId);
    if (!elderIsMember) {
      throw new AuthorizationError(
        "the elder must be an active member of the family the session is created in",
      );
    }

    const [session] = await tx
      .insert(elderSessions)
      .values({
        tokenHash,
        personId: input.personId,
        familyId: input.familyId,
        invitedByPersonId: input.invitedByPersonId,
        expiresAt,
      })
      .returning();

    return { token, session: session! };
  });
}

export interface ResolvedElderSession {
  session: ElderSession;
  /** The elder's Person id — becomes the AuthContext for the token-scoped surface. */
  personId: string;
  familyId: string;
}

/**
 * Resolve a raw token to its elder + family, or null if the token is unknown, revoked, or
 * expired. On success, records last-used (best effort). A null result must fail warmly toward the
 * inviting human, never toward the elder (the caller's responsibility in the UI).
 */
export async function resolveElderSession(
  db: Database,
  rawToken: string,
  opts: { now?: Date } = {},
): Promise<ResolvedElderSession | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const [session] = await db
    .select()
    .from(elderSessions)
    .where(eq(elderSessions.tokenHash, tokenHash))
    .limit(1);
  if (!session) return null;
  if (session.revokedAt) return null;

  const now = opts.now ?? new Date();
  if (session.expiresAt && session.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  // Best-effort timestamp update. The elder page is logically a READ; a transient write failure
  // here must never 500 the elder's greeting. The next successful resolve will catch it up.
  try {
    await db
      .update(elderSessions)
      .set({ lastUsedAt: now })
      .where(eq(elderSessions.id, session.id));
  } catch {
    // swallow — see comment above.
  }

  return { session, personId: session.personId, familyId: session.familyId };
}

export async function revokeElderSession(
  db: Database,
  sessionId: string,
  opts: { now?: Date } = {},
): Promise<void> {
  await db
    .update(elderSessions)
    .set({ revokedAt: opts.now ?? new Date() })
    .where(eq(elderSessions.id, sessionId));
}
