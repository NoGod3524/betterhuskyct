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

// --- reading the weights from the syllabus ------------------------------------------------------

const { memoryMaterialsStore } = await import("./support/memory-stores.ts");

async function mountWithSyllabus(opts: { withFile: boolean; fetchImpl: (input: string, init: RequestInit) => Promise<Response> }) {
  window.localStorage.clear();
  const store = memoryMaterialsStore();
  if (opts.withFile) {
    await store.putIndex({
      version: 1,
      term: "Fall 2026",
      updatedAt: "2026-10-01T00:00:00.000Z",
      courses: [{ id: "_1_1", code: "STAT 1000Q", files: [{ key: "k1", path: [], title: "syllabus.txt" }], links: [], tools: [] }],
    });
    const text = "Grades: Exam 1 25%, Exam 2 25%, Final 30%, quizzes 10%, MINITAB 10%. Email prof@uconn.edu";
    await store.putFile({ key: "k1", name: "syllabus.txt", type: "text/plain", size: text.length, blob: new Blob([text], { type: "text/plain" }), savedAt: "2026-10-01T00:00:00.000Z" });
  }
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(createElement(GradeScenario, { course: COURSE, locale: "en", openMaterials: async () => store, fetchImpl: opts.fetchImpl })));
  const text = () => container.textContent ?? "";
  const press = async (label: string) => {
    const target = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
    assert.ok(target, `no button "${label}"`);
    await act(async () => (target as unknown as HTMLButtonElement).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  await press(t("en", "scenario.title"));
  return { container, root, text, press };
}

const STAT_ANSWER = {
  parts: [
    { name: "Exam 1", weight: 25, evidence: "Exam 1 – 25%" },
    { name: "Exam 2", weight: 25, evidence: "Exam 2 – 25%" },
    { name: "Final Exam", weight: 30, evidence: "Final Exam – 30%" },
    { name: "Take-home quizzes", weight: 10, evidence: "Take-home quizzes – 10%" },
    { name: "MINITAB assignments", weight: 10, evidence: "MINITAB assignments – 10%" },
  ],
  note: null,
  provider: "glm",
};

test("the weights are read from the syllabus, shown with the syllabus's words for the student to check, and used only when they say so", async () => {
  const sent: string[] = [];
  const view = await mountWithSyllabus({
    withFile: true,
    fetchImpl: async (_input, init) => {
      sent.push(String(init.body));
      return Response.json(STAT_ANSWER);
    },
  });

  await view.press(t("en", "scenario.readSyllabus"));
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("Exam 1 25%"), "the syllabus text was not sent");
  assert.ok(view.text().includes(t("en", "scenario.foundHeading")));
  assert.ok(view.text().includes("Final Exam – 30%"), "the syllabus's own words are not shown");
  // Nothing is used yet.
  assert.ok(!view.text().includes(t("en", "scenario.slidersHeading")));

  await view.press(t("en", "scenario.useFound"));
  assert.ok(view.text().includes(t("en", "scenario.slidersHeading")));
  assert.ok(view.text().includes(t("en", "scenario.weightSum", { sum: "100" })));
  assert.ok(view.text().includes("Take-home quizzes"));
  // The quizzes row (Quiz 1, Quiz 2) is put with "Take-home quizzes" by the word.
  assert.ok(view.text().includes("Now 85% over 2 scored"), view.text());
  await act(async () => view.root.unmount());
});

test("a course with no syllabus among its files says so, and sends nothing", async () => {
  let called = false;
  const view = await mountWithSyllabus({
    withFile: false,
    fetchImpl: async () => {
      called = true;
      return Response.json(STAT_ANSWER);
    },
  });
  await view.press(t("en", "scenario.readSyllabus"));
  assert.equal(called, false);
  assert.ok(view.text().includes(t("en", "scenario.noSyllabus")));
  await act(async () => view.root.unmount());
});

test("when the AI service fails the student is told and can still enter the parts", async () => {
  const view = await mountWithSyllabus({ withFile: true, fetchImpl: async () => Response.json({ problem: "busy" }, { status: 503 }) });
  await view.press(t("en", "scenario.readSyllabus"));
  assert.ok(view.text().includes(t("en", "scenario.errorBusy")));
  assert.ok(view.text().includes(t("en", "scenario.addPart")));
  await act(async () => view.root.unmount());
});
