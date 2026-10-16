const PROTOCOL = "betterhuskyct/background@1";
const KINDS = ["grade", "announcement-new", "announcement-edited", "deadline-moved", "deadline-added", "file-new", "done-by-huskyct"];
const WORDS = {
  en: { language: "Language", background: "Sync every 6 hours", backgroundHint: "Uses your existing HuskyCT session in this browser. Off by default.",
    notifications: "Show system notifications", notificationHint: "Notifications can show course names and titles on your screen. They are off until you allow them.",
    kinds: "Notify me about", grade: "Grades", "announcement-new": "New announcements", "announcement-edited": "Edited announcements",
    "deadline-moved": "Moved deadlines", "deadline-added": "New deadlines", "file-new": "New file listings", "done-by-huskyct": "Submitted work",
    run: "Run now", running: "Reading HuskyCT…", login: "Sign in to HuskyCT", open: "Open recent changes", never: "No successful background reading yet.",
    last: "Last successful reading: ", paused: "Sign in to HuskyCT yourself to resume. No repeated requests are being made.",
    failed: "The reading could not finish. Your last successful data is kept.", "too-large": "The reading is too large. Your last successful data is kept.",
    permission: "Notifications were not allowed.", saved: "Settings saved.", error: "Could not save or read settings. Try again." },
  "zh-CN": { language: "语言", background: "每 6 小时同步", backgroundHint: "使用此浏览器现有的 HuskyCT 登录状态，默认关闭。",
    notifications: "显示系统通知", notificationHint: "通知可能在屏幕上显示课程名和标题。只有你允许后才会开启。", kinds: "通知这些变化",
    grade: "成绩", "announcement-new": "新公告", "announcement-edited": "公告编辑", "deadline-moved": "截止时间变动", "deadline-added": "新截止时间",
    "file-new": "课件目录新增文件", "done-by-huskyct": "已提交作业", run: "立即同步", running: "正在读取 HuskyCT…", login: "自行登录 HuskyCT",
    open: "查看最近的变化", never: "还没有成功的后台读取。", last: "上次成功读取：", paused: "请自行登录 HuskyCT 后恢复，后台不会反复请求。",
    failed: "本次读取未完成，已保留上次成功的数据。", "too-large": "本次数据过大，已保留上次成功的数据。", permission: "未获准显示通知。",
    saved: "设置已保存。", error: "无法读取或保存设置，请重试。" },
};
const $ = (id) => document.getElementById(id);
let locale = navigator.language.startsWith("zh") ? "zh-CN" : "en", running = false;
const word = (key) => WORDS[locale][key] || WORDS[locale].error;
const send = (kind, extra = {}) => chrome.runtime.sendMessage({ protocol: PROTOCOL, target: "worker", kind, ...extra });
for (const kind of KINDS) {
  const label = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span");
  input.type = "checkbox"; input.dataset.kind = kind; text.dataset.text = kind;
  label.append(input, text); $("kinds").append(label);
  input.addEventListener("change", () => void save({ kinds: { [kind]: input.checked } }));
}
function render(state) {
  if (!state?.ok) { $("error").textContent = word("error"); return; }
  locale = state.settings.locale || locale;
  document.documentElement.lang = locale;
  for (const node of document.querySelectorAll("[data-text]")) node.textContent = word(node.dataset.text);
  $("locale").value = locale; $("enabled").checked = state.settings.enabled; $("notifications").checked = state.settings.notifications;
  for (const node of document.querySelectorAll("[data-kind]")) { node.checked = state.settings.kinds[node.dataset.kind]; node.disabled = !state.settings.notifications; }
  $("login").hidden = !state.needsLogin;
  $("run").disabled = running || state.running; $("run").textContent = word(running || state.running ? "running" : "run");
  $("status").textContent = state.needsLogin ? word("paused") : state.lastSuccess ? word("last") + new Date(state.lastSuccess).toLocaleString(locale) : word("never");
  $("error").textContent = state.lastError && state.lastError !== "signedout" ? word(state.lastError) : "";
}
async function refresh() { try { render(await send("status")); } catch { $("error").textContent = word("error"); } }
async function save(settings) {
  try {
    const result = await send("settings", { settings });
    if (!result?.ok) { await refresh(); $("error").textContent = word(result?.reason === "permission" ? "permission" : "error"); return; }
    render(result);
  } catch { $("error").textContent = word("error"); }
}
$("enabled").addEventListener("change", () => void save({ enabled: $("enabled").checked }));
$("locale").addEventListener("change", () => void save({ locale: $("locale").value }));
$("notifications").addEventListener("change", async () => {
  try {
    const enabled = $("notifications").checked;
    if (enabled && !(await chrome.permissions.request({ permissions: ["notifications"] }))) {
      $("notifications").checked = false; $("error").textContent = word("permission"); return;
    }
    await save({ notifications: enabled });
  } catch { $("notifications").checked = false; $("error").textContent = word("error"); }
});
$("run").addEventListener("click", async () => {
  running = true; $("run").disabled = true; $("run").textContent = word("running");
  try { await send("run-now"); } catch { $("error").textContent = word("error"); }
  finally { running = false; await refresh(); }
});
$("login").addEventListener("click", () => void chrome.tabs.create({ url: "https://lms.uconn.edu/" }));
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void refresh(); });
void refresh();
