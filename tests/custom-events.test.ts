import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomEvent,
  editCustomEvent,
  isCustomEventId,
  parseCustomEvent,
  removeCustomEvent,
  type CustomEventInput,
} from "../src/lib/custom-events.ts";

function input(overrides: Partial<CustomEventInput> = {}): CustomEventInput {
  return {
    title: "Study group",
    course: null,
    start: "2026-09-20T18:00:00.000Z",
    end: "2026-09-20T19:00:00.000Z",
    allDay: false,
    location: "Library",
    note: null,
    ...overrides,
  };
}

test("a built event gets a stable, recognisable id and the fields given", () => {
  const event = buildCustomEvent(input());
  assert.ok(isCustomEventId(event.id));
  assert.equal(event.title, "Study group");
  assert.equal(event.location, "Library");
  assert.equal(event.kind, "assignment");
});

test("an all-day event's date key comes from its own start, not today", () => {
  const event = buildCustomEvent(input({ allDay: true, start: "2026-09-22T00:00:00.000Z" }));
  assert.equal(event.dateKey, "2026-09-22");
});

test("editing changes only the named fields, including moving to all-day", () => {
  const event = buildCustomEvent(input());
  const [edited] = editCustomEvent([event], event.id, { title: "Renamed", allDay: true, start: "2026-09-23T00:00:00.000Z" });
  assert.equal(edited.title, "Renamed");
  assert.equal(edited.location, "Library", "an untouched field was overwritten");
  assert.equal(edited.dateKey, "2026-09-23");
});

test("editing an id that is not in the list changes nothing", () => {
  const event = buildCustomEvent(input());
  const out = editCustomEvent([event], "custom-missing", { title: "Renamed" });
  assert.deepEqual(out, [event]);
});

test("removing drops exactly that event", () => {
  const a = buildCustomEvent(input({ title: "a" }));
  const b = buildCustomEvent(input({ title: "b" }));
  const out = removeCustomEvent([a, b], a.id);
  assert.deepEqual(out.map((event) => event.title), ["b"]);
});

// --- what is accepted from storage --------------------------------------------------

test("a well-formed custom event round-trips through the parser", () => {
  const event = buildCustomEvent(input());
  assert.deepEqual(parseCustomEvent(JSON.parse(JSON.stringify(event))), event);
});

test("an id outside the custom- namespace is refused, even if everything else fits", () => {
  const event = buildCustomEvent(input());
  assert.equal(parseCustomEvent({ ...event, id: "huskyct-todo-1" }), null);
});

test("a malformed record reads as nothing rather than throwing", () => {
  assert.equal(parseCustomEvent(null), null);
  assert.equal(parseCustomEvent({ ...buildCustomEvent(input()), start: "not a date" }), null);
  assert.equal(parseCustomEvent({ ...buildCustomEvent(input()), title: "" }), null);
});
