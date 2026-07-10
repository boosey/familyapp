/**
 * Google Photos connection vault (ADR-0009 Phase 5).
 *
 * Open-schema table `google_photos_connections` (PK = personId). Encrypt/decrypt at this boundary
 * via `@chronicle/photos-google` — plaintext refresh tokens never leave memory / never hit the DB.
 */
import { and, eq, isNull } from "drizzle-orm";
import { decryptToken, encryptToken } from "@chronicle/photos-google";
import type { Database, GooglePhotosConnection } from "@chronicle/db";
import { googlePhotosConnections } from "@chronicle/db/schema";
import { getGooglePhotosEncryptionKey } from "@/lib/google-photos-config";

/** Active connection for a person, or null if missing / revoked. */
export async function getActiveGooglePhotosConnection(
  db: Database,
  personId: string,
): Promise<GooglePhotosConnection | null> {
  const [row] = await db
    .select()
    .from(googlePhotosConnections)
    .where(
      and(
        eq(googlePhotosConnections.personId, personId),
        isNull(googlePhotosConnections.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Decrypt the stored refresh token for an active connection. */
export function decryptConnectionRefreshToken(row: GooglePhotosConnection): string {
  return decryptToken(row.encryptedRefreshToken, getGooglePhotosEncryptionKey());
}

/**
 * Encrypt + upsert a connection for `personId`. Re-connect clears any prior revoke and refreshes
 * the token + email + connectedAt.
 */
export async function upsertGooglePhotosConnection(
  db: Database,
  input: { personId: string; refreshTokenPlain: string; email: string | null },
): Promise<GooglePhotosConnection> {
  const encrypted = encryptToken(
    input.refreshTokenPlain,
    getGooglePhotosEncryptionKey(),
  );
  const now = new Date();
  const [row] = await db
    .insert(googlePhotosConnections)
    .values({
      personId: input.personId,
      encryptedRefreshToken: encrypted,
      googleAccountEmail: input.email,
      connectedAt: now,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: googlePhotosConnections.personId,
      set: {
        encryptedRefreshToken: encrypted,
        googleAccountEmail: input.email,
        connectedAt: now,
        revokedAt: null,
      },
    })
    .returning();
  if (!row) {
    throw new Error("upsertGooglePhotosConnection: insert returned no row");
  }
  return row;
}

/**
 * Disconnect: delete the row (preferred) so a later Connect is a clean insert.
 * Best-effort Google revoke is the caller's responsibility (they hold the plaintext briefly).
 */
export async function disconnectGooglePhotosConnection(
  db: Database,
  personId: string,
): Promise<{ deleted: boolean; refreshTokenPlain: string | null }> {
  const [existing] = await db
    .select()
    .from(googlePhotosConnections)
    .where(eq(googlePhotosConnections.personId, personId))
    .limit(1);

  if (!existing) return { deleted: false, refreshTokenPlain: null };

  let refreshTokenPlain: string | null = null;
  try {
    refreshTokenPlain = decryptToken(
      existing.encryptedRefreshToken,
      getGooglePhotosEncryptionKey(),
    );
  } catch {
    // Corrupt vault blob — still delete the row; revoke is best-effort anyway.
  }

  await db
    .delete(googlePhotosConnections)
    .where(eq(googlePhotosConnections.personId, personId));

  return { deleted: true, refreshTokenPlain };
}
