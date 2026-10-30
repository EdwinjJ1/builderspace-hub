import { useEffect, useRef } from "react";
import { TbTrash } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { HubTask } from "./task-display";
import { copy } from "~/hub/copy/zh";
import { buttonClass } from "~/hub/ui/admin-primitives";

const text = copy.tasks.deleteDialog;

/**
 * "Delete this task?" in the middle of the page. 删除 deletes it at once;
 * 取消, Esc and a click outside leave it as it was. Focus starts on 取消, so a
 * stray Enter never deletes anything.
 */
export function ConfirmDeleteDialog({
  task,
  onConfirm,
  onCancel,
}: {
  task: HubTask;
  onConfirm: (task: HubTask) => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-task-title"
      aria-describedby="delete-task-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-light-300 bg-light-50 p-5 shadow-xl dark:border-dark-300 dark:bg-dark-100">
        <h2
          id="delete-task-title"
          className="flex items-center gap-2 text-base font-semibold text-light-1000 dark:text-dark-1000"
        >
          <TbTrash
            className="h-5 w-5 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          {text.title}
        </h2>
        <p
          id="delete-task-body"
          className="mt-3 text-sm leading-6 text-light-1000 dark:text-dark-1000"
        >
          <span className="line-clamp-3 font-medium">{task.title}</span>
          <span className="mt-1 block text-light-900 dark:text-dark-900">
            {text.body}
          </span>
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className={buttonClass.ghost}
            onClick={onCancel}
          >
            {text.cancel}
          </button>
          <button
            type="button"
            className={twMerge(buttonClass.danger)}
            onClick={() => onConfirm(task)}
          >
            {text.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
