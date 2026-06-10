# Custom Asset Packs

The game includes a default asset set that is enough to run locally. You can also
create private local packs for experiments, reskins, or generated art/audio.

Custom packs are intentionally gitignored. Keep generated or third-party binary
packs out of normal pull requests unless the files are clearly redistributable
and the license is documented.

## Pack Layout

Runtime pack name `custom` maps to:

```text
assets/worms-custom/
```

Use a pack with:

```text
http://127.0.0.1:8787/?assetPack=custom
```

The loader falls back per file: if an asset is missing in the active pack, it
tries the default asset path. Missing sounds stay silent and missing images stay
blank instead of crashing the game.

## Local Manifests

The asset conversion helper reads gitignored local manifests:

```bash
cp assets/sources.example.json assets/sources.local.json
cp assets/sprite-mapping.example.json assets/sprite-mapping.local.json
npm run fetch:assets
```

`assets/sources.local.json` maps output files to local paths or direct URLs.
`assets/sprite-mapping.local.json` describes sprite sheets that must be sliced
and repacked into the vertical strips expected by the old engine.

## Expected Names

Expected image names are defined in:

- `src/animation/SpriteDefinitions.ts`
- `src/environment/Maps.ts`

Expected sound names are defined in:

- `src/system/AssetManager.ts`

Map your pack files onto those names so the existing game code can load them.
