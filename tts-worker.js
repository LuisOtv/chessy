// Voz do coach com o Kokoro (modelo de voz por IA, só inglês).
// O modelo é baixado uma vez e fica no cache do navegador.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let loading = null;
let latest = 0;                 // token da fala mais recente; trabalho antigo é descartado
let chain = Promise.resolve();  // gera uma frase por vez
const cache = new Map();        // "voz|texto" -> { samples, rate }

const progress = (p) => {
  if (p.status === "progress" && p.file && p.file.endsWith(".onnx")) self.postMessage({ type: "progress", progress: p.progress });
};

// Placa de vídeo (WebGPU) é muito mais rápida; sem ela, CPU com o modelo comprimido
async function create() {
  try {
    const adapter = self.navigator.gpu && (await self.navigator.gpu.requestAdapter());
    if (adapter) return await KokoroTTS.from_pretrained(MODEL, { dtype: "fp32", device: "webgpu", progress_callback: progress });
  } catch (err) {
    console.warn("WebGPU indisponível, usando CPU:", err);
  }
  // Modelo completo (fp32, ~320 MB): na CPU soa mais natural E gera mais rápido que o comprimido (q8)
  return KokoroTTS.from_pretrained(MODEL, { dtype: "fp32", device: "wasm", progress_callback: progress });
}

function load() {
  if (!loading) {
    loading = create().then((tts) => { self.postMessage({ type: "ready" }); return tts; });
    loading.catch(() => { loading = null; });
  }
  return loading;
}

async function synth(voice, text, speed = 1) {
  const key = voice + "|" + speed + "|" + text;
  if (!cache.has(key)) {
    const out = await (await load()).generate(text, { voice, speed });
    cache.set(key, { samples: out.audio, rate: out.sampling_rate });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

function send(token, idx, a) {
  self.postMessage({ type: "audio", token, idx, samples: a.samples.slice(), rate: a.rate });
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "load") {
    load().catch((err) => self.postMessage({ type: "error", message: String(err) }));
  } else if (msg.type === "cancel") {
    latest = Math.max(latest, msg.token);
  } else if (msg.type === "speak") {
    latest = Math.max(latest, msg.token);
    const hit = cache.get(msg.voice + "|" + msg.speed + "|" + msg.text);
    if (hit) return send(msg.token, msg.idx, hit); // já gerado: toca na hora
    chain = chain.then(async () => {
      if (msg.token !== latest) return;
      try {
        const a = await synth(msg.voice, msg.text, msg.speed);
        if (msg.token === latest) send(msg.token, msg.idx, a);
      } catch (err) {
        self.postMessage({ type: "error", token: msg.token, message: String(err) });
      }
    });
  } else if (msg.type === "prefetch") {
    // gera em segundo plano a fala do próximo lance; desiste se o usuário já mudou de lance
    const tok = latest;
    chain = chain.then(async () => {
      if (tok < latest) return;
      try { await synth(msg.voice, msg.text, msg.speed); } catch (_) { /* opcional */ }
    });
  }
};
