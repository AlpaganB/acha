import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL("mission_demo.json", root), "utf8"));
const elements = new Map();
function element(tag) {
  const item = {
    tag, children: [], value: "", textContent: "", style: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    scrollIntoView() {},
    get valueAsNumber() { return Number(this.value); },
  };
  Object.defineProperty(item, "id", {set(id) { elements.set(id, item); }, get() { return [...elements].find(([, x]) => x === item)?.[0]; }});
  return item;
}
const data = new Map();
let network = true;
const calls = [];
const events = {};
const api = async (path, request) => {
  if (!network) throw new TypeError("disconnected");
  if (request?.body) calls.push(JSON.parse(request.body));
  const value = path === "/api/config" ? config : path === "/api/history" ? [] :
    {status:"urgent", next_step:"Open the crew emergency guide now.", rationale:[],
     protocol_id:"DEMO-CHEST", trend_available:false};
  return {ok:true, json: async () => value};
};
const context = vm.createContext({
  fetch: api,
  localStorage: {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)},
  document: {
    getElementById(id) {
      if (!elements.has(id)) {
        const fixture = element("fixture");
        fixture.id = id;
      }
      return elements.get(id);
    },
    createElement: element, createTextNode: text => text,
  },
  navigator: {serviceWorker:{register: async () => {}}},
  window: {addEventListener: (event, handler) => { events[event] = handler; }},
  crypto, console,
});
const appScript = fs.readFileSync(new URL("web/app.js", root), "utf8");
await vm.runInContext(appScript, context);
await new Promise(resolve => setImmediate(resolve));
function get(id) { return elements.get(id); }
get("profile").value = "orbital";
get("profile").onchange();
get("urgent").onclick();
network = false;
get("checkin").onsubmit({preventDefault() {}});
await new Promise(resolve => setImmediate(resolve));
const saved = () => JSON.parse([...data.values()][0]);
assert.equal(saved().pending.length, 1);
assert.deepEqual(saved().pending[0].symptoms, ["chest_pain"]);
assert.match(get("message").textContent, /unreachable/);
assert.ok(get("result-body").children.some(child => child.open && child.children[0].textContent === "Chest pain or pressure"));
network = true;
await events.online();
assert.equal(saved().pending.length, 0);
assert.equal(calls.length, 1);

const handlers = {};
const worker = vm.createContext({
  self: {addEventListener: (name, handler) => { handlers[name] = handler; },
         skipWaiting: async () => {}, clients: {claim: async () => {}}},
  caches: {open: async () => ({addAll: async paths => { assert.ok(paths.includes("/api/config")); }}),
           match: async () => "cached guide config"},
  fetch: async () => { throw new Error("disconnected"); },
  URL,
});
vm.runInContext(fs.readFileSync(new URL("web/sw.js", root), "utf8"), worker);
let result;
handlers.install({waitUntil: work => { result = work; }});
await result;
handlers.fetch({request: {method:"GET", url:"http://localhost/api/config"}, respondWith: work => { result = work; }});
assert.equal(await result, "cached guide config");
console.log("Browser-script harness passed offline emergency guide, persisted queue, replay, and cache fallback.");
