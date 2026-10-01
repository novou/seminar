(() => {
  "use strict";

  const SERIES = "Common Ground";
  const TIME_ZONE = "Europe/Zurich";
  const HOUR = 60 * 60 * 1000;
  const archiveTimes = new Map();
  const localClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const content = document.getElementById("content");
  function setupNavigation(detailMode) {
    const navigation = document.getElementById("page-navigation");
    const homeLink = document.getElementById("home-link");
    const topLink = document.getElementById("back-to-top");
    homeLink.hidden = !detailMode;
    const updateNavigation = () => {
      topLink.hidden = window.scrollY <= 80;
      navigation.hidden = homeLink.hidden && topLink.hidden;
    };
    window.addEventListener("scroll", updateNavigation, { passive: true });
    window.addEventListener("resize", updateNavigation);
    updateNavigation();
  }

  // Calendar dates have no timezone. Use UTC explicitly only for formatting.
  function calendarDate(value) {
    if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1) return null;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  }

  function localWallTime(instant) {
    const parts = localClock.formatToParts(instant);
    const part = type => Number(parts.find(item => item.type === type).value);
    const date = new Date(0);
    date.setUTCFullYear(part("year"), part("month") - 1, part("day"));
    date.setUTCHours(part("hour"), part("minute"), part("second"), 0);
    return date.getTime();
  }

  function instantForWallTime(wallTime) {
    // Find the actual timezone offset on both sides of a possible DST change.
    const offsets = new Set([-36 * HOUR, 0, 36 * HOUR].map(delta => {
      const sample = wallTime + delta;
      return localWallTime(sample) - sample;
    }));
    const matches = [...offsets].map(offset => wallTime - offset)
      .filter(instant => localWallTime(instant) === wallTime);
    // A repeated autumn time uses its later occurrence, avoiding early archival.
    return matches.length ? Math.max(...matches) : null;
  }

  function archiveAt(event) {
    const key = `${event.date}|${event.start_time || ""}|${event.end_time || ""}`;
    if (archiveTimes.has(key)) return archiveTimes.get(key);
    const day = calendarDate(event.date);
    if (!day) return NaN;
    let end = null;
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.end_time || "") &&
        (!event.start_time || event.end_time > event.start_time)) {
      const [hour, minute] = event.end_time.split(":").map(Number);
      end = instantForWallTime(day.getTime() + hour * HOUR + minute * 60000);
    }
    // Untimed or invalid legacy schedules keep next-day archival; do not guess.
    const cutoff = end === null
      ? instantForWallTime(day.getTime() + 24 * HOUR)
      : end + HOUR;
    archiveTimes.set(key, cutoff);
    return cutoff;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC", weekday: "long", month: "short", day: "numeric", year: "numeric"
    }).format(calendarDate(value));
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function validateEvent(data, id) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data.id !== id || !calendarDate(data.id)) {
      throw new Error("Invalid seminar ID");
    }
    const event = { id, date: text(data.date), speaker: text(data.speaker), title: text(data.title) };
    if (!calendarDate(event.date) || !event.speaker || !event.title) throw new Error("Missing or invalid required seminar fields");
    for (const field of ["affiliation", "abstract", "bio", "location"]) event[field] = text(data[field]);
    for (const field of ["start_time", "end_time"]) {
      const value = text(data[field]);
      event[field] = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
    }
    return event;
  }

  function formatTime(event) {
    if (!event.start_time) return "";
    return event.end_time ? `${event.start_time}–${event.end_time}` : event.start_time;
  }

  function isUpcoming(event, now = new Date()) {
    return new Date(now).getTime() < archiveAt(event);
  }

  function groupEvents(events, now = new Date()) {
    const ascending = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    return {
      upcoming: events.filter(event => isUpcoming(event, now)).sort(ascending),
      past: events.filter(event => !isUpcoming(event, now)).sort((a, b) => ascending(b, a))
    };
  }

  function watchArchiving(events, render) {
    let signature = null;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      const nextSignature = events.map(event => isUpcoming(event, now) ? "1" : "0").join("");
      if (nextSignature !== signature) {
        signature = nextSignature;
        const focusedHref = content.contains(document.activeElement)
          ? document.activeElement.getAttribute("href") : null;
        render(now);
        if (focusedHref) [...content.querySelectorAll("a[href]")]
          .find(node => node.getAttribute("href") === focusedHref)?.focus({ preventScroll: true });
      }
      const next = Math.min(...events.map(archiveAt).filter(time => time > now.getTime()));
      if (Number.isFinite(next)) timer = setTimeout(refresh, Math.max(1, Math.min(next - now.getTime(), 60000)));
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    refresh();
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function link(label, href, className) {
    const node = element("a", className, label);
    node.href = href;
    return node;
  }

  function showLoading(message) {
    content.setAttribute("aria-busy", "true");
    const status = element("p", "notice", message);
    status.setAttribute("role", "status");
    content.replaceChildren(status);
  }

  function showError(title, message, detail = false) {
    document.title = `${title} | ${SERIES}`;
    const section = element("section", "error-state");
    section.setAttribute("role", "alert");
    section.append(element("h2", "", title), element("p", "", message));
    content.replaceChildren();
    if (detail) content.append(link("← All talks", "./", "back-link"));
    content.append(section);
  }

  async function fetchJSON(path) {
    const response = await fetch(path);
    if (!response.ok) {
      const error = new Error(`Could not load ${path}: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function loadEvent(id) {
    return validateEvent(await fetchJSON(`events/${id}.json`), id);
  }

  function archiveSection(title, events, emptyMessage, kind) {
    const section = element("section", `seminar-section seminar-section--${kind}`);
    const header = element("header", "section-heading");
    header.append(element("h2", "", title));
    if (kind === "past" && events.length) {
      header.append(element("p", "section-count", `${events.length} ${events.length === 1 ? "talk" : "talks"}`));
    }
    section.append(header);
    if (!events.length) {
      section.append(element("p", "empty-state", emptyMessage));
      return section;
    }
    const list = element("ul", "event-list");
    for (const event of events) {
      const item = element("li", "event-item");
      const when = element("div", "event-when");
      const date = element("time", "event-date", formatDate(event.date));
      date.dateTime = event.date;
      when.append(date);
      if (kind === "upcoming") {
        const time = formatTime(event);
        if (time) when.append(element("p", "event-time", time));
      }
      const summary = element("div", "event-summary");
      const heading = element("h3", "event-title");
      heading.append(link(event.title, `?event=${event.id}`));
      summary.append(heading, element("p", "event-speaker", event.speaker));
      item.append(when, summary);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function renderArchive(events, failureCount, now) {
    const groups = groupEvents(events, now);
    document.title = SERIES;
    content.replaceChildren();
    if (failureCount) {
      const notice = element("p", "notice", "Some talks could not be loaded. The available talks are shown below. Please try again later for the complete archive.");
      notice.setAttribute("role", "status");
      content.append(notice);
    }
    content.append(
      archiveSection("Upcoming Talks", groups.upcoming, "No upcoming talks have been announced.", "upcoming"),
      archiveSection("Past Talks", groups.past, "No past talks have been added yet.", "past")
    );
  }

  async function showArchive() {
    showLoading("Loading talks…");
    try {
      const index = await fetchJSON("events/index.json");
      if (!Array.isArray(index)) throw new Error("The seminar index must be an array");
      const ids = [...new Set(index.filter(id => calendarDate(id)))];
      const invalidCount = index.filter(id => !calendarDate(id)).length;
      const results = await Promise.allSettled(ids.map(loadEvent));
      const events = [];
      let failureCount = invalidCount;
      for (const result of results) {
        if (result.status === "fulfilled") events.push(result.value);
        else {
          failureCount += 1;
          console.warn("A seminar could not be loaded.", result.reason);
        }
      }
      if (!events.length && failureCount) throw new Error("No listed seminars could be loaded");
      watchArchiving(events, now => renderArchive(events, failureCount, now));
    } catch (error) {
      console.warn("The talk archive could not be loaded.", error);
      showError("Talks unavailable", "We couldn’t load the talk archive. Please refresh the page or try again later.");
    }
  }

  function renderDetail(event, now) {
    document.title = event.date;
    const upcoming = isUpcoming(event, now);
    document.querySelector(".timezone-note").hidden = !upcoming;
    const article = element("article", "seminar-detail");
    const dateLine = element("p", "detail-date");
    const date = element("time", "", formatDate(event.date));
    date.dateTime = event.date;
    dateLine.append(date);
    if (upcoming) {
      const time = formatTime(event);
      if (time) dateLine.append(document.createTextNode(` · ${time}`));
    }
    article.append(dateLine, element("h2", "detail-title", event.title), element("p", "detail-speaker", event.speaker));
    if (event.affiliation) article.append(element("p", "detail-affiliation", event.affiliation));
    if (upcoming && event.location) article.append(element("p", "detail-meta", `Location: ${event.location}`));
    if (event.abstract) {
      const abstract = element("section", "abstract");
      const body = element("div", "abstract-body");
      body.append(element("p", "", event.abstract));
      abstract.append(element("h3", "", "Abstract"), body);
      article.append(abstract);
    }
    if (upcoming && event.bio) {
      const bio = element("section", "speaker-bio");
      bio.append(element("h3", "", "About the speaker"));
      for (const paragraph of event.bio.split(/\r\n|[\r\n\u2028\u2029]/).map(text).filter(Boolean)) {
        bio.append(element("p", "", paragraph));
      }
      article.append(bio);
    }
    content.replaceChildren(link("← All talks", "./", "back-link"), article);
    if (upcoming) {
      import("./rsvp.js?v=20261001-1").then(({ createRsvpControl }) => {
        if (!article.isConnected) return;
        article.insertBefore(createRsvpControl(event.id), article.querySelector(".abstract") || article.querySelector(".speaker-bio"));
      }).catch(error => {
        console.warn("RSVP is unavailable.", error);
        if (article.isConnected) article.append(element("p", "notice", "RSVP is temporarily unavailable."));
      });
    }
    // Every abstract follows the same pipeline: original JSON -> safe text DOM
    // -> display-only TeX preparation -> scoped formula rendering (or raw text).
    if (event.abstract) {
      const body = article.querySelector(".abstract-body");
      import("./math.js")
        .then(({ renderAbstract }) => renderAbstract(body, event.abstract))
        .catch(error => console.warn("Formula rendering is unavailable; showing the original abstract.", error));
    }
  }

  async function showDetail(id) {
    showLoading("Loading talk…");
    if (!calendarDate(id)) {
      showError("Invalid talk link", "This talk link is not valid. Please choose a talk from the archive.", true);
      return;
    }
    try {
      const event = await loadEvent(id);
      watchArchiving([event], now => renderDetail(event, now));
    } catch (error) {
      console.warn("The seminar could not be loaded.", error);
      if (error.status === 404) showError("Talk not found", "This talk may not have been added yet. Please check the archive for available talks.", true);
      else showError("Talk unavailable", "We couldn’t load this talk’s details. Please try again later or return to the archive.", true);
    }
  }

  async function start() {
    const parameters = new URLSearchParams(window.location.search);
    setupNavigation(parameters.has("event"));
    try {
      if (parameters.has("event")) await showDetail(parameters.get("event"));
      else await showArchive();
    } finally {
      content.setAttribute("aria-busy", "false");
    }
  }

  start();
})();
