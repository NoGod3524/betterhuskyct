// The build replaces this source import with the same compiled Changes module shipped in the ZIP.
import { createChangeId, parseChanges, recordChanges } from "../../src/lib/changes.ts";
import { parseAnnouncementCandidates } from "../../src/lib/announcements.ts";

export const CHANGE_KINDS = ["grade", "announcement-new", "announcement-edited", "deadline-moved", "deadline-added", "file-new", "done-by-huskyct"];
const list = (value) => Array.isArray(value) ? value : [];
const code = (value) => value ? String(value).toUpperCase().replace(/[^A-Z0-9]/g, "") : "unknown";
const tasks = (snapshot) => list(snapshot?.tasks?.feeds).flatMap((feed) => list(feed.events));
export function taskUid(task) {
  if (task.id.startsWith("huskyct-due-")) return task.id;
  const suffix = ":" + task.start;
  return task.id.endsWith(suffix) && task.id.length > suffix.length ? task.id.slice(0, -suffix.length) : task.id;
}
const taskScope = (task) => task.sourceCourseId ? `deadlines:id:${task.sourceCourseId}` : `deadlines:${code(task.course)}`;
const announcementScope = (item) => item.sourceCourseId ? `announcements:id:${item.sourceCourseId}` : `announcements:code:${code(item.courseCode)}`;
const courseKey = (course) => /^_\d+_\d+$/.test(course.id) ? "id:" + course.id : course.code ? "code:" + course.code.toUpperCase() : "id:" + course.id;
const union = (before, incoming, key) => [...new Map([...list(before), ...list(incoming)].map((item) => [key(item), item])).values()];
const points = (value) => String(Math.round(value * 100) / 100);
const score = (item) => item && Number.isFinite(item.earned) && Number.isFinite(item.possible) ? `${points(item.earned)}/${points(item.possible)}` : "";
const counted = (item) => Boolean(item && Number.isFinite(item.earned) && Number.isFinite(item.possible) && item.possible > 0);
const done = (item) => counted(item) || /\bcomplete\b/i.test(item?.label || "") || /\battempts?\s+submitted\b/i.test(item?.status || "") || /^(?:submitted|graded|first participated)\b/i.test(item?.status || "");
const date = (task) => task.allDay && task.dateKey ? task.dateKey : task.start;

/** Failed course parts retain the previous successful reading; absent deadlines are never removals. */
export function mergeBackgroundSnapshot(previous, incoming) {
  const reached = new Map(list(incoming.status?.courses).map((course) => [course.id, course]));
  const oldTasks = tasks(previous), newTasks = tasks(incoming);
  const arriving = new Set(newTasks.map(taskUid));
  const events = incoming.status?.dueDates || incoming.status?.todo
    ? [...oldTasks.filter((task) => !arriving.has(taskUid(task))), ...newTasks] : oldTasks;
  const announcements = union(previous?.tasks?.announcements, list(incoming.tasks.announcements).filter((item) =>
    !item.sourceCourseId || reached.get(item.sourceCourseId)?.announcements), (item) => item.id);
  const mergeCourses = (part, flag) => {
    const fresh = list(incoming[part]?.courses).filter((course) => reached.get(course.id)?.[flag]);
    const courses = union(previous?.[part]?.courses, fresh, (course) => course.id);
    if (!incoming[part] && !previous?.[part]) return null;
    if (part === "materials") {
      for (const course of courses) {
        const old = previous?.materials?.courses.find((entry) => entry.id === course.id);
        if (old && fresh.includes(course)) {
          courses[courses.indexOf(course)] = { ...course,
            files: union(old.files, course.files, (file) => file.key),
            links: union(old.links, course.links, (link) => JSON.stringify([link.path, link.url, link.kind])),
            tools: union(old.tools, course.tools, (tool) => JSON.stringify([tool.path, tool.title, tool.url])),
          };
        }
      }
    }
    return { ...(incoming[part] || previous[part]), courses };
  };
  return { ...incoming, tasks: { ...incoming.tasks,
    feeds: events.length ? [{ name: "HuskyCT to-do", courseId: null, importedAt: incoming.at, events }] : [],
    announcements, doneByHuskyct: { ...(previous?.tasks?.doneByHuskyct || {}), ...(incoming.tasks.doneByHuskyct || {}) },
    courseColors: { ...(previous?.tasks?.courseColors || {}), ...(incoming.tasks.courseColors || {}) },
  }, grades: mergeCourses("grades", "grades"), materials: mergeCourses("materials", "files") };
}

