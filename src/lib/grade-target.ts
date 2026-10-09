/**
 * What the rest of a course has to score to end at a target grade.
 *
 * The gradebook says nothing of category weights (see `summarizeCourse`), so the one weight that
 * matters is the student's to enter: how much of the course grade is still to come. The graded
 * work so far is taken to be the rest of it, which is how "what do I need on the final" is
 * always worked out.
 */
export type GradeTargetResult =
  /** Nothing is left to come, or an input is not a percent. */
  | { kind: "none" }
  /** The target is met whatever the rest scores. */
  | { kind: "safe" }
  /** The rest must score this percent, from 0 to 100. */
  | { kind: "needs"; percent: number }
  /** Even full marks on the rest end below the target; the best that is possible. */
  | { kind: "out"; best: number };

const round = (value: number) => Math.round(value * 10) / 10;
const isPercent = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * @param soFar the percent scored on the graded work, 0–100
 * @param restWeight the percent of the course grade still to come, 0–100
 * @param target the course grade wanted, 0–100
 */
export function neededOnRest(soFar: number, restWeight: number, target: number): GradeTargetResult {
  if (!isPercent(soFar) || !isPercent(restWeight) || !isPercent(target) || restWeight === 0) return { kind: "none" };
  const needed = (100 * target - soFar * (100 - restWeight)) / restWeight;
  if (needed <= 0) return { kind: "safe" };
  if (needed > 100) return { kind: "out", best: round((soFar * (100 - restWeight) + 100 * restWeight) / 100) };
  return { kind: "needs", percent: round(needed) };
}
