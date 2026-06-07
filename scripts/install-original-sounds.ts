/**
 * install-original-sounds.ts
 *
 * Installs sound files from a LOCAL folder you provide (e.g. a soundbank you
 * extracted from your own copy of the game) into data/sounds/ under the exact
 * names the engine expects. The expected list is parsed from AssetManager.ts,
 * and source files are matched by a normalised name (case- and separator-
 * insensitive), so "Walk-Expand.wav" -> "WalkExpand.wav", "DRILL.WAV" ->
 * "drill.wav", "Explosion1.wav" -> "explosion1.wav", etc.
 *
 * data/ is gitignored, so nothing copyrighted is committed.
 *
 *   Usage:  tsx scripts/install-original-sounds.ts [sourceDir]
 *           (default sourceDir: ./OriginalSounds)
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "OriginalSounds");
const targetRoot = path.join(root, "data", "sounds");

function norm(name: string): string {
  return name.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

function main(): void {
  if (!fs.existsSync(sourceDir)) {
    console.error(`Source folder not found: ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  // Expected sound paths (relative to data/sounds/) parsed from AssetManager.
  const am = fs.readFileSync(path.join(root, "src", "system", "AssetManager.ts"), "utf8");
  const targets = Array.from(new Set(
    Array.from(am.matchAll(/data\/sounds\/([^"']+?\.wav)/gi), (m) => m[1])
  ));

  // Index the source folder by normalised basename.
  const index: Record<string, string> = {};
  for (const file of fs.readdirSync(sourceDir)) {
    if (/\.wav$/i.test(file)) {
      index[norm(file)] = file;
    }
  }

  let installed = 0;
  const missing: string[] = [];
  for (const rel of targets) {
    const base = rel.split("/").pop() as string;
    const source = index[norm(base)];
    if (!source) {
      missing.push(rel);
      continue;
    }
    const dest = path.join(targetRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, source), dest);
    installed++;
  }

  console.log(`Installed ${installed}/${targets.length} sounds into data/sounds/ from ${sourceDir}.`);
  if (missing.length > 0) {
    console.log(`Not found in source (left missing -> silent, no crash): ${missing.length}`);
    console.log("  " + missing.join("\n  "));
  }
}

main();