/** Same IDs and transitions as the app's producers, without browser storage or UI dependencies. */
export function diffBackgroundSnapshot(previous, incoming, pending, now = new Date(incoming.at)) {
  const normalize = (value) => ({ ...value, tasks: { ...value.tasks, announcements: parseAnnouncementCandidates(value.tasks.announcements, new Date(value.at)) } });
  previous = previous ? normalize(previous) : null;
  incoming = normalize(incoming);
  const snapshot = mergeBackgroundSnapshot(previous, incoming);
  const current = parseChanges(JSON.stringify(pending || { version: 1, entries: [], baselines: [] }), now);
  const baselines = new Set(current.baselines), added = [];
  const push = (kind, parts, title, courseCode, ref, detail) => added.push({ id: createChangeId(kind, ...parts), at: now.toISOString(), kind,
    title, courseCode: courseCode || null, ref, ...(detail ? { detail } : {}), read: false });
  const beforeTasks = tasks(previous), afterTasks = tasks(snapshot);
  const byUid = (items) => {
    const groups = new Map();
    for (const task of items) groups.set(taskUid(task), [...(groups.get(taskUid(task)) || []), task]);
    return groups;
  };
  const oldTasks = byUid(beforeTasks), incomingUids = new Set(tasks(incoming).map(taskUid));
  const oldScopes = new Set(beforeTasks.map(taskScope));
  for (const [uid, group] of byUid(afterTasks)) {
    if (!incomingUids.has(uid)) continue;
    const task = group[0], old = oldTasks.get(uid), scope = taskScope(task);
    if (!old && (current.baselines.includes(scope) || oldScopes.has(scope))) {
      push("deadline-added", [uid, task.start, incoming.tasks.exportedAt], task.title, task.course, { page: "/tasks", id: task.id }, { to: date(task) });
    } else if (old?.length === 1 && group.length === 1 && old[0].id !== task.id) {
      push("deadline-moved", [uid, old[0].start, task.start, incoming.tasks.exportedAt], task.title, task.course,
        { page: "/tasks", id: task.id }, { from: date(old[0]), to: date(task) });
    }
    if (incoming.tasks.doneByHuskyct?.[task.id] && !beforeTasks.some((entry) => taskUid(entry) === uid && previous?.tasks?.doneByHuskyct?.[entry.id]) &&
      (current.baselines.includes(scope) || oldScopes.has(scope))) push("done-by-huskyct", [uid], task.title, task.course, { page: "/tasks", id: task.id });
    baselines.add(scope);
  }
  const oldAnnouncements = new Map(list(previous?.tasks?.announcements).map((item) => [item.id, item]));
  const oldAnnouncementScopes = new Set(list(previous?.tasks?.announcements).map(announcementScope));
  for (const item of list(incoming.tasks.announcements)) {
    if (!snapshot.tasks.announcements.some((entry) => entry.id === item.id && entry.title === item.title && entry.body === item.body)) continue;
    const old = oldAnnouncements.get(item.id), scope = announcementScope(item);
    const kind = old ? "announcement-edited" : "announcement-new";
    if (old ? old.title !== item.title || old.body !== item.body : current.baselines.includes(scope) || oldAnnouncementScopes.has(scope)) {
      push(kind, [item.id, incoming.tasks.exportedAt], item.title, item.courseCode, { page: "/announcements", id: item.id });
    }
    baselines.add(scope);
  }
  for (const course of list(snapshot.grades?.courses)) {
    const old = previous?.grades?.courses.find((entry) => entry.id === course.id);
    if (old) for (const item of course.items) {
      const was = old.items.find((entry) => entry.id === item.id), from = score(was), to = score(item);
      if (counted(item) && from !== to) push("grade", [course.id, item.id, from, to, snapshot.grades.takenAt], item.title, course.code,
        { page: "/grades", id: item.id }, { ...(from ? { from } : {}), to });
      if (done(item) && !done(was)) push("done-by-huskyct", [`huskyct-todo-${encodeURIComponent(item.id)}`], item.title, course.code, { page: "/tasks" });
    }
    baselines.add("grades:" + course.id);
  }
  for (const course of list(snapshot.materials?.courses)) {
    const old = previous?.materials?.courses.find((entry) => courseKey(entry) === courseKey(course));
    if (old) for (const file of course.files) if (!old.files.some((entry) => entry.key === file.key)) {
      push("file-new", [courseKey(course), file.key], file.title, course.code, { page: "/materials", id: file.key });
    }
    baselines.add("files:" + courseKey(course));
  }
  for (const course of list(incoming.status?.courses)) {
    if (course.announcements) baselines.add("announcements:id:" + course.id);
    if (incoming.status.dueDates || incoming.status.todo) baselines.add("deadlines:id:" + course.id);
  }
  // All data in the first background reading is a baseline, regardless of old app-side history.
  const changes = recordChanges(current, previous ? added : [], now, [...baselines]);
  const known = new Set(current.entries.map((entry) => entry.id));
  return { snapshot, changes, added: changes.entries.filter((entry) => !known.has(entry.id)) };
}
