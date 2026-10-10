import assert from "node:assert/strict";
import { after, test } from "node:test";

import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/** The what-if panel under a course, rendered and used the way a student would use it. */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { GradeScenario } = await import("../src/components/grade-scenario.tsx");

const { window } = dom;
after(() => dom.uninstall());

const COURSE = {
  id: "_1_1",
  code: "STAT 1000Q",
  items: [
    { id: "r1", title: "Quiz 1", status: null, earned: 9, possible: 10, label: null },
    { id: "r2", title: "Quiz 2", status: null, earned: 8, possible: 10, label: null },
    { id: "r3", title: "Homework 1", status: null, earned: 95, possible: 100, label: null },
  ],
};

/** Types into a field the way the browser does, so React's onChange hears it. */
function setValue(input: unknown, value: string) {
  const el = input as HTMLInputElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set?.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  el.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
}

async function mount() {
  window.localStorage.clear();
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(createElement(GradeScenario, { course: COURSE, locale: "en" })));
  const text = () => container.textContent ?? "";
  const buttonByText = (label: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  return { container, root, text, buttonByText };
}

test("a student gives the parts, drags one, and sees the course grade and what the rest must average", async () => {
  const view = await mount();
  await act(async () => (view.buttonByText(t("en", "scenario.title")) as unknown as HTMLButtonElement).click());

  // Three parts: Homework 30, Quizzes 20, Exams 50.
  for (let i = 0; i < 3; i++) await act(async () => (view.buttonByText(t("en", "scenario.addPart")) as unknown as HTMLButtonElement).click());
  const names = [...view.container.querySelectorAll(`input[aria-label="${t("en", "scenario.partName")}"]`)];
  const weights = [...view.container.querySelectorAll('input[type="number"]')].slice(0, 3);
  assert.equal(names.length, 3);
  const plan = [["Homework", "30"], ["Quizzes", "20"], ["Exams", "50"]];
  for (let i = 0; i < 3; i++) {
    await act(async () => setValue(names[i], plan[i][0]));
    await act(async () => setValue(weights[i], plan[i][1]));
  }
  assert.ok(view.text().includes(t("en", "scenario.weightSum", { sum: "100" })), view.text());

  // Homework stands at 95 and the quizzes at 85 from the rows; the exams have nothing: total over the others.
  assert.ok(view.text().includes("Now 95% over 1 scored"));
  assert.ok(view.text().includes("Now 85% over 2 scored"));
  assert.ok(view.text().includes(t("en", "scenario.total", { percent: "91", letter: "A-" })), view.text());
  assert.ok(view.text().includes(t("en", "scenario.missing", { weight: "50" })));

  // Expecting 90 on the exams brings them in: (30*95 + 20*85 + 50*90) / 100 = 90.5.
  const slider = view.container.querySelector(`input[aria-label="${t("en", "scenario.expect", { name: "Exams" })}"]`)!;
  await act(async () => setValue(slider, "90"));
  assert.ok(view.text().includes(t("en", "scenario.total", { percent: "90.5", letter: "A-" })), view.text());

  // The exams are still to come; wanting 93 means they must average (9300 - 30*95 - 20*85) / 50 = 95.
  const checkboxes = [...view.container.querySelectorAll('input[type="checkbox"]')];
  await act(async () => (checkboxes[2] as unknown as HTMLInputElement).click());
  assert.ok(view.text().includes(t("en", "scenario.needs", { percent: "95", target: "93" })), view.text());

  // It is remembered in this browser.
  assert.ok((window.localStorage.getItem("huskypilot.gradeScenarios.v1") ?? "").includes("Exams"));
  await act(async () => view.root.unmount());
});

test("with no parts there is only the invitation to add some", async () => {
  const view = await mount();
  await act(async () => (view.buttonByText(t("en", "scenario.title")) as unknown as HTMLButtonElement).click());
  assert.ok(view.text().includes(t("en", "scenario.partsHeading")));
  assert.ok(!view.text().includes(t("en", "scenario.slidersHeading")));
  await act(async () => view.root.unmount());
});
