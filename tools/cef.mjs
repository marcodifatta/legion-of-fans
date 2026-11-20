// Talk to Steam's CEF remote debugger on the Legion Go through an SSH tunnel.
// Start the tunnel first:  ssh -N -L 9222:127.0.0.1:8080 <user>@<legion-go-address>
// (Steam must have remote debugging enabled: ~/.steam/steam/.cef-enable-remote-debugging,
// which Decky's developer mode creates.)
//
//   node tools/cef.mjs targets
//   node tools/cef.mjs eval  <targetTitlePrefix> "<js expression>"
//   node tools/cef.mjs shot  <targetTitlePrefix> out.png
const PORT = process.env.CEF_PORT ?? "9222";
const [, , cmd, target, arg] = process.argv;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
if (cmd === "targets") {
  for (const t of targets) console.log(`${t.title} | ${t.url.slice(0, 80)}`);
  process.exit(0);
}
const t = targets.find((x) => x.title.startsWith(target));
if (!t) {
  console.error(`target "${target}" not found`);
  process.exit(1);
}
const wsUrl = t.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${PORT}`);
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await new Promise((r) => (ws.onopen = r));

if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result ?? r, null, 2));
} else if (cmd === "shot") {
  const fs = await import("node:fs");
  // Optional CLIP_WIDTH env: keep only the left part of the page (the QAM panel).
  const params = { format: "png", captureBeyondViewport: true };
  if (process.env.CLIP_WIDTH) {
    const m = await send("Page.getLayoutMetrics");
    const h = m.result.cssVisualViewport?.clientHeight ?? m.result.layoutViewport.clientHeight;
    params.clip = { x: 0, y: 0, width: Number(process.env.CLIP_WIDTH), height: h, scale: 1 };
  }
  const r = await send("Page.captureScreenshot", params);
  if (!r.result?.data) {
    console.error(JSON.stringify(r));
    process.exit(1);
  }
  fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  console.log(`saved ${arg}`);
}
ws.close();
