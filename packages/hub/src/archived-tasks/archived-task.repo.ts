import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubArchivedCards } from "../schema";

/**
 * Puts cards in 归档. One already there keeps when and by whom it went, so a
 * second press, or the clean-up racing a person, changes nothing.
 */
export async function putAway(
  db: DbOrTx,
  input: {
    cardIds: readonly number[];
    at: Date;
    by: string | null;
    automatic: boolean;
  },
): Promise<void> {
  if (input.cardIds.length === 0) return;
  const values = {
    archivedAt: input.at,
    archivedBy: input.by,
    automatic: input.automatic,
  };
  await db
    .insert(hubArchivedCards)
    .values(input.cardIds.map((cardId) => ({ cardId, ...values })))
    .onConflictDoUpdate({
      target: hubArchivedCards.cardId,
      set: values,
      setWhere: sql`${hubArchivedCards.archivedAt} IS NULL`,
    });
}

/** Takes a card out of 归档. False when it was not there. */
export async function bringBack(
  db: DbOrTx,
  cardId: number,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(hubArchivedCards)
    .set({
      archivedAt: null,
      archivedBy: null,
      automatic: false,
      restoredAt: at,
    })
    .where(
      and(
        eq(hubArchivedCards.cardId, cardId),
        isNotNull(hubArchivedCards.archivedAt),
        isNull(hubArchivedCards.autoDeletedAt),
      ),
    )
    .returning({ cardId: hubArchivedCards.cardId });
  return rows.length > 0;
}

/** Records that the clean-up deleted this card, so 我完成的 still counts it. */
export async function markAutoDeleted(
  db: DbOrTx,
  cardId: number,
  at: Date,
): Promise<void> {
  await db
    .update(hubArchivedCards)
    .set({ autoDeletedAt: at })
    .where(eq(hubArchivedCards.cardId, cardId));
}
