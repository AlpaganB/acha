const $ = id => document.getElementById(id);
const storageKey = "acha-crew-demo-v1";
let cache;
try { cache = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { cache = {}; }
cache.pending ??= [];
cache.history ??= [];
cache.rejected ??= [];
const save = () => localStorage.setItem(storageKey, JSON.stringify(cache));
const statuses = { no_flags: "No configured flags", review: "Review", urgent: "Urgent", insufficient_data: "Incomplete data" };
const names = key => cache.config.metrics[key]?.[0] || key?.replaceAll("_", " ") || "";
let busy = false;

function node(tag, content, parent, cls) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = content;
  if (cls) element.className = cls;
  if (parent) parent.append(element);
  return element;
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || ("HTTP " + response.status));
    error.http = true;
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function activeMetrics() {
  return Object.keys(cache.config.metrics).filter(key => cache.config.profiles[$("profile").value].has_cuff || !key.endsWith("_bp"));
}

function showFields() {
  $("measurements").replaceChildren();
  $("instructions").replaceChildren();
  for (const key of activeMetrics()) {
    const [name, unit, min, max, step, baseline, guide] = cache.config.metrics[key];
    const card = node("div", null, $("measurements"), "metric");
    const label = node("label", name + " (" + unit + ")", card);
    label.htmlFor = "reading-" + key;
    const input = node("input", null, card);
    Object.assign(input, {id: label.htmlFor, type: "number", min, max, step, placeholder: baseline});
    const failure = node("select", null, card);
    failure.id = "failure-" + key;
    failure.setAttribute("aria-label", name + " availability");
    for (const [value, title] of [["", "Enter a measurement"], ["equipment_unavailable", "Equipment unavailable"], ["unable_to_obtain", "Attempted, no reading"]]) {
      const option = node("option", title, failure);
      option.value = value;
    }
    failure.onchange = () => { input.disabled = Boolean(failure.value); if (input.disabled) input.value = ""; };
    node("dt", name, $("instructions"));
    node("dd", guide, $("instructions"));
  }
  updateReminder();
  showHistory();
}

function renderGuide(guide, parent, open = false) {
  const detail = node("details", null, parent);
  detail.open = open;
  node("summary", guide.title, detail);
  const list = node("ol", null, detail);
  guide.steps.forEach(step => node("li", step, list));
  const source = node("a", "Reference", detail);
  source.href = guide.source;
  source.target = "_blank";
  source.rel = "noopener";
}

function showResult(result) {
  const box = $("result-body");
  box.replaceChildren();
  node("span", statuses[result.status], box, "pill " + result.status);
  node("p", result.next_step, box);
  if (result.news2) {
    const n = result.news2;
    node("p", n.complete ? "NEWS2 reference score " + n.total_score : "NEWS2 incomplete · partial points " + n.partial_score, box, "muted");
    const detail = node("details", null, box);
    node("summary", "Score components", detail);
    const list = node("ul", null, detail);
    n.components.forEach(c => node("li", names(c.parameter) + " · " + c.score + " points", list));
  }
  if (!result.trend_available) node("p", "The pulse trend needs more observations across both time windows.", box, "muted");
  const list = node("ul", null, box);
  for (const finding of result.rationale) {
    let text = [names(finding.metric || finding.symptom), finding.code.replaceAll("_", " ")].filter(Boolean).join(" · ");
    if (finding.compared_value != null) text += " (" + Number(finding.compared_value.toFixed(2)) + " " + (finding.unit || "") + ")";
    node("li", text, list);
  }
  const protocols = [...new Set([result.protocol_id, ...result.rationale.map(row => row.protocol_id)].filter(Boolean))];
  protocols.forEach((id, index) => {
    if (cache.config.guides[id]) renderGuide(cache.config.guides[id], box, index === 0);
  });
}

function updateReminder() {
  const profile = $("profile").value;
  const interval = cache.config.profiles[profile].interval_hours;
  const last = cache.history.find(row => row.payload.profile === profile)?.result.assessed_at;
  if (!last) { $("reminder").textContent = "First check-in due · interval " + interval + " h."; return; }
  const due = new Date(Date.parse(last) + interval * 3600000);
  $("reminder").textContent = due <= new Date() ? "Routine check-in due." : "Next check-in " + due.toLocaleString();
}

function showHistory() {
  const box = $("history-body");
  const chart = $("trend");
  box.replaceChildren();
  chart.replaceChildren();
  const rows = cache.history.filter(row => row.payload.profile === $("profile").value);
  const values = rows.map(row => row.payload.readings.pulse_rate?.value).filter(Number.isFinite).slice(0, 12).reverse();
  if (values.length > 1) {
    const canvas = node("canvas", null, chart);
    canvas.width = 640; canvas.height = 110; canvas.style.maxWidth = "100%";
    const ctx = canvas.getContext("2d");
    const low = Math.min(...values) - 1, high = Math.max(...values) + 1;
    ctx.strokeStyle = "#70d9bc"; ctx.lineWidth = 3; ctx.beginPath();
    values.forEach((v, i) => ctx[i ? "lineTo" : "moveTo"](14 + 612 * i / (values.length - 1), 96 - 82 * (v - low) / (high - low)));
    ctx.stroke();
    node("p", "Pulse trend · " + values.join(" → ") + " bpm", chart, "muted");
  }
  if (!rows.length) node("p", "No saved observations for this profile.", box, "muted");
  for (const row of rows) {
    const detail = node("details", null, box, "record");
    node("summary", new Date(row.result.assessed_at).toLocaleString() + " · " + statuses[row.result.status] +
         " · " + (row.synced ? "Ground acknowledged" : "Onboard"), detail);
    const list = node("ul", null, detail);
    Object.entries(row.payload.readings).forEach(([key, reading]) => node("li", names(key) + " " + reading.value + " " + reading.unit, list));
    Object.entries(row.payload.failures || {}).forEach(([key, reason]) => node("li", names(key) + " · " + reason.replaceAll("_", " "), list));
    const button = node("button", "Open assessment", detail);
    button.onclick = () => { showResult(row.result); $("result").scrollIntoView(); };
  }
  $("sync-status").textContent = cache.pending.length + " waiting for onboard evaluation · " +
    cache.history.filter(row => !row.synced).length + " awaiting simulated ground handover";
  if (cache.rejected.length) {
    $("sync-status").textContent += " · " + cache.rejected.length + " rejected check-in(s)";
    const detail = node("details", null, box, "record");
    node("summary", "Rejected check-ins", detail);
    for (const record of cache.rejected) node("p", record.payload.captured_at + " · " + record.error, detail);
  }
}

