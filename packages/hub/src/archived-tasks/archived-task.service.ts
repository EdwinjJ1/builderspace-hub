import { createLogger } from "@kan/logger";

import type { Db } from "../db";
import type { CardPlace } from "../kan/archived-tasks.gateway";
import { completionsOf } from "../archive/archive.service";
import {
  archivedCardIdsInProject,
  deleteCardUnattended,
  findVisibleCard,
  listCardsOnBoards,
  listExpiredArchivedCards,
} from "../kan/archived-tasks.gateway";
import { listViewableProjects } from "../kan/tasks.gateway";
import { consumeRateLimit } from "../rate-limit";
import { HubError } from "../shared/errors";
import { stageOf } from "../tasks/task.policy";
import {
  deletionCutoff,
  isDueForArchive,
  TIDY_EVERY_SECONDS,
} from "./archived-task.policy";
import { bringBack, markAutoDeleted, putAway } from "./archived-task.repo";

const log = createLogger("hub-archived-tasks");

/**
 * 归档: putting tasks away by hand, bringing them back, and the clean-up that
 * puts finished tasks away on its own and later deletes them. Reading what is
 * in 归档 is in the task service, next to the boards it is hidden from.
 *
 * Nothing here is audited: moving a task between the board and 归档 is
 * everyday work, like moving it between columns, and Kan does not log that
 * either.
 */

/** Puts a task in 归档, finished or not. Doing it twice changes nothing. */
export async function archiveTask(
  db: Db,
  actor: { userId: string },
  input: { cardPublicId: string },
  now: Date,
): Promise<void> {
  const card = await editableCard(db, actor.userId, input.cardPublicId);
  await putAway(db, {
    cardIds: [card.id],
    at: now,
    by: actor.userId,
    automatic: false,
  });
}

/**
 * Brings a task back from 归档 to the column it was in. A finished one gets
 * its full wait in 已完成 again before the clean-up puts it back.
 */
export async function restoreTask(
  db: Db,
  actor: { userId: string },
  input: { cardPublicId: string },
  now: Date,
): Promise<void> {
  const card = await editableCard(db, actor.userId, input.cardPublicId);
  if (!(await bringBack(db, card.id, now))) {
    throw new HubError("CONFLICT", "这个任务已经不在归档里了，刷新看看。");
  }
}

/** The card, if this person may see it and edit tasks in its project. */
async function editableCard(
  db: Db,
  userId: string,
  cardPublicId: string,
): Promise<CardPlace> {
  const card = await findVisibleCard(db, cardPublicId, userId);
  const project = card
    ? (await listViewableProjects(db, userId)).find(
        (candidate) => candidate.id === card.projectId,
      )
    : undefined;
  // The same answer whether the task does not exist or is not theirs to see.
  if (!card || !project) {
    throw new HubError("NOT_FOUND", "没有这个任务，或者你看不到它。");
  }
  if (!project.canEditTasks) {
    throw new HubError("FORBIDDEN", "你没有修改这个项目里任务的权限。");
  }
  return card;
}

export interface TidyResult {
  /** Finished tasks that went to 归档 on their own. */
  archived: number;
  /** Tasks deleted after their time in 归档. */
  deleted: number;
}

/**
 * The clean-up, across every project: finished tasks that have waited long
 * enough go to 归档, and tasks that have been in 归档 long enough are
 * deleted. Safe to run at any time and as often as you like.
 */
export async function tidyTasks(db: Db, now: Date): Promise<TidyResult> {
  const finished = (await listCardsOnBoards(db)).filter(
    (card) => stageOf(card.listName) === "done",
  );
  const completions = await completionsOf(
    db,
    finished.map((card) => card.publicId),
  );
  const due = finished.filter((card) => {
    const completion = completions.get(card.publicId);
    return (
      completion !== undefined &&
      isDueForArchive(
        { finishedAt: completion.at, restoredAt: card.restoredAt },
        now,
      )
    );
  });
  await putAway(db, {
    cardIds: due.map((card) => card.id),
    at: now,
    by: null,
    automatic: true,
  });

  const expired = await listExpiredArchivedCards(db, deletionCutoff(now));
  for (const cardId of expired) {
    // Kan's delete runs its own transaction. Should the mark fail after it,
    // the card is still deleted; it only drops out of 我完成的.
    await deleteCardUnattended(db, cardId, now);
    await markAutoDeleted(db, cardId, now);
  }

  return { archived: due.length, deleted: expired.length };
}

const TIDY_KEY = "hub:tidy-tasks";

/**
 * Runs the clean-up if nobody has in the last `TIDY_EVERY_SECONDS`. There is
 * no scheduler: the pages that show tasks call this first, so the boards are
 * at most that much behind. Null when it was not this call's turn.
 */
export async function tidyTasksIfDue(
  db: Db,
  now: Date,
): Promise<TidyResult | null> {
  const turn = await consumeRateLimit(
    db,
    TIDY_KEY,
    { window: TIDY_EVERY_SECONDS, max: 1 },
    now.getTime(),
  );
  return turn.allowed ? tidyTasks(db, now) : null;
}

/**
 * For a page about to show tasks: `tidyTasksIfDue`, but a failed clean-up is
 * logged rather than thrown, so nobody loses their page over it.
 */
export async function tidyBeforeShowingTasks(db: Db, now: Date): Promise<void> {
  try {
    await tidyTasksIfDue(db, now);
  } catch (error) {
    log.error({ err: error }, "The 归档 clean-up failed");
  }
}

/** The cards in 归档 in one project, for Kan's board page to leave out. */
export function archivedCardIds(db: Db, projectId: number): Promise<number[]> {
  return archivedCardIdsInProject(db, projectId);
}
