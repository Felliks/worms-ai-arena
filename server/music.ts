/**
 * music.ts
 *
 * BYOK "music director" agent: the LLM COMPOSES the whole battle soundtrack for a
 * match as a Tone.js spec - genre, tempo, scale, and a set of instrument tracks
 * (drums, bass, lead, chords, arp, pad) each with its own synth + step pattern,
 * plus an arrangement of sections so the music develops through the match. The
 * browser renders this generically via Tone.js (src/audio/ArenaMusic buildFromSpec).
 *
 * Structured output via a forced tool call (regex-free; portable to the Anthropic-
 * backed OpenAI-compatible proxy - Claude is native to tool use). No key -> the
 * browser uses its procedural fallback. Never touches match fairness. Key never logged.
 */
import { z } from "zod";

export const MusicDirectRequestSchema = z.object({
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  matchup: z
    .array(
      z.object({
        name: z.string().max(60).optional(),
        model: z.string().max(60).optional(),
        persona: z.string().max(200).optional()
      })
    )
    .max(8)
    .optional(),
  mood: z.string().max(40).optional(),
  variation: z.number().int().optional() // bump to ask for fresh material mid-match
});
export type MusicDirectRequest = z.infer<typeof MusicDirectRequestSchema>;

// The spec is intentionally loose (the browser renders it defensively); we only
// sanity-check that it has tracks + sections and a usable tempo.
export interface MusicSpec {
  genre?: string;
  bpm?: number;
  rootNote?: string;
  scaleSemitones?: number[];
  tracks?: unknown[];
  sections?: unknown[];
}
export interface MusicDirectResult {
  ok: boolean;
  spec?: MusicSpec;
  reason?: string;
}

const SYNTHS = ["MembraneSynth", "NoiseSynth", "MetalSynth", "MonoSynth", "FMSynth", "AMSynth", "Synth", "DuoSynth", "PluckSynth", "PolySynth"];
const ROLES = ["kick", "snare", "hat", "tom", "perc", "bass", "sub", "lead", "chord", "arp", "pad", "stab", "fx"];
const FX = ["distortion", "reverb", "delay", "chorus", "bitcrusher", "autofilter", "phaser"];
const MUSIC_FETCH_TIMEOUT_MS = 15_000;

const MUSIC_TOOL = {
  type: "function",
  function: {
    name: "submit_soundtrack",
    description: "Submit the complete generative Tone.js soundtrack spec for this match.",
    parameters: {
      type: "object",
      properties: {
        genre: { type: "string", description: "the chosen style, e.g. synthwave, darksynth, metal, drum and bass, chiptune, orchestral epic, lofi hiphop, industrial, trap, dubstep, jazz fusion" },
        bpm: { type: "number", description: "tempo 60-190" },
        rootNote: { type: "string", description: "tonic with octave, e.g. C2, A1, E2, F#2" },
        scaleSemitones: { type: "array", items: { type: "integer" }, description: "scale as semitone offsets from the root, e.g. minor [0,2,3,5,7,8,10], phrygian [0,1,3,5,7,8,10], dorian [0,2,3,5,7,9,10], major [0,2,4,5,7,9,11], minor pentatonic [0,3,5,7,10]" },
        tracks: {
          type: "array",
          description: "every instrument layer of the track",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "unique id referenced by sections" },
              role: { type: "string", enum: ROLES },
              synth: { type: "string", enum: SYNTHS },
              oscillator: { type: "string", enum: ["sawtooth", "square", "triangle", "sine", "fatsawtooth", "pwm", "fmsquare", "amsine"] },
              volumeDb: { type: "number", description: "-30..0" },
              fx: { type: "array", items: { type: "string", enum: FX } },
              stepsPerBar: { type: "integer", description: "4, 8 or 16" },
              notes: { type: "array", description: "one-bar pattern, length = stepsPerBar. Melodic roles: scale-degree integers (0=root, +7=octave up, negatives go down) or null for a rest. Drum roles: 1 = hit, 0 or null = rest." }
            },
            required: ["name", "role", "synth", "notes"]
          }
        },
        sections: {
          type: "array",
          description: "ordered arrangement the renderer loops through so the music develops (e.g. intro, build, drop, breakdown). 'active' lists which track names play in that section.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              bars: { type: "integer", description: "1-16" },
              active: { type: "array", items: { type: "string" } }
            },
            required: ["bars", "active"]
          }
        }
      },
      required: ["genre", "bpm", "rootNote", "scaleSemitones", "tracks", "sections"]
    }
  }
};

function requestOwnsConnection(req: MusicDirectRequest): boolean {
  return typeof req.baseURL === "string" && req.baseURL.trim().length > 0;
}
function resolveBaseURL(req: MusicDirectRequest): string | undefined {
  const raw = (req.baseURL && req.baseURL.trim()) || process.env.OPENAI_BASE_URL || process.env.BASE_URL || process.env.API_URL;
  if (!raw) {
    return undefined;
  }
  const u = raw.trim().replace(/\/+$/, "");
  return /\/v1$/.test(u) ? u : u + "/v1";
}
function resolveApiKey(req: MusicDirectRequest): string | undefined {
  if (requestOwnsConnection(req)) {
    return req.apiKey && req.apiKey.trim() ? req.apiKey.trim() : undefined;
  }
  const k = (req.apiKey && req.apiKey.trim()) || process.env.OPENAI_API_KEY;
  return k || undefined;
}

