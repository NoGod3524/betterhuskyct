"use client";

import { Check, X } from "lucide-react";

import { useAiPlan } from "@/components/ai-plan-provider";
import { t, type Locale } from "@/lib/i18n";
import { sortUndatedTodos } from "@/lib/undated-todos";

/**
 * The to-dos with no date, as their own group under the dated ones. A tick
 * marks one done and keeps it, struck through, until it is removed; they are
 * few, and a done one is still worth seeing for a while.
 */
export function UndatedTodoList({ locale, course }: { locale: Locale; course: string | null }) {
  const plan = useAiPlan();
  if (!plan) return null;
  const todos = sortUndatedTodos(plan.undated).filter((todo) => !course || todo.course === course);
  if (todos.length === 0) return null;
  const open = todos.filter((todo) => !todo.done).length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="size-2.5 shrink-0 rounded-full bg-[var(--c-6b7f94)]" />
        <h3 className="font-display font-semibold">{t(locale, "todo.undated")}</h3>
        <span className="grid size-6 place-items-center rounded-full bg-[var(--c-f0f3f7)] text-xs font-bold text-[var(--c-536476)]">
          {open}
        </span>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="flex items-start gap-3 rounded-2xl border border-[var(--c-dbe3ec)] bg-[var(--surface)] p-4"
            data-undated={todo.id}
          >
            <button
              type="button"
              onClick={() => plan.toggleUndated(todo.id)}
              aria-pressed={todo.done}
              aria-label={t(locale, todo.done ? "todo.undatedUnmark" : "todo.undatedMark", { title: todo.title })}
              className={`grid size-6 shrink-0 place-items-center rounded-md border transition ${
                todo.done ? "border-[var(--c-2f8f5b)] bg-[var(--c-2f8f5b)] text-white" : "border-[var(--c-cdd9e6)] bg-[var(--surface)]"
              }`}
            >
              {todo.done ? <Check size={14} aria-hidden /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`font-semibold ${todo.done ? "text-[var(--muted)] line-through" : ""}`}>{todo.title}</p>
              {todo.course ? <p className="text-xs text-[var(--muted)]">{todo.course}</p> : null}
              {todo.note ? <p className="mt-1 text-xs text-[var(--muted)]">{todo.note}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => plan.removeUndated(todo.id)}
              aria-label={t(locale, "todo.undatedRemove", { title: todo.title })}
              className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--c-6b7f94)] transition hover:bg-[var(--c-f0f3f7)]"
            >
              <X size={15} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
