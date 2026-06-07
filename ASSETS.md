# Assets

This project ships with **no game art, sound, or music**. The original *Worms
Armageddon* assets are the property of **Team17** and are **not distributed in
this repository**. You install them **locally**, into a gitignored folder, on
your own responsibility.

The game runs without them: missing assets degrade gracefully to the bundled
placeholders, so nothing crashes if a pack is incomplete.

---

## ⚠️ Legal

- *Worms Armageddon* graphics, sounds and music are **copyright © Team17**.
- They are **proprietary**. Do **not** commit them to this (or any public)
  repository — that risks a DMCA takedown and legal claims. Team17 actively
  protects its IP.
- The cleanest basis for using them locally is extracting them from **your own
  legally-owned copy** of the game (Steam / GOG) — see **Path B**.
- For any public release / hosted build you must replace these with **legally
  redistributable** art and audio.

See `NOTICE` for the short-form statement.

---

## How asset packs work

The loader supports multiple **asset packs**:

| Pack        | Location                  | In git? |
|-------------|---------------------------|---------|
| `default`   | `data/`                   | no (already gitignored placeholders) |
| `original`  | `assets/worms-original/`  | no (this is what you install)        |

- Select a pack at runtime with the URL param **`?assetPack=original`** (or set
  `Settings.ASSET_PACK`). The default pack keeps the current behaviour exactly.
- Resolution is **per-asset with fallback**: each file is loaded from the active
  pack; if it is missing, the loader falls back to the `default` pack, and if
  that is missing too it just renders blank / stays silent — the game still
  starts. A one-time console hint points you here.
- Sound is off by default. Enable it with **`?sound=true`** (the in-game Web
  Audio pipeline) — menu music has its own toggle and is independent of this.

Example: `http://127.0.0.1:8787/?arena=llm-vs-llm&assetPack=original&sound=true`

---

## Installing an original pack (local only)

### 1. Prerequisites

- **Node deps**: `npm install` (pulls in `pngjs`, used to repack sprite sheets).
- **ffmpeg** (optional): only needed if your audio sources are in a format the
  browser can't decode and must be converted. If absent, supply already-decodable
  files (`.wav`/`.ogg`/`.mp3`) and they are copied as-is.

### 2. Create your manifests

Copy the examples to the gitignored local manifests and fill them in:

```bash
cp assets/sources.example.json        assets/sources.local.json
cp assets/sprite-mapping.example.json assets/sprite-mapping.local.json
```

- `assets/sources.local.json` — a direct **file → file** map for images, sounds
  and music. Keys are paths inside the pack (e.g. `sounds/explosion1.wav`,
  `music/menu.ogg`). Values are `http(s)` URLs or local file paths.
- `assets/sprite-mapping.local.json` — for **sprite sheets** that must be sliced
  and repacked into the vertical strips the engine expects. Each entry’s frame
  count must match the matching `imageName` in
  `src/animation/SpriteDefinitions.ts`.

Sound/sprite **names** the engine expects are defined in
`src/system/AssetManager.ts` (sounds) and `src/animation/SpriteDefinitions.ts`
+ `src/environment/Maps.ts` (images). Map your sources onto those exact stems.

### 3. Run

```bash
npm run fetch:assets:original
```

Output lands in `assets/worms-original/` (gitignored) with a `.manifest.json`
report of what was copied / converted / repacked / missing.

### 4. Play with the pack

Open the game with `?assetPack=original` (and `?sound=true` for in-game audio).

---

## Where assets come from

### Path A — pre-ripped packs (simplest)

Community sites host extracted assets (these are **unofficial** copies; respect
each site’s terms and your local law):

- Sprites / graphics (PC): <https://www.spriters-resource.com/pc_computer/wormsgeddon/>
- Sound effects: <https://www.sounds-resource.com/pc_computer/wormsarmageddon/sound/4621/>
- Default soundbanks: <https://www.sounds-resource.com/pc_computer/wormsarmageddon/sound/4730/>
- Music (gamerip): <https://downloads.khinsider.com/game-soundtracks/album/worms-armageddon-pc-gamerip>
- Extra sounds: <https://gamebanana.com/sounds/46024>, <https://tus-wa.com/files/soundbanks/>

Download what you need **yourself**, then point your `*.local.json` manifests at
the files (local paths) or direct URLs. The fetch script does not scrape these
sites for you.

### Path B — extract from your own copy (cleanest legal basis)

If you own *Worms Armageddon* (Steam / GOG):

- Graphics live in `…\Worms Armageddon\DATA\Gfx\` as `.dir` archives
  (`Gfx.dir`, `gfx0.dir`, `gfx1.dir`, `Water.dir`, `Level.dir`).
- Unpack them with **SpriteEddy** (<https://worms2d.info/SpriteEddy>), a decoder
  for the Worms 2 / Armageddon / World Party `.dir` format. The format is
  documented at <https://worms2d.info/Graphics_directory>.
- Speech / sound WAVs are under `…\User\Speech\`; music is CD-audio you can rip
  to `.ogg`.

Then point your manifests at the unpacked files. The download of the game itself
is **not** automated — install it through your store as normal.

---

## Notes

- `data/` and `assets/worms-*/` and `assets/*.local.json` are gitignored; the
  `*.example.json` manifests are kept in the repo.
- The legacy fetch helper `npm run fetch:assets` (downloads the original
  clone author’s placeholder images) is unchanged and still works.
