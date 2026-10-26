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
 *
 * O shim também responde sob /inference/v1/* para ser drop-in do provider
 * opencode (buildUrl monta `${base}/inference/v1/...`), então basta apontar
 * OPENCODE_SHIM_URL=http://127.0.0.1:4399 (ou o baseUrl da conexão) para o
 * router passar a usar o CLI local em vez do upstream.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";

const CLI = process.env.OPENCODE_CLI || "/opt/OpenCode/resources/opencode-cli";
const PORT = Number(process.env.PORT || 4399);
const HOST = process.env.HOST || "127.0.0.1";
const TIMEOUT_MS = Number(process.env.OPENCODE_TIMEOUT_MS || 180_000);
const WORKDIR = process.env.OPENCODE_WORKDIR || "/tmp/opencode/plain";

try { mkdirSync(WORKDIR, { recursive: true }); } catch {}

// Medidos: respondem via CLI.
export const MODELS = [
  "glm-5.3-flash-free",
  "deepseek-v4.1-flash-free",
  "mimo-v2.6-flash-free",
  "flint-40b-free",
  "beam-free",
  "big-pickle",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
];

const textOf = (messages) =>
  (Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === "user" || m?.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((p) => p?.text || "").join("")))
    .join("\n\n")
    .trim();

function runCli(model, prompt, onDelta) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, ["run", "--format", "json", "-m", `opencode/${model}`, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: WORKDIR,
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
        if (ev?.type === "error") {
          const msg = ev?.error?.message || ev?.message || "";
          if (msg) err = (err ? err + "\n" : "") + msg;
        }
      }
    });
    child.stderr.on("data", (c) => { err += c.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const last = err.trim().split("\n").pop() || `opencode-cli saiu com código ${code}`;
      const e = new Error(last);
      e.stderr = err.trim();
      e.code = code;
      if (/free.limit|free-limit|free usage limit|FreeUsageLimit/i.test(err)) e.status = 429;
      reject(e);
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const json = (res, status, body, extra = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    ...extra,
  });
  res.end(payload);
};

const handleModels = (res) => json(res, 200, {
  object: "list",
  data: MODELS.map((id) => ({ id, object: "model", owned_by: "opencode-local" })),
});

const handleChat = async (req, res) => {
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
      const status = e.status || 502;
      return json(res, status, { error: { type: status === 429 ? "FreeUsageLimitError" : "upstream_error", message: e.message } });
    }
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  try {
    await runCli(model, prompt, (text) =>
      send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }));
    send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  } catch (e) {
    const status = e.status || 502;
    send({ error: { type: status === 429 ? "FreeUsageLimitError" : "upstream_error", message: e.message } });
  }
  res.write("data: [DONE]\n\n");
  res.end();
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    });
    return res.end();
  }

  const url = (req.url || "").split("?")[0];
  const isModels = url === "/v1/models" || url === "/inference/v1/models" || url.endsWith("/models");
  const isChat = url === "/v1/chat/completions" || url === "/inference/v1/chat/completions" || url.endsWith("/chat/completions");

  if (req.method === "GET" && isModels) return handleModels(res);
  if (req.method === "POST" && isChat) return handleChat(req, res);

  if (req.method === "GET" && (url === "/" || url === "/health" || url === "/healthz")) {
    return json(res, 200, { status: "ok", models: MODELS.length });
  }

  return json(res, 404, { error: { type: "not_found", message: url } });
});

server.listen(PORT, HOST, () => {
  console.log(`opencode-shim: http://${HOST}:${PORT}/v1  (cli: ${CLI})`);
});

const shutdown = () => { try { server.close(() => process.exit(0)); } catch { process.exit(0); } };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
