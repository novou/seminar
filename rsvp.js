import { RSVP_ENDPOINT } from "./rsvp-config.js";

const CLIENT_KEY = "seminar-client-id";
const STATE_PREFIX = "seminar-rsvp-";

export function validClientId(value) {
  return typeof value === "string" && value === value.trim() && /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(value);
}

export function validEventId(value) {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://script.google.com" &&
      url.pathname.endsWith("/exec") && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function randomId(cryptoApi = window.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("This browser cannot create an anonymous RSVP.");
  return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function appsScriptOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "script.google.com" ||
      /^(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(url.hostname));
  } catch {
    return false;
  }
}

function belongsToFrame(source, frameWindow) {
  // HtmlService adds its own nested sandbox iframe. Inspect window references,
  // never the contents of a cross-origin document.
  try {
    for (let depth = 0; source && depth < 4; depth += 1) {
      if (source === frameWindow) return true;
      if (source.parent === source) break;
      source = source.parent;
    }
  } catch { /* A receipt we cannot associate with our frame is ignored. */ }
  return false;
}

export function submitRsvp({ endpoint, eventId, clientId, action }) {
  if (!validEndpoint(endpoint) || !validEventId(eventId) || !validClientId(clientId) || !["yes", "cancel"].includes(action)) {
    return Promise.reject(new Error("Could not submit RSVP. Please try again."));
  }
  return new Promise((resolve, reject) => {
    const requestId = randomId();
    const expectedStatus = action === "yes" ? "yes" : "no";
    const frame = document.createElement("iframe");
    frame.name = `seminar-rsvp-${requestId}`;
    frame.title = "RSVP submission";
    frame.hidden = true;
    frame.referrerPolicy = "no-referrer";
    const form = document.createElement("form");
    form.method = "POST";
    form.action = endpoint;
    form.target = frame.name;
    form.hidden = true;
    for (const [name, value] of Object.entries({
      event_id: eventId, client_id: clientId, action,
      request_id: requestId, return_origin: window.location.origin
    })) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    let timeout;
    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      form.remove();
      frame.remove();
    }
    function receive(event) {
      const data = event.data;
      if (!appsScriptOrigin(event.origin) || !belongsToFrame(event.source, frame.contentWindow) ||
          !data || data.type !== "common-ground-rsvp" || data.request_id !== requestId || data.event_id !== eventId) return;
      if (data.ok === true && data.status === expectedStatus) {
        cleanup();
        resolve(expectedStatus);
      } else if (data.ok === false) {
        cleanup();
        const message = typeof data.error === "string" && data.error.length <= 200 ? data.error : "Could not submit RSVP. Please try again.";
        reject(new Error(message));
      }
    }
    window.addEventListener("message", receive);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Could not confirm your RSVP. Please try again."));
    }, 30000);
    try {
      document.body.append(frame, form);
      // A form's load event is not proof of a successful write. Only the matching
      // receipt returned after Sheets is updated can confirm registration.
      form.submit();
    } catch {
      cleanup();
      reject(new Error("Could not submit RSVP. Please try again."));
    }
  });
}

export function createRsvpControl(eventId, options = {}) {
  if (!validEventId(eventId)) throw new Error("Invalid RSVP event.");
  const endpoint = options.endpoint ?? RSVP_ENDPOINT;
  const send = options.submit ?? submitRsvp;
  const block = document.createElement("section");
  block.className = "rsvp-block";
  block.setAttribute("aria-label", "RSVP");
  const heading = document.createElement("h3");
  heading.textContent = "RSVP";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rsvp-button";
  const message = document.createElement("p");
  message.className = "rsvp-status";
  message.id = `rsvp-status-${eventId}`;
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");
  button.setAttribute("aria-describedby", message.id);
  block.append(heading, button, message);

  let storage;
  let clientId = "";
  let status = "no";
  let pending = false;
  let storageUnavailable = false;
  try {
    storage = Object.prototype.hasOwnProperty.call(options, "storage") ? options.storage : window.localStorage;
    clientId = storage.getItem(CLIENT_KEY) || "";
    if (!validClientId(clientId)) clientId = "";
    if (clientId && storage.getItem(STATE_PREFIX + eventId) === "yes") status = "yes";
  } catch {
    storageUnavailable = true;
  }
  const configured = validEndpoint(endpoint);
  function updateButton() {
    button.disabled = pending || !configured || storageUnavailable;
    button.textContent = pending ? (status === "yes" ? "Cancelling…" : "Submitting…") :
      (status === "yes" ? "Cancel RSVP" : "Count me in");
    block.setAttribute("aria-busy", String(pending));
  }
  if (!configured) message.textContent = "RSVP is not available yet.";
  else if (storageUnavailable) message.textContent = "This browser cannot save RSVP settings. Enable site storage and reload.";
  else if (status === "yes") message.textContent = "✓ You are registered.";
  updateButton();

  button.addEventListener("click", async () => {
    if (button.disabled || pending) return;
    try {
      if (!clientId) clientId = randomId();
      storage.setItem(CLIENT_KEY, clientId);
      if (storage.getItem(CLIENT_KEY) !== clientId) throw new Error("Storage was not saved.");
    } catch {
      message.textContent = "This browser cannot save RSVP settings. Enable site storage and try again.";
      return;
    }
    const action = status === "yes" ? "cancel" : "yes";
    pending = true;
    message.textContent = action === "yes" ? "Sending RSVP…" : "Cancelling RSVP…";
    updateButton();
    try {
      const confirmed = await send({ endpoint, eventId, clientId, action });
      if (confirmed !== (action === "yes" ? "yes" : "no")) throw new Error("Could not confirm your RSVP. Please try again.");
      status = confirmed;
      let remembered = true;
      try {
        storage.setItem(STATE_PREFIX + eventId, status);
        remembered = storage.getItem(STATE_PREFIX + eventId) === status;
      } catch { remembered = false; }
      message.textContent = status === "yes" ? "✓ You are registered." : "RSVP cancelled.";
      if (!remembered) message.textContent += " Your choice was saved, but this browser could not remember it.";
    } catch (error) {
      message.textContent = error?.message || "Could not submit RSVP. Please try again.";
    } finally {
      pending = false;
      updateButton();
    }
  });
  return block;
}
