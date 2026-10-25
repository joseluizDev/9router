#!/usr/bin/env node
/**
 * opencode-shim: expõe o binário do OpenCode instalado como API OpenAI-compatible.
 *
 * Por que existe: os modelos "-free" só respondem pelo canal do app (Bearer public +
 * fingerprint de tools/sessão + quota por sessão). O binário local já passa por tudo
 * isso, então o shim só o encapsula — nada de imitar fingerprint.
 *
 *   node work/opencode-shim.mjs            # porta 4399
 *   OPENCODE_CLI=/opt/OpenCode/resources/opencode-cli PORT=4399 node ...
 *
 * GET  /v1/models              -> lista os free que respondem
 * POST /v1/chat/completions    -> {model:"glm-5.3-flash-free", messages, stream}
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const CLI = process.env.OPENCODE_CLI || "/opt/OpenCode/resources/opencode-cli";
const PORT = Number(process.env.PORT || 4399);
const TIMEOUT_MS = Number(process.env.OPENCODE_TIMEOUT_MS || 180_000);

// Medidos: respondem via CLI. cat-jam/longcat/jev não existem nessa lane.
export const MODELS = [
  "glm-5.3-flash-free",
  "deepseek-v4.1-flash-free",
  "mimo-v2.6-flash-free",
  "flint-40b-free",
  "beam-free",
  "big-pickle",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
];

const textOf = (messages) =>
  (Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((p) => p?.text || "").join("")))
    .join("\n\n")
    .trim();

function runCli(model, prompt, onDelta) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, ["run", "--format", "json", "-m", `opencode/${model}`, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "", err = "", out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev?.type === "text" && typeof ev.part?.text === "string") {
          out += ev.part.text;
          onDelta?.(ev.part.text);
        }
      }
    });
    child.stderr.on("data", (c) => { err += c.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      reject(new Error(err.trim().split("\n").pop() || `opencode-cli saiu com código ${code}`));
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/v1/models")) {
    return json(res, 200, {
      object: "list",
      data: MODELS.map((id) => ({ id, object: "model", owned_by: "opencode-local" })),
    });
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/chat/completions")) {
    return json(res, 404, { error: { type: "not_found", message: req.url } });
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw); } catch { return json(res, 400, { error: { type: "invalid_json", message: "corpo inválido" } }); }

  const model = String(body.model || "").replace(/^opencode\//, "");
  if (!MODELS.includes(model)) {
    return json(res, 400, { error: { type: "model_not_supported", message: `modelo '${model}' não está na lista local`, models: MODELS } });
  }
  const prompt = textOf(body.messages);
  if (!prompt) return json(res, 400, { error: { type: "invalid_request", message: "messages sem conteúdo de usuário" } });

  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);

  if (!body.stream) {
    try {
      const text = await runCli(model, prompt);
      return json(res, 200, {
        id, object: "chat.completion", created, model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (e) {
      return json(res, 502, { error: { type: "upstream_error", message: e.message } });
    }
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  try {
    await runCli(model, prompt, (text) =>
      send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
    send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  } catch (e) {
    send({ error: { type: "upstream_error", message: e.message } });
  }
  res.write("data: [DONE]\n\n");
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`opencode-shim: http://127.0.0.1:${PORT}/v1  (cli: ${CLI})`);
});
