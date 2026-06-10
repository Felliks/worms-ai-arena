/**
 * fetch-assets.ts
 *
 * Manifest-driven, source-agnostic installer for a custom local asset pack. It
 * reads LOCAL, gitignored manifests that map direct URLs or local files onto the
 * asset names expected by the game. Output goes to assets/worms-<pack>/, which
 * is gitignored.
 *
 * See ASSETS.md for the legal context, where assets come from, and how to fill
 * the manifests.
 *
 *   Manifests (copy the *.example.json files and fill them in):
 *     assets/sources.local.json         direct file -> file map (images/sounds/music)
 *     assets/sprite-mapping.local.json  sprite sheets -> repacked vertical strips
 *
 *   Run:  npm run fetch:assets
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";

const root = process.cwd();
const PACK: string = process.env.ASSET_PACK ?? "custom";
const packDir = path.join(root, "assets", `worms-${PACK}`);

type SourceMap = Record<string, string>;

interface SourcesFile {
  images?: SourceMap;
  sounds?: SourceMap;
  music?: SourceMap;
}

interface FrameRect { x: number; y: number; w: number; h: number; }
interface FrameGrid { grid: { cols: number; rows: number }; indices?: number[]; }
type Frames = FrameRect[] | FrameGrid;

interface SheetMapping {
  imageName: string;     // target stem the engine expects (see SpriteDefinitions.ts)
  source: string;        // url or local path to the source sheet PNG
  frameWidth: number;
  frameHeight: number;
  frames: Frames;        // explicit rects, or a grid (optionally with indices)
}

interface MappingFile {
  sheets?: SheetMapping[];
}

interface Report {
  copied: number;
  converted: number;
  repacked: number;
  missing: string[];
  warnings: string[];
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

async function readBytes(source: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(source)) {
    try {
      const res = await fetch(source);
      if (!res.ok) {
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  const local = path.isAbsolute(source) ? source : path.join(root, source);
  if (!fs.existsSync(local)) {
    return null;
  }
  return fs.readFileSync(local);
}

function writeOut(relPath: string, data: Buffer): void {
  const target = path.join(packDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

function extOf(p: string): string {
  return path.extname(p).toLowerCase();
}

function ffmpegAvailable(): boolean {
  try {
    return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

const hasFfmpeg = ffmpegAvailable();

function convertAudio(srcBuf: Buffer, srcExt: string, targetExt: string): Buffer | null {
  if (srcExt === targetExt) {
    return srcBuf;
  }
  if (!hasFfmpeg) {
    return null;
  }
  fs.mkdirSync(packDir, { recursive: true });
  const tmpIn = path.join(packDir, `.tmp-in${srcExt || ".bin"}`);
  const tmpOut = path.join(packDir, `.tmp-out${targetExt}`);
  fs.writeFileSync(tmpIn, srcBuf);
  const result = spawnSync("ffmpeg", ["-y", "-i", tmpIn, tmpOut], { stdio: "ignore" });
  let out: Buffer | null = null;
  if (result.status === 0 && fs.existsSync(tmpOut)) {
    out = fs.readFileSync(tmpOut);
  }
  if (fs.existsSync(tmpIn)) { fs.unlinkSync(tmpIn); }
  if (fs.existsSync(tmpOut)) { fs.unlinkSync(tmpOut); }
  return out;
}

function rectsFromFrames(m: SheetMapping): FrameRect[] {
  if (Array.isArray(m.frames)) {
    return m.frames;
  }
  const grid = m.frames.grid;
  const all: FrameRect[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      all.push({ x: c * m.frameWidth, y: r * m.frameHeight, w: m.frameWidth, h: m.frameHeight });
    }
  }
  const indices = m.frames.indices;
  if (indices && indices.length > 0) {
    return indices.map((i) => {
      const rect = all[i];
      if (!rect) {
        throw new Error(`frame index ${i} is out of range for grid ${grid.cols}x${grid.rows} (${all.length} cells)`);
      }
      return rect;
    });
  }
  return all;
}

// Parses imageName -> frameCount from SpriteDefinitions.ts so we can warn when a
// mapping produces a strip with the wrong number of frames (which would shear at
// runtime with no error). Only matches objects that declare BOTH fields.
function loadSpriteFrameCounts(): Record<string, number> {
  const file = path.join(root, "src", "animation", "SpriteDefinitions.ts");
  if (!fs.existsSync(file)) {
    return {};
  }
  const src = fs.readFileSync(file, "utf8");
  const counts: Record<string, number> = {};
  const re = /\{[^{}]*imageName:\s*["']([^"']+)["'][^{}]*frameCount:\s*(\d+)[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    counts[m[1]] = Number(m[2]);
  }
  return counts;
}

// Repacks the requested frames from a source sheet into a single vertical strip
// of frameWidth x (frameHeight * frameCount). The engine's Sprite class advances
// frames down the Y axis and derives frame height as image.height / frameCount,
// so the strip must contain exactly the frames the SpriteDefinition expects.
function repackSheet(sheetBuf: Buffer, m: SheetMapping): Buffer {
  const sheet = PNG.sync.read(sheetBuf);
  const rects = rectsFromFrames(m);
  const fw = m.frameWidth;
  const fh = m.frameHeight;
  const out = new PNG({ width: fw, height: fh * rects.length });
  out.data.fill(0);

  for (let f = 0; f < rects.length; f++) {
    const rect = rects[f];
    const destY0 = f * fh;
    for (let yy = 0; yy < fh; yy++) {
      for (let xx = 0; xx < fw; xx++) {
        const sx = rect.x + xx;
        const sy = rect.y + yy;
        if (sx < 0 || sy < 0 || sx >= sheet.width || sy >= sheet.height) {
          continue;
        }
        const si = (sheet.width * sy + sx) << 2;
        const di = (out.width * (destY0 + yy) + xx) << 2;
        out.data[di] = sheet.data[si];
        out.data[di + 1] = sheet.data[si + 1];
        out.data[di + 2] = sheet.data[si + 2];
        out.data[di + 3] = sheet.data[si + 3];
      }
    }
  }
  return PNG.sync.write(out);
}

async function handleDirectMap(report: Report, map: SourceMap | undefined, isAudio: boolean): Promise<void> {
  if (!map) {
    return;
  }
  for (const targetRel of Object.keys(map)) {
    const source = map[targetRel];
    const bytes = await readBytes(source);
    if (!bytes) {
      report.missing.push(`${targetRel}  <- ${source}`);
      continue;
    }
    if (isAudio) {
      const srcExt = extOf(source);
      const targetExt = extOf(targetRel);
      if (srcExt === targetExt) {
        writeOut(targetRel, bytes);
        report.copied++;
      } else {
        const converted = convertAudio(bytes, srcExt, targetExt);
        if (converted) {
          writeOut(targetRel, converted);
          report.converted++;
        } else {
          report.missing.push(`${targetRel} (needs ffmpeg to convert ${srcExt} -> ${targetExt})`);
        }
      }
    } else {
      writeOut(targetRel, bytes);
      report.copied++;
    }
  }
}

async function main(): Promise<void> {
  const sources = readJson<SourcesFile>(path.join(root, "assets", "sources.local.json"));
  const mapping = readJson<MappingFile>(path.join(root, "assets", "sprite-mapping.local.json"));

  if (!sources && !mapping) {
    console.log(
      [
        "No asset manifest found. To build a custom local asset pack:",
        "  1. cp assets/sources.example.json        assets/sources.local.json",
        "  2. cp assets/sprite-mapping.example.json assets/sprite-mapping.local.json",
        "  3. Fill them with sources you are authorised to use (see ASSETS.md).",
        "  4. Re-run: npm run fetch:assets",
        "",
        "Output goes to assets/worms-" + PACK + "/ (gitignored). The game uses it",
        "with ?assetPack=" + PACK + " and falls back to placeholders for missing files.",
      ].join("\n")
    );
    return;
  }

  const report: Report = { copied: 0, converted: 0, repacked: 0, missing: [], warnings: [] };

  if (sources) {
    await handleDirectMap(report, sources.images, false);
    await handleDirectMap(report, sources.sounds, true);
    await handleDirectMap(report, sources.music, true);
  }

  if (mapping && mapping.sheets) {
    const frameCounts = loadSpriteFrameCounts();
    for (const sheet of mapping.sheets) {
      const bytes = await readBytes(sheet.source);
      if (!bytes) {
        report.missing.push(`images/${sheet.imageName}.png  <- ${sheet.source}`);
        continue;
      }
      try {
        const expected = frameCounts[sheet.imageName];
        const actual = rectsFromFrames(sheet).length;
        if (expected !== undefined && expected !== actual) {
          report.warnings.push(
            `images/${sheet.imageName}.png: mapping yields ${actual} frame(s) but SpriteDefinitions.ts expects ${expected} - animation will shear`
          );
        }
        writeOut(path.join("images", `${sheet.imageName}.png`), repackSheet(bytes, sheet));
        report.repacked++;
      } catch (err) {
        report.missing.push(`images/${sheet.imageName}.png (repack failed: ${(err as Error).message})`);
      }
    }
  }

  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(
    path.join(packDir, ".manifest.json"),
    JSON.stringify(
      {
        pack: PACK,
        copied: report.copied,
        converted: report.converted,
        repacked: report.repacked,
        missing: report.missing,
        warnings: report.warnings,
      },
      null,
      2
    )
  );

  console.log(
    `Asset pack "${PACK}": ${report.copied} copied, ${report.converted} converted, ` +
    `${report.repacked} sprites repacked, ${report.missing.length} missing, ${report.warnings.length} warning(s).`
  );
  if (!hasFfmpeg) {
    console.log("Note: ffmpeg not found - audio needing conversion was skipped. Install ffmpeg or supply already-compatible files.");
  }
  if (report.warnings.length > 0) {
    console.log("Warnings:\n" + report.warnings.map((w) => "  - " + w).join("\n"));
  }
  if (report.missing.length > 0) {
    console.log("Missing / failed:\n" + report.missing.map((m) => "  - " + m).join("\n"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
