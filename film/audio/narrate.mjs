// Voices film/audio/narration.json with ElevenLabs, one clip per line so each can be placed on its
// scene. The key comes from ELEVENLABS_API_KEY and is never written anywhere. Clips that already
// exist are kept, because the API meters characters; pass --force to re-voice them.
//
//   ELEVENLABS_API_KEY=... node film/audio/narrate.mjs [--force] [--voice <id>] [line-id ...]
// --voice overrides narration.json's voice, e.g. a default voice while the account cannot use a
// library one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(join(here, "narration.json"), "utf8"));
const out = join(here, "../out/vo");
mkdirSync(out, { recursive: true });
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
const args = process.argv.slice(2);
const force = args.includes("--force");
const voiceAt = args.indexOf("--voice");
const voice = voiceAt >= 0 ? args[voiceAt + 1] : script.voice.id;
const wanted = args.filter((a, i) => !a.startsWith("--") && !(voiceAt >= 0 && i === voiceAt + 1));

const lines = script.lines;
for (const [index, line] of lines.entries()) {
  if (wanted.length && !wanted.includes(line.id)) continue;
  const file = join(out, `${line.id}.mp3`);
  if (existsSync(file) && !force) continue;
  const body = {
    text: line.text,
    model_id: script.model,
    seed: script.seed,
    previous_text: lines[index - 1]?.text,
    next_text: lines[index + 1]?.text,
    ...(line.settings ? { voice_settings: line.settings } : script.settings ? { voice_settings: script.settings } : {}),
  };
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!response.ok) throw new Error(`${line.id}: HTTP ${response.status} ${await response.text()}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  console.log(`${line.id} ${line.text}`);
}
