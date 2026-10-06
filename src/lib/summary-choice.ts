/**
 * Which model the reader lets write their summaries.
 *
 * - `auto`: Z.ai's GLM first, then Google Gemini, then Groq, each when the one before is busy or failing —
 *   the behaviour before there was a choice, and the default.
 * - `glm`: only Z.ai. If it is busy the reader gets an error, not Gemini.
 * - `gemini`: only Google Gemini.
 * - `groq`: only Groq.
 *
 * The two services have different terms and different owners, so a reader who
 * is not comfortable with one is given a way to never send their announcements
 * to it. The choice is kept in this browser only.
 */
export type SummaryChoice = "auto" | "glm" | "gemini" | "groq";

export const SUMMARY_CHOICES: readonly SummaryChoice[] = ["auto", "glm", "gemini", "groq"];

export const SUMMARY_CHOICE_KEY = "huskypilot.summaryModel.v1";

export function isSummaryChoice(value: unknown): value is SummaryChoice {
  return typeof value === "string" && (SUMMARY_CHOICES as readonly string[]).includes(value);
}

/** The saved choice, or `auto` if there is none, it is unknown, or storage is blocked. */
export function restoreSummaryChoice(storage: Pick<Storage, "getItem">): SummaryChoice {
  try {
    const saved = storage.getItem(SUMMARY_CHOICE_KEY);
    return isSummaryChoice(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function saveSummaryChoice(storage: Pick<Storage, "setItem" | "removeItem">, choice: SummaryChoice): void {
  try {
    // The default is not stored, so "never chose" and "chose automatic" read alike.
    if (choice === "auto") storage.removeItem(SUMMARY_CHOICE_KEY);
    else storage.setItem(SUMMARY_CHOICE_KEY, choice);
  } catch {
    /* the choice holds for this visit and is forgotten after */
  }
}