async function refresh() {
  cache.history = await api("/api/history");
  save(); showHistory(); updateReminder();
  $("network").textContent = "Onboard station connected";
}

async function flush() {
  const rejections = [];
  while (cache.pending.length) {
    try {
      const result = await api("/api/checkins", cache.pending[0]);
      cache.pending.shift(); save(); showResult(result);
    } catch (error) {
      if (!error.http || error.status >= 500) throw error;
      cache.rejected.push({payload: cache.pending.shift(), error: error.message});
      save(); rejections.push(error.message);
    }
  }
  await refresh();
  if (rejections.length) throw Object.assign(new Error(rejections.join(" ")), {http: true});
}

async function execute(operation) {
  if (busy) return;
  busy = true;
  try { await operation(); }
  catch (error) {
    $("message").textContent = error.http ? error.message : "Onboard station unreachable. Queued readings and emergency guides remain available.";
    if (!error.http) $("network").textContent = "Onboard station unavailable";
    showHistory();
  } finally { busy = false; }
}

function fillScenario(scenario) {
  for (const key of activeMetrics()) {
    const failure = $("failure-" + key);
    failure.value = ""; failure.onchange();
    $("reading-" + key).value = scenario === "urgent" && key === "temperature" ? "" :
      scenario === "drift" && key === "pulse_rate" ? 86 : cache.config.metrics[key][5];
  }
  for (const key of Object.keys(cache.config.symptoms)) $("symptom-" + key).checked = scenario === "urgent" && key === "chest_pain";
  $("confirm").checked = true; $("oxygen").value = "false";
  $("message").textContent = "Scenario loaded. Select Save and evaluate.";
}

async function init() {
  try { cache.config = await api("/api/config"); save(); } catch {}
  if (!cache.config) { $("network").textContent = "Start the onboard server to load the app."; return; }
  for (const [id, profile] of Object.entries(cache.config.profiles)) {
    const option = node("option", profile.name, $("profile")); option.value = id;
  }
  $("profile").value = cache.profile in cache.config.profiles ? cache.profile : Object.keys(cache.config.profiles)[0];
  for (const [key, label] of Object.entries(cache.config.symptoms)) {
    const option = node("label", null, $("symptoms"), "option");
    const check = node("input", null, option);
    Object.assign(check, {type: "checkbox", id: "symptom-" + key});
    option.append(document.createTextNode(label));
  }
  Object.values(cache.config.guides).forEach(guide => renderGuide(guide, $("guide-body")));
  $("profile").onchange = () => { cache.profile = $("profile").value; save(); showFields(); };
  showFields();
  for (const scenario of ["routine", "drift", "urgent"]) $(scenario).onclick = () => fillScenario(scenario);
  $("checkin").onsubmit = event => {
    event.preventDefault();
    execute(async () => {
      const stamp = new Date().toISOString(), readings = {}, failures = {};
      for (const key of activeMetrics()) {
        const reading = $("reading-" + key), failure = $("failure-" + key).value;
        if (failure) failures[key] = failure;
        else if (reading.value !== "") readings[key] = {value: reading.valueAsNumber, unit: cache.config.metrics[key][1], measured_at: stamp};
      }
      if (readings.systolic_bp && readings.diastolic_bp && readings.systolic_bp.value <= readings.diastolic_bp.value) {
        $("message").textContent = "The upper blood pressure value must exceed the lower value."; return;
      }
      const payload = {id: crypto.randomUUID(), captured_at: stamp, profile: $("profile").value, readings, failures,
        symptoms: Object.keys(cache.config.symptoms).filter(key => $("symptom-" + key).checked),
        supplemental_oxygen: $("oxygen").value === "" ? null : $("oxygen").value === "true"};
      const emergencyGuides = {chest_pain: "DEMO-CHEST", breathing_difficulty: "DEMO-BREATHING",
        unresponsive: "DEMO-UNRESPONSIVE", new_confusion: "DEMO-URGENT"};
      const immediateGuide = payload.symptoms.map(key => cache.config.guides[emergencyGuides[key]]).find(Boolean);
      if (immediateGuide) {
        $("result-body").replaceChildren();
        renderGuide(immediateGuide, $("result-body"), true);
      }
      cache.pending.push(payload); save();
      await flush(); $("message").textContent = "Saved on the onboard station.";
    });
  };
  $("sync").onclick = () => execute(async () => {
    await flush();
    const reply = await api("/api/sync", {});
    await refresh();
    $("message").textContent = reply.acknowledged + " check-in(s) acknowledged by the simulated ground inbox.";
    $("sync-status").textContent += " · " + reply.total_received + " received";
  });
  window.addEventListener("online", () => execute(flush));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  await execute(flush);
}
init();
