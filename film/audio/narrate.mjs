// Voices film/audio/narration.json with ElevenLabs. Lines that follow each other without a pause in
// stage/acts.json are voiced together as one chunk, so the read flows like one take; the neighbouring
// chunks go along as context. Each chunk comes back with character timestamps, which trim_vo.py
// turns into line and word timings. The key comes from ELEVENLABS_API_KEY and is never written
// anywhere. Chunks that already exist are kept, because the API meters characters; --force re-voices.
//
//   ELEVENLABS_API_KEY=... node film/audio/narrate.mjs [--force] [--voice <id>] [chunk-id ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(join(here, "narration.json"), "utf8"));
const acts = JSON.parse(readFileSync(join(here, "../stage/acts.json"), "utf8")).acts;
const out = join(here, "../out/vo");
mkdirSync(out, { recursive: true });
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const args = process.argv.slice(2);
const force = args.includes("--force");
const voiceAt = args.indexOf("--voice");
const voice = voiceAt >= 0 ? args[voiceAt + 1] : script.voice.id;
const wanted = args.filter((a, i) => !a.startsWith("--") && !(voiceAt >= 0 && i === voiceAt + 1));

const text = new Map(script.lines.map((l) => [l.id, l.text]));
// A chunk is a run of lines in one act with no pause between them; its id is its first line.
const chunks = [];
for (const act of acts)
  for (const [id, gap] of act.lines) {
    if (gap > 0 || !chunks.length || chunks.at(-1).act !== act.id) chunks.push({ id, act: act.id, lines: [] });
    chunks.at(-1).lines.push(id);
  }
writeFileSync(join(out, "chunks.json"), JSON.stringify(chunks, null, 1));

for (const [index, chunk] of chunks.entries()) {
  if (wanted.length && !wanted.includes(chunk.id)) continue;
  const file = join(out, `${chunk.id}.mp3`);
  if (existsSync(file) && !force) continue;
  const body = {
    text: chunk.lines.map((id) => text.get(id)).join(" "),
    model_id: script.model,
    voice_settings: script.settings,
    previous_text: chunks[index - 1]?.lines.map((id) => text.get(id)).join(" "),
    next_text: chunks[index + 1]?.lines.map((id) => text.get(id)).join(" "),
  };
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${chunk.id}: HTTP ${response.status} ${await response.text()}`);
  const result = await response.json();
  writeFileSync(file, Buffer.from(result.audio_base64, "base64"));
  writeFileSync(join(out, `${chunk.id}.align.json`), JSON.stringify({ text: body.text, lines: chunk.lines, alignment: result.alignment }));
  console.log(`${chunk.id} (${chunk.lines.join(" ")}) ${body.text.length} chars`);
}