function validateSpec(parsed: Record<string, unknown>): MusicSpec | null {
  const tracks = Array.isArray(parsed.tracks) ? parsed.tracks : null;
  const sections = Array.isArray(parsed.sections) ? parsed.sections : null;
  if (!tracks || !tracks.length || !sections || !sections.length) {
    return null;
  }
  const bpm = typeof parsed.bpm === "number" ? Math.max(50, Math.min(200, Math.round(parsed.bpm))) : 120;
  const scale = Array.isArray(parsed.scaleSemitones) && parsed.scaleSemitones.length
    ? (parsed.scaleSemitones as unknown[])
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      .slice(0, 12)
      .map((x) => Math.max(-24, Math.min(24, Math.round(x))))
    : [0, 2, 3, 5, 7, 8, 10];
  const sanitizedTracks = tracks
    .slice(0, 12)
    .map((track, index) => sanitizeTrack(track, index))
    .filter((track): track is Record<string, unknown> => Boolean(track));
  const sanitizedSections = sections
    .slice(0, 16)
    .map(sanitizeSection)
    .filter((section): section is Record<string, unknown> => Boolean(section));
  if (!sanitizedTracks.length || !sanitizedSections.length) {
    return null;
  }
  return {
    genre: typeof parsed.genre === "string" ? parsed.genre.slice(0, 60) : "electronic",
    bpm,
    rootNote: typeof parsed.rootNote === "string" ? parsed.rootNote.slice(0, 8) : "C2",
    scaleSemitones: scale,
    tracks: sanitizedTracks,
    sections: sanitizedSections
  };
}

function sanitizeTrack(value: unknown, index: number): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const track = value as Record<string, unknown>;
  const rawNotes = Array.isArray(track.notes) ? track.notes : [];
  if (!rawNotes.length) {
    return null;
  }
  const role = typeof track.role === "string" && ROLES.includes(track.role) ? track.role : "lead";
  const synth = typeof track.synth === "string" && SYNTHS.includes(track.synth) ? track.synth : "Synth";
  const out: Record<string, unknown> = {
    name: typeof track.name === "string" && track.name.trim() ? track.name.slice(0, 40) : `track-${index}`,
    role,
    synth,
    notes: rawNotes.slice(0, 32).map((note) => {
      if (note == null || note === false) {
        return null;
      }
      if (typeof note === "number" && Number.isFinite(note)) {
        return Math.max(-32, Math.min(32, Math.round(note)));
      }
      return null;
    })
  };
  if (typeof track.oscillator === "string" && ["sawtooth", "square", "triangle", "sine", "fatsawtooth", "pwm", "fmsquare", "amsine"].includes(track.oscillator)) {
    out.oscillator = track.oscillator;
  }
  if (typeof track.volumeDb === "number" && Number.isFinite(track.volumeDb)) {
    out.volumeDb = Math.max(-40, Math.min(6, track.volumeDb));
  }
  if (Array.isArray(track.fx)) {
    out.fx = track.fx.filter((fx): fx is string => typeof fx === "string" && FX.includes(fx)).slice(0, 6);
  }
  if (track.stepsPerBar === 4 || track.stepsPerBar === 8 || track.stepsPerBar === 16) {
    out.stepsPerBar = track.stepsPerBar;
  }
  return out;
}

function sanitizeSection(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const section = value as Record<string, unknown>;
  const active = Array.isArray(section.active) ? section.active.filter((name): name is string => typeof name === "string").slice(0, 12) : [];
  if (!active.length) {
    return null;
  }
  const bars = typeof section.bars === "number" && Number.isFinite(section.bars) ? Math.max(1, Math.min(16, Math.round(section.bars))) : 4;
  return {
    name: typeof section.name === "string" ? section.name.slice(0, 40) : "",
    bars,
    active
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MUSIC_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function directMusic(input: unknown): Promise<MusicDirectResult> {
  const req = MusicDirectRequestSchema.parse(input);
  const baseURL = resolveBaseURL(req);
  const apiKey = resolveApiKey(req);
  if (!baseURL || !apiKey) {
    return { ok: false, reason: "no-connection" };
  }
  const model = req.model || process.env.AGENT_MUSIC_MODEL || "gpt-4o-mini";

  const system = [
    "You are the MUSIC DIRECTOR + COMPOSER for an AI-vs-AI Worms battle. Invent a COMPLETE, ORIGINAL generative soundtrack tailored to this matchup and call submit_soundtrack.",
    "You choose everything: the genre/style, tempo, scale and key, and every instrument layer - drums (kick/snare/hat/tom), bass, lead melody, chords/pads, arps - each with its own synth and a step pattern you write.",
    "Compose real patterns: write a memorable lead melody as scale-degree integers, a driving bassline, and drum grooves. Use rests (null/0) for groove. Arrange 3-6 sections (intro, build, drop, breakdown, ...) that develop the track; 'active' gates which tracks play per section.",
    "Make each match's music DISTINCT - vary the genre, scale, tempo and instrumentation based on the rivalry and mood. Be bold and creative, not generic."
  ].join(" ");
  const user = JSON.stringify({ matchup: req.matchup || [], mood: req.mood || "tense", variation: req.variation || 0 });

  let resp: Response;
  try {
    resp = await fetchWithTimeout(baseURL.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 1.0,
        tools: [MUSIC_TOOL],
        tool_choice: { type: "function", function: { name: "submit_soundtrack" } }
      })
    });
  } catch (error) {
    return { ok: false, reason: (error as Error).name === "AbortError" ? "timeout" : "fetch-error" };
  }
  if (!resp.ok) {
    return { ok: false, reason: "http-" + resp.status };
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    return { ok: false, reason: "no-tool-call" };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(args) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "bad-args" };
  }
  const spec = validateSpec(parsed);
  if (!spec) {
    return { ok: false, reason: "invalid-spec" };
  }
  return { ok: true, spec };
}
