/* Kitchen Dashboard front end (plain JS, no framework).
 *
 * How it works:
 *  - `state` holds everything we've downloaded from the Pi's API.
 *  - render() rebuilds the current tab's HTML from `state`.
 *  - Every few seconds we ask the server for its "rev" number; if it changed
 *    (someone edited something on another device) we re-download and re-render.
 *  - Clicks are handled in one place via data-action="..." attributes.
 */
"use strict";

const KIOSK = new URLSearchParams(location.search).has("kiosk");
const LOCALE = "en-US"; // the Pi's system locale is en-GB; we want "Monday, November 16" and 12-hour times
const $ = (sel, el = document) => el.querySelector(sel);

const state = {
  tab: "home",
  listTab: "todo",
  calMode: "month",                                   // "month" or "week"
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calSelected: null,                                  // YYYY-MM-DD picked in the month grid
  monthEvents: { key: null, events: [] },             // events for the month on screen
  photos: [],                                         // uploaded recipe-book photos
  uploadMsg: "",                                      // "Uploading 3 of 12…"
  showAllPhotos: false,
  weather: null,
  events: [],
  calendars: [],
  lists: { todo: [], grocery: [] },
  meals: {},
  settings: {},
  rev: null,
  nightWokenUntil: 0,
};

// ---------- tiny helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const fmtTime = (d) => d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, (m) => " " + m.trim());
const fmtShortTime = (d) => fmtTime(d).replace(":00", "");
const dayName = (d) => d.toLocaleDateString(LOCALE, { weekday: "long" });

function dayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return dayName(d);
  return d.toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : (j.detail?.[0]?.msg ?? msg); } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- icons (simple line icons, Lucide-style) ----------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  calgrid: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13h1M11.5 13h1M15.5 13h1M7.5 17h1M11.5 17h1M15.5 17h1"/>',
  lists: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h3l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h8.5a1.5 1.5 0 0 0 1.5-1.2L21.5 8H6.3"/>',
  meals: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  checks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};
