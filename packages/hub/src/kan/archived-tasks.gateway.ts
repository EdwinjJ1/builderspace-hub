import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";

import * as cardRepo from "@kan/db/repository/card.repo";
import { boards, cards, lists } from "@kan/db/schema";

import type { Db, DbOrTx } from "../db";
import { hubArchivedCards } from "../schema";
import { boardVisibleTo } from "./private-boards.gateway";

/** Where a card lives, for checking who may put it away or bring it back. */
export interface CardPlace {
  id: number;
  projectId: number;
}

/**
 * A live card on a live ordinary board that the viewer may see, or undefined:
 * the same answer for a card that does not exist and one they cannot see.
 */
export async function findVisibleCard(
  db: DbOrTx,
  cardPublicId: string,
  viewerId: string,
): Promise<CardPlace | undefined> {
  const [row] = await db
    .select({ id: cards.id, projectId: boards.workspaceId })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .where(
      and(
        eq(cards.publicId, cardPublicId),
        eq(boards.type, "regular"),
        eq(boards.isArchived, false),
        isNull(boards.deletedAt),
        isNull(lists.deletedAt),
        isNull(cards.deletedAt),
        boardVisibleTo(db, viewerId),
      ),
    )
    .limit(1);
  return row;
}

export interface CardOnBoard {
  id: number;
  publicId: string;
  listName: string;
  /** When someone last brought it back from 归档; null if never. */
  restoredAt: Date | null;
}

/**
 * Every live card on a live ordinary board, in any project, that is not in
 * 归档: what the clean-up looks through for finished work. Templates and
 * archived boards are left alone. Read-only.
 */
export async function listCardsOnBoards(db: DbOrTx): Promise<CardOnBoard[]> {
  return db
    .select({
      id: cards.id,
      publicId: cards.publicId,
      listName: lists.name,
      restoredAt: hubArchivedCards.restoredAt,
    })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .leftJoin(hubArchivedCards, eq(hubArchivedCards.cardId, cards.id))
    .where(
      and(
        eq(boards.type, "regular"),
        eq(boards.isArchived, false),
        isNull(boards.deletedAt),
        isNull(lists.deletedAt),
        isNull(cards.deletedAt),
        isNull(hubArchivedCards.archivedAt),
      ),
    );
}

/**
 * Cards that went to 归档 at or before `cutoff` and are still there to
 * delete. Read-only.
 */
export async function listExpiredArchivedCards(
  db: DbOrTx,
  cutoff: Date,
): Promise<number[]> {
  const rows = await db
    .select({ id: cards.id })
    .from(hubArchivedCards)
    .innerJoin(cards, eq(cards.id, hubArchivedCards.cardId))
    .where(
      and(
        isNotNull(hubArchivedCards.archivedAt),
        lte(hubArchivedCards.archivedAt, cutoff),
        isNull(hubArchivedCards.autoDeletedAt),
        isNull(cards.deletedAt),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Deletes a card through Kan's own delete (soft, closing the gap in its list),
 * as the clean-up rather than a person. Kan's signature asks for whoever
 * deleted it; the column is nullable and nobody is the truth here. No activity
 * is logged and no webhook fires: Kan does both in its router, not here.
 */
export async function deleteCardUnattended(
  db: Db,
  cardId: number,
  at: Date,
): Promise<void> {
  await cardRepo.softDelete(db, {
    cardId,
    deletedAt: at,
    deletedBy: null as unknown as string,
  });
}

/**
 * The ids of a project's cards that are in 归档, for Kan's board page to leave
 * out. Internal ids: they never leave the server. Read-only.
 */
export async function archivedCardIdsInProject(
  db: DbOrTx,
  projectId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: cards.id })
    .from(hubArchivedCards)
    .innerJoin(cards, eq(cards.id, hubArchivedCards.cardId))
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .where(
      and(
        eq(boards.workspaceId, projectId),
        isNotNull(hubArchivedCards.archivedAt),
        isNull(cards.deletedAt),
      ),
    );
  return rows.map((row) => row.id);
}