const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- weather icons (drawn here so they look the same on every device;
//            the Pi has no color-emoji font) ----------
const SUN = '<circle cx="12" cy="12" r="4.5" fill="#f5c04a"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="#f5c04a" stroke-width="2" stroke-linecap="round"/>';
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="#d6e0f0"/>';
const CLOUD = (dy = 0) => `<path transform="translate(0 ${dy})" d="M7 19a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 10a4.5 4.5 0 0 1-.5 9z" fill="#c3cfe0"/>`;
const WX_SVG = {
  sun: SUN,
  moon: MOON,
  partly: `<g transform="translate(-1.5 -1.5) scale(.7)">${SUN}</g><g transform="translate(3 3) scale(.85)">${CLOUD()}</g>`,
  partlyNight: `<g transform="translate(-1 -1.5) scale(.65)">${MOON}</g><g transform="translate(3 3) scale(.85)">${CLOUD()}</g>`,
  cloud: CLOUD(),
  fog: '<path d="M3 8h18M5 12h14M3 16h18M6 20h12" stroke="#c3cfe0" stroke-width="2" stroke-linecap="round"/>',
  rain: CLOUD(-4) + '<path d="M8 18.5l-1 3M12 18.5l-1 3M16 18.5l-1 3" stroke="#5b9cf5" stroke-width="2" stroke-linecap="round"/>',
  snow: CLOUD(-4) + '<circle cx="8" cy="19.5" r="1.2" fill="#fff"/><circle cx="12" cy="21.5" r="1.2" fill="#fff"/><circle cx="16" cy="19.5" r="1.2" fill="#fff"/>',
  storm: CLOUD(-4) + '<path d="M13 13.5 10 18h3l-1.5 4.5" stroke="#f5c04a" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
const wxIcon = (kind, cls = "wx") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${WX_SVG[kind] || WX_SVG.cloud}</svg>`;

// ---------- weather codes (WMO) -> words + icon ----------
function wx(code, isDay = 1) {
  const table = [
    [[0], "Sunny", "sun"], [[1], "Mostly sunny", "partly"], [[2], "Partly cloudy", "partly"], [[3], "Cloudy", "cloud"],
    [[45, 48], "Fog", "fog"], [[51, 53, 55], "Drizzle", "rain"], [[56, 57], "Freezing drizzle", "rain"],
    [[61, 63, 65], "Rain", "rain"], [[66, 67], "Freezing rain", "rain"], [[71, 73, 75, 77], "Snow", "snow"],
    [[80, 81, 82], "Showers", "rain"], [[85, 86], "Snow showers", "snow"], [[95, 96, 99], "Thunderstorms", "storm"],
  ];
  let [, label, kind] = table.find(([codes]) => codes.includes(code)) || [, "—", "cloud"];
  if (!isDay) {
    if (code === 0) { label = "Clear"; kind = "moon"; }
    if (code === 1 || code === 2) { label = code === 1 ? "Mostly clear" : label; kind = "partlyNight"; }
  }
  return { label, kind };
}

// ---------- data loading ----------
async function loadLists() {
  const [todo, grocery] = await Promise.all([api("/api/lists/todo"), api("/api/lists/grocery")]);
  state.lists = { todo, grocery };
}
async function loadMeals() {
  state.meals = await api(`/api/meals?start=${isoDay(new Date())}&days=14`);
}
async function loadSettings() { state.settings = await api("/api/settings"); }
async function loadWeather() {
  try { state.weather = await api("/api/weather"); } catch (e) { console.warn("weather", e); }
}
async function loadEvents() {
  try {
    [state.events, state.calendars] = await Promise.all([api("/api/events?days=31"), api("/api/calendars")]);
  } catch (e) { console.warn("events", e); }
}
async function loadPhotos() { try { state.photos = await api("/api/recipe-photos"); } catch {} }
async function loadLocal() { await Promise.all([loadLists(), loadMeals(), loadSettings(), loadPhotos()]); }

// Ask the server "has anything changed?" — cheap, so we can do it often.
async function pollRev() {
  try {
    const { rev } = await api("/api/rev");
    if (rev !== state.rev) {
      state.rev = rev;
      await loadLocal();
      render();
    }
  } catch { /* server restarting or Wi-Fi blip; try again next tick */ }
}

// ---------- event helpers ----------
const evStart = (e) => new Date(e.all_day ? e.start.slice(0, 10) + "T00:00" : e.start);
const evEnd = (e) => new Date(e.all_day ? e.end.slice(0, 10) + "T00:00" : e.end);

function eventsOnDay(day, list = state.events) {
  const s = startOfDay(day), n = addDays(s, 1);
  return list.filter((e) => evStart(e) < n && (evEnd(e) > s || evStart(e) >= s));
}

// Month grid always shows 6 weeks starting on the Sunday on/before the 1st.
const monthKey = (m) => `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
const gridStart = (m) => addDays(m, -m.getDay());

async function loadMonth() {
  const key = monthKey(state.calMonth);
  try {
    const events = await api(`/api/events?start=${isoDay(gridStart(state.calMonth))}&days=42`);
    if (key === monthKey(state.calMonth)) state.monthEvents = { key, events }; // ignore if user moved on
  } catch (e) { console.warn("month", e); }
}

function evTimeText(e) {
  if (e.all_day) return "All day";
  return fmtTime(evStart(e));
}

// ---------- rendering: header ----------
function renderClock() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const kind = h >= 6 && h < 18 ? "sun" : "moon";
  if ($("#greeting").dataset.v !== greet + kind) { // only touch the DOM when it changes
    $("#greeting").innerHTML = `${greet}! ${wxIcon(kind, "wx greet-ico")}`;
    $("#greeting").dataset.v = greet + kind;
  }
  $("#date").textContent = now.toLocaleDateString(LOCALE, { weekday: "long", month: "long", day: "numeric" });
  const t = fmtTime(now).split(" ");
  $("#time").textContent = t[0];
  $("#ampm").textContent = t[1] || "";
  $("#night-clock").textContent = fmtTime(now);
}

// ---------- rendering: home cards ----------
function weatherCard() {
  const w = state.weather;
  if (!w) return `<section class="card"><div class="card-h"><h2>Weather</h2></div><div class="empty">Loading…</div></section>`;
  const c = w.current, d = w.daily[0], cw = wx(c.code, c.is_day);
  const hours = [2, 5, 8].map((i) => w.hourly[i]).filter(Boolean);
  return `
  <section class="card" data-action="goto" data-tab-target="calendar">
    <div class="card-h"><h2>Weather</h2>${wxIcon(cw.kind, "wx w-ico")}</div>
    <div class="w-now"><div class="w-temp">${c.temp}°F</div></div>
    <div class="w-desc muted">${cw.label} · High ${d.hi}° / Low ${d.lo}°${d.precip >= 20 ? ` · ${d.precip}% rain` : ""}</div>
    <div class="w-hours">${hours.map((h) => `
      <div><small>${fmtShortTime(new Date(h.time))}</small><b>${wxIcon(wx(h.code, h.is_day).kind)} ${h.temp}°</b></div>`).join("")}
    </div>
  </section>`;
}

function scheduleCard() {
  const now = new Date();
  const evs = eventsOnDay(now);
  const rows = evs.slice(0, 5).map((e) => `
    <div class="ev ${!e.all_day && evEnd(e) < now ? "past" : ""}">
      <div class="ev-bar" style="background:${esc(e.color)}"></div>
      <div class="ev-main">
        <div class="ev-title">${esc(evTimeText(e))} · ${esc(e.title)}</div>
        <div class="ev-sub">${esc(e.calendar)}</div>
      </div>
    </div>`).join("");
  const more = evs.length > 5 ? `<div class="more">+${evs.length - 5} more</div>` : "";
  return `
  <section class="card">
    <div class="card-h"><h2>Today's Schedule</h2>${icon("calgrid", "blue")}</div>
    ${rows || `<div class="empty">Nothing scheduled today</div>`}${more}
  </section>`;
}

function checkRow(it) {
  return `<button class="check ${it.done ? "done" : ""}" data-action="toggle" data-id="${it.id}" data-done="${it.done ? 1 : 0}">
      <span class="box">${it.done ? icon("check") : ""}</span><span class="txt">${esc(it.text)}</span></button>`;
}

function todoCard() {
  const items = state.lists.todo;
  const open = items.filter((i) => !i.done);
  const doneToday = items.filter((i) => i.done && (i.done_at || "").startsWith(isoDay(new Date())));
  const shown = [...open.slice(0, 6), ...doneToday.slice(0, Math.max(0, 6 - open.length))];
  const more = open.length > 6 ? `<div class="more">+${open.length - 6} more</div>` : "";
  return `
  <section class="card">
    <div class="card-h"><h2>To-do List</h2><span class="green">${icon("checks")}</span></div>
    ${shown.map(checkRow).join("") || `<div class="empty">All done!</div>`}${more}
    ${addForm("todo", "Add a to-do…")}
  </section>`;
}

function addForm(list, placeholder) {
  return `<form class="add-row" data-form="add" data-list="${list}">
      <input name="text" placeholder="${placeholder}" maxlength="200" autocomplete="off" enterkeyhint="done">
      <button class="btn" aria-label="Add">${icon("plus")}</button></form>`;
}

function mealMeta(m) {
  const parts = [];
  if (m.prep_min) parts.push(`Prep: ${m.prep_min} min`);
  if (m.cook_min) parts.push(`Cook: ${m.cook_min} min`);
  return parts.join(" · ");
}

function dinnerCard() {
  const day = isoDay(new Date());
  const m = state.meals[day];
  const body = m
    ? `<div class="dinner-name">${esc(m.name)}</div>
       <div class="dinner-meta muted">${esc(mealMeta(m))}</div>
       <div class="btns">
         ${m.recipe || m.url ? `<button class="btn" data-action="recipe" data-day="${day}">View recipe</button>` : ""}
         <button class="btn" data-action="edit-meal" data-day="${day}" aria-label="Edit">${icon("edit")}${m.recipe || m.url ? "" : " Edit"}</button>
       </div>`
    : `<div class="empty">Nothing planned yet</div>
       <div class="btns"><button class="btn" data-action="edit-meal" data-day="${day}">${icon("plus")} Plan dinner</button></div>`;
  return `
  <section class="card dinner">
    <div class="card-h"><h2>Dinner Tonight</h2><span class="amber">${icon("meals")}</span></div>
    ${body}
  </section>`;
}

function upcomingCard() {
  const tomorrow = addDays(startOfDay(new Date()), 1);
  const end = addDays(tomorrow, 7);
  const evs = state.events.filter((e) => evStart(e) >= tomorrow && evStart(e) < end);
  const rows = evs.slice(0, 8).map((e) => `
    <div class="up-row">
      <div class="l"><span class="dot" style="background:${esc(e.color)}"></span>
        <span>${esc(dayLabel(evStart(e)))} · ${esc(e.title)}</span></div>
      <div class="r">${e.all_day ? "" : esc(fmtTime(evStart(e)))}</div>
    </div>`).join("");
  return `
  <section class="card span2 upcoming">
    <div class="card-h"><h2>Upcoming Events</h2><span class="muted" style="font-size:.9rem">Next 7 days</span></div>
    ${rows || `<div class="empty">Nothing in the next week</div>`}
    ${evs.length > 8 ? `<div class="more">+${evs.length - 8} more — see Calendar</div>` : ""}
  </section>`;
}

function homeView() {
  return `<div class="grid home">
    ${weatherCard()}${scheduleCard()}${todoCard()}${dinnerCard()}${upcomingCard()}
  </div>`;
}

// ---------- rendering: other tabs ----------
// One day's events as a card (used by Week view and the Month "selected day" panel).
function dayCard(d, evs) {
  const w = state.weather?.daily?.find((x) => x.date === isoDay(d));
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  const label = dayLabel(d) + (diff >= 2 && diff < 7 ? " · " + d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" }) : "");
  const wtxt = w ? ` <span class="muted" style="text-transform:none;letter-spacing:0">${wxIcon(wx(w.code).kind)} ${w.hi}°/${w.lo}°</span>` : "";
  return `<section class="card"><div class="day-h">${esc(label)}${wtxt}</div>
    ${evs.map((e) => `
      <div class="ev"><div class="ev-bar" style="background:${esc(e.color)}"></div>
        <div class="ev-main"><div class="ev-title">${esc(e.title)}</div>
        <div class="ev-sub">${esc(evTimeText(e))}${e.all_day ? "" : " – " + esc(fmtTime(evEnd(e)))} · ${esc(e.calendar)}${e.location ? " · " + esc(e.location) : ""}</div></div></div>`).join("")
    || `<div class="empty">No events</div>`}</section>`;
}

function weekView() {
  const today = startOfDay(new Date());
  let out = "";
  for (let i = 0; i < 7; i++) { const d = addDays(today, i); out += dayCard(d, eventsOnDay(d)); }
  return out;
}

function monthView() {
  const m = state.calMonth, key = monthKey(m);
  if (state.monthEvents.key !== key) {
    loadMonth().then(() => { if (state.tab === "calendar") render(); });
  }
  const evList = state.monthEvents.key === key ? state.monthEvents.events : [];
  const todayKey = isoDay(new Date());
  const sel = state.calSelected || (monthKey(new Date()) === key ? todayKey : isoDay(m));
  const start = gridStart(m);
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), k = isoDay(d), evs = eventsOnDay(d, evList);
    const cls = [d.getMonth() !== m.getMonth() && "out", k === todayKey && "today", k === sel && "sel"].filter(Boolean).join(" ");
    cells += `<button class="mday ${cls}" data-action="pick-day" data-day="${k}">
      <span class="num">${d.getDate()}</span>
      ${evs.slice(0, 3).map((e) => `<span class="chip ${e.all_day ? "allday" : ""}" style="--c:${esc(e.color)}"><i></i><span class="t">${esc(e.title)}</span></span>`).join("")}
      ${evs.length > 3 ? `<span class="chip more-chip">+${evs.length - 3}</span>` : ""}
    </button>`;
  }
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div class="dow">${x}</div>`).join("");
  const selDate = new Date(sel + "T00:00");
  return `<div class="cal-split">
    <section class="card month-card">
      <div class="month-nav">
        <button class="icon-btn" data-action="month-prev" aria-label="Previous month">${icon("left")}</button>
        <h3>${esc(m.toLocaleDateString(LOCALE, { month: "long", year: "numeric" }))}</h3>
        <button class="icon-btn" data-action="month-next" aria-label="Next month">${icon("right")}</button>
        <span class="spacer"></span>
        <button class="btn" data-action="month-today">Today</button>
      </div>
      <div class="month">${dows}${cells}</div>
    </section>
    ${dayCard(selDate, eventsOnDay(selDate, evList))}</div>`;
}

function calendarView() {
  const legend = state.calendars.map((c) =>
    `<span><i style="background:${esc(c.color)}"></i>${esc(c.name)}${c.ok ? "" : ' <small class="muted">(offline)</small>'}</span>`).join("");
  const mode = state.calMode;
  return `<div class="page-h"><h2>Calendar</h2>
      <div class="seg">
        <button class="${mode === "month" ? "on" : ""}" data-action="cal-mode" data-mode="month">Month</button>
        <button class="${mode === "week" ? "on" : ""}" data-action="cal-mode" data-mode="week">Week</button>
      </div></div>
    <div class="legend">${legend}</div>
    ${mode === "month" ? monthView() : weekView()}`;
}

function listsView() {
  const name = state.listTab;
  const items = state.lists[name] || [];
  const anyDone = items.some((i) => i.done);
  return `
  <div class="page-h"><h2>Lists</h2>
    <div class="seg">
      <button class="${name === "todo" ? "on" : ""}" data-action="list-tab" data-list="todo">To-do</button>
      <button class="${name === "grocery" ? "on" : ""}" data-action="list-tab" data-list="grocery">Groceries</button>
    </div></div>
  <section class="card">
    ${addForm(name, name === "todo" ? "Add a to-do…" : "Add groceries…")}
    <div style="margin-top:.6rem">
      ${items.map((it) => `<div class="item-row">${checkRow(it)}
        <button class="icon-btn" data-action="delete-item" data-id="${it.id}" aria-label="Delete">${icon("x")}</button></div>`).join("")
      || `<div class="empty">Nothing here yet</div>`}
    </div>
    ${anyDone ? `<button class="btn danger wide" style="margin-top:.6rem" data-action="clear-done" data-list="${name}">${icon("trash")} Clear completed</button>` : ""}
  </section>`;
}

function mealsView() {
  const today = startOfDay(new Date());
  let rows = "";
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i), key = isoDay(d), m = state.meals[key];
    rows += `<button class="meal-row ${i === 0 ? "today" : ""}" data-action="edit-meal" data-day="${key}">
      <span class="d">${esc(i < 2 ? dayLabel(d) : d.toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" }))}</span>
      <span class="n ${m ? "" : "muted"}">${m ? esc(m.name) : "—"}</span>
      <span class="m">${m ? esc(mealMeta(m)) : ""}</span></button>`;
  }
  return `<div class="page-h"><h2>Dinner plan</h2><span class="muted">Tap a day to edit</span></div>
    <section class="card">${rows}</section>
    ${photosCard()}`;
}

// Recipe-book photos: upload from phones, browse thumbnails, tap to view/delete.
function photosCard() {
  const all = state.photos.slice().reverse(); // newest first
  const shown = state.showAllPhotos ? all : all.slice(0, 24);
  return `<section class="card">
    <div class="card-h"><h2>Recipe book photos</h2><span class="muted" style="font-size:.9rem">${all.length} uploaded</span></div>
    ${KIOSK ? "" : `
      <div class="muted" style="font-size:.9rem;margin-bottom:.7rem">Snap each recipe page (one recipe per photo, flat, good light) and upload them here. You can pick lots at once.</div>
      <label class="btn primary wide">${icon("plus")} Upload photos
        <input type="file" accept="image/*" multiple hidden data-upload></label>`}
    ${state.uploadMsg ? `<div class="upload-msg">${esc(state.uploadMsg)}</div>` : ""}
    ${all.length ? `<div class="thumbs">${shown.map((p) => `
      <button class="thumb" data-action="view-photo" data-name="${esc(p.name)}" aria-label="View photo">
        <img src="/recipe-photos/${esc(p.name)}?thumb=1" loading="lazy" alt=""></button>`).join("")}</div>` : ""}
    ${all.length > 24 && !state.showAllPhotos ? `<button class="btn wide" style="margin-top:.6rem" data-action="all-photos">Show all ${all.length}</button>` : ""}
  </section>`;
}

async function uploadPhotos(files) {
  const list = [...files];
  let ok = 0, failed = 0;
  for (let i = 0; i < list.length; i++) {
    state.uploadMsg = `Uploading ${i + 1} of ${list.length}…`;
    render();
    const fd = new FormData();
    fd.append("file", list[i]);
    try {
      const res = await fetch("/api/recipe-photos", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).detail || res.status);
      ok++;
    } catch (e) { failed++; console.warn("upload", list[i].name, e); }
  }
  state.uploadMsg = `Uploaded ${ok} photo${ok === 1 ? "" : "s"}` + (failed ? ` · ${failed} failed (try those again)` : " ✓");
  await loadPhotos();
  render();
  setTimeout(() => { state.uploadMsg = ""; render(); }, 8000);
}

function photoViewer(name) {
  openModal(`
    <img class="photo-full" src="/recipe-photos/${esc(name)}" alt="Recipe photo">
    <div class="actions">
      ${KIOSK ? "" : `<button class="btn danger" data-action="delete-photo" data-name="${esc(name)}">${icon("trash")} Delete</button>`}
      <span class="spacer"></span>
      <button class="btn primary" data-action="close">Close</button>
    </div>`);
}

function settingsView() {
  const s = state.settings;
  const on = s.night_enabled === "1";
  const host = location.host;
  const cals = state.calendars.map((c) => `
    <div class="set-row"><span class="legend"><span><i style="background:${esc(c.color)}"></i>${esc(c.name)}</span></span>
      <span class="${c.ok ? "green" : "muted"}">${c.ok ? "Connected" : esc(c.error || "Not loaded")}</span></div>`).join("");
  return `
  <div class="page-h"><h2>Settings</h2></div>
  <section class="card">
    <div class="card-h"><h2>Night mode</h2></div>
    <div class="muted" style="font-size:.9rem;margin-bottom:.4rem">The wall screen goes black overnight. Tap it to wake for 2 minutes.</div>
    <div class="set-row"><span>Enabled</span><button class="switch ${on ? "on" : ""}" data-action="night-toggle" aria-label="Night mode"></button></div>
    <div class="set-row"><span>Screen off at</span><input type="time" data-setting="night_start" value="${esc(s.night_start)}"></div>
    <div class="set-row"><span>Screen on at</span><input type="time" data-setting="night_end" value="${esc(s.night_end)}"></div>
  </section>
  <section class="card">
    <div class="card-h"><h2>Calendars</h2></div>
    ${cals || `<div class="empty">No calendars configured</div>`}
    <div class="muted" style="font-size:.85rem;margin-top:.5rem">Calendars are set in the <code>.env</code> file on the Pi.</div>
  </section>
  <section class="card">
    <div class="card-h"><h2>Use it from your phone</h2></div>
    <div style="line-height:1.6">At home: <code>http://machouse.local:8000</code><br>
    Away (Tailscale): <code>http://machouse:8000</code><br>
    <span class="muted" style="font-size:.9rem">Open in Safari/Chrome → Share → <b>Add to Home Screen</b>.</span></div>
    <div class="muted" style="font-size:.85rem;margin-top:.5rem">You're connected to <code>${esc(host)}</code></div>
  </section>`;
}

const VIEWS = { home: homeView, calendar: calendarView, lists: listsView, meals: mealsView, settings: settingsView };

let renderPending = false;
function render() {
  // Don't wipe out something the user is typing; render once they finish.
  const a = document.activeElement;
  if (a && $("#view").contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.value) {
    renderPending = true;
    return;
  }
  renderPending = false;
  $("#view").innerHTML = VIEWS[state.tab]();
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
}

// ---------- modals ----------
function openModal(html) {
  const m = $("#modal");
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.hidden = false;
}
function closeModal() { $("#modal").hidden = true; $("#modal").innerHTML = ""; if (renderPending) render(); }

function mealEditor(day) {
  const m = state.meals[day] || {};
  const d = new Date(day + "T12:00");
  openModal(`
    <h3>Dinner · ${esc(dayLabel(d))}</h3>
    <form data-form="meal" data-day="${day}">
      <div class="field"><label>What's for dinner?</label><input name="name" required maxlength="100" value="${esc(m.name)}" placeholder="Chicken Alfredo"></div>
      <div class="row2">
        <div class="field"><label>Prep (min)</label><input name="prep_min" type="number" inputmode="numeric" min="0" max="1440" value="${esc(m.prep_min)}"></div>
        <div class="field"><label>Cook (min)</label><input name="cook_min" type="number" inputmode="numeric" min="0" max="1440" value="${esc(m.cook_min)}"></div>
      </div>
      <div class="field"><label>Recipe link (optional)</label><input name="url" type="url" maxlength="500" value="${esc(m.url)}" placeholder="https://…"></div>
      <div class="field"><label>Recipe / notes (optional)</label><textarea name="recipe" rows="5" maxlength="5000">${esc(m.recipe)}</textarea></div>
      <div class="actions">
        ${m.name ? `<button type="button" class="btn danger" data-action="clear-meal" data-day="${day}">Clear</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn" data-action="close">Cancel</button>
        <button class="btn primary">Save</button>
      </div>
    </form>`);
  if (!KIOSK) $("#modal input[name=name]").focus();
}

function recipeView(day) {
  const m = state.meals[day];
  if (!m) return;
  openModal(`
    <h3>${esc(m.name)}</h3>
    <div class="muted" style="margin-bottom:.8rem">${esc(mealMeta(m))}</div>
    ${m.recipe ? `<div class="recipe">${esc(m.recipe)}</div>` : ""}
    ${m.url ? (KIOSK
      ? `<p class="muted">Recipe link saved — open it on your phone.</p>`
      : `<p><a class="btn" href="${esc(m.url)}" target="_blank" rel="noopener">Open recipe ↗</a></p>`) : ""}
    <div class="actions"><button class="btn primary" data-action="close">Close</button></div>`);
}

// ---------- actions ----------
async function act(fn) {
  try { await fn(); await pollRev(); } catch (e) { toast(e.message || "Something went wrong"); }
}

document.addEventListener("click", (ev) => {
  const tabBtn = ev.target.closest(".tabs button");
  if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }

  if (ev.target.id === "modal") { closeModal(); return; }

  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const { action, id, day, list } = el.dataset;
  switch (action) {
    case "toggle": {
      // Flip it on screen immediately (feels instant), then tell the server.
      const done = el.dataset.done !== "1";
      for (const l of Object.values(state.lists)) for (const it of l) if (it.id == id) it.done = done ? 1 : 0, it.done_at = done ? isoDay(new Date()) : null;
      render();
      act(() => api(`/api/items/${id}`, { method: "PATCH", body: { done } }));
      break;
    }
    case "delete-item": act(() => api(`/api/items/${id}`, { method: "DELETE" })); break;
    case "clear-done": act(() => api(`/api/lists/${list}/clear-done`, { method: "POST" })); break;
    case "list-tab": state.listTab = list; render(); break;
    case "cal-mode": state.calMode = el.dataset.mode; render(); break;
    case "pick-day": {
      state.calSelected = day;
      const d = new Date(day + "T00:00");
      if (d.getMonth() !== state.calMonth.getMonth()) state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      render();
      break;
    }
    case "month-prev": case "month-next": {
      const m = state.calMonth;
      state.calMonth = new Date(m.getFullYear(), m.getMonth() + (action === "month-next" ? 1 : -1), 1);
      state.calSelected = null;
      render();
      break;
    }
    case "month-today": {
      const n = new Date();
      state.calMonth = new Date(n.getFullYear(), n.getMonth(), 1);
      state.calSelected = null;
      render();
      break;
    }
    case "edit-meal": mealEditor(day); break;
    case "recipe": recipeView(day); break;
    case "clear-meal": closeModal(); act(() => api(`/api/meals/${day}`, { method: "DELETE" })); break;
    case "close": closeModal(); break;
    case "view-photo": photoViewer(el.dataset.name); break;
    case "all-photos": state.showAllPhotos = true; render(); break;
    case "delete-photo":
      if (confirm("Delete this photo?")) { closeModal(); act(() => api(`/api/recipe-photos/${el.dataset.name}`, { method: "DELETE" })); }
      break;
    case "goto": state.tab = el.dataset.tabTarget; render(); break;
    case "night-toggle":
      act(() => api("/api/settings", { method: "PUT", body: { night_enabled: state.settings.night_enabled === "1" ? "0" : "1" } }));
      break;
  }
});

document.addEventListener("submit", (ev) => {
  const f = ev.target;
  ev.preventDefault();
  if (f.dataset.form === "add") {
    const input = f.elements.text;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    act(() => api(`/api/lists/${f.dataset.list}`, { method: "POST", body: { text } }));
  } else if (f.dataset.form === "meal") {
    const fd = Object.fromEntries(new FormData(f));
    const num = (v) => (v === "" ? null : Number(v));
    const body = { name: fd.name.trim(), prep_min: num(fd.prep_min), cook_min: num(fd.cook_min), url: fd.url.trim() || null, recipe: fd.recipe.trim() || null };
    act(async () => { await api(`/api/meals/${f.dataset.day}`, { method: "PUT", body }); closeModal(); });
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-upload]") && ev.target.files.length) { uploadPhotos(ev.target.files); return; }
  const key = ev.target.dataset.setting;
  if (key && ev.target.value) act(() => api("/api/settings", { method: "PUT", body: { [key]: ev.target.value } }));
});

document.addEventListener("focusout", () => setTimeout(() => { if (renderPending && !$("#modal").innerHTML) render(); }, 0));

// ---------- kiosk-only behaviour ----------
function inNightWindow() {
  const s = state.settings;
  if (s.night_enabled !== "1" || !s.night_start || !s.night_end) return false;
  const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = s.night_start.split(":").map(Number), [eh, em] = s.night_end.split(":").map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b; // window may cross midnight
}

function updateNight() {
  if (!KIOSK) return;
  $("#night").hidden = !(inNightWindow() && Date.now() > state.nightWokenUntil);
}

let lastTouch = Date.now();
if (KIOSK) {
  document.body.classList.add("kiosk", "hide-cursor");
  // Show the mouse pointer while the mouse moves; hide it after 5 s still.
  let cursorTimer;
  document.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse") return;
    document.body.classList.remove("hide-cursor");
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add("hide-cursor"), 5000);
  });
  ["pointerdown", "keydown"].forEach((t) => document.addEventListener(t, () => { lastTouch = Date.now(); }, true));
  $("#night").addEventListener("pointerdown", () => { state.nightWokenUntil = Date.now() + 120000; updateNight(); });
  // Drift back to Home after 2 minutes without a touch.
  setInterval(() => {
    if (state.tab !== "home" && Date.now() - lastTouch > 120000 && $("#modal").hidden) { state.tab = "home"; render(); }
  }, 10000);
  // Reload the page once a night (picks up code updates, clears any leaks).
  setInterval(() => { const n = new Date(); if (n.getHours() === 3 && n.getMinutes() === 30) location.reload(); }, 60000);
}

// ---------- start ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  const t = b.dataset.tab;
  b.innerHTML = `${icon(t)}<span>${t[0].toUpperCase() + t.slice(1)}</span>`;
});

(async function start() {
  const startTab = location.hash.slice(1); // e.g. /#calendar opens that tab
  if (VIEWS[startTab]) state.tab = startTab;
  renderClock();
  setInterval(() => { renderClock(); updateNight(); }, 1000);
  render();
  await Promise.all([pollRev(), loadWeather(), loadEvents()]);
  render();
  setInterval(pollRev, 4000);
  setInterval(async () => { await loadWeather(); render(); }, 10 * 60 * 1000);
  setInterval(async () => { await Promise.all([loadEvents(), loadMonth()]); render(); }, 5 * 60 * 1000);
  // At midnight "today" changes — redraw everything.
  let lastDay = isoDay(new Date());
  setInterval(() => { const d = isoDay(new Date()); if (d !== lastDay) { lastDay = d; loadMeals().then(render); } }, 30000);
})();
