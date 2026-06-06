import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const baseUrl = "http://ciaranmccann.me/college/fyp";

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function matches(source: string, pattern: RegExp): string[] {
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

async function download(relativePath: string): Promise<"downloaded" | "exists" | "missing"> {
  const target = path.join(root, relativePath);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    return "exists";
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(`${baseUrl}/${relativePath}`);
  if (!response.ok) {
    return "missing";
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/png") && !contentType.includes("image/jpeg")) {
    return "missing";
  }

  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, data);
  return "downloaded";
}

const spriteDefs = read("src/animation/SpriteDefinitions.ts");
const maps = read("src/environment/Maps.ts");

const allImageNames = unique(matches(spriteDefs, /imageName:\s*["']([^"']+)["']/g));
const weaponIconNames = unique(matches(spriteDefs, /imageName:\s*["'](icon[^"']+|drill)["']/g));
const levelNames = unique([
  ...matches(maps, /terrainImage:\s*["']([^"']+)["']/g),
  ...matches(maps, /smallImage:\s*["']([^"']+)["']/g)
]);

const files = unique([
  "data/images/menu/stick.png",
  "data/images/Ireland.png",
  "data/images/awesome.jpg",
  ...allImageNames.map((name) => `data/images/${name}.png`),
  ...weaponIconNames.map((name) => `data/images/weaponicons/${name}.png`),
  ...levelNames.map((name) => `data/images/levels/${name}.png`)
]);

async function main(): Promise<void> {
  let downloaded = 0;
  let exists = 0;
  const missing: string[] = [];

  for (const file of files) {
    const result = await download(file);
    if (result === "downloaded") {
      downloaded++;
    } else if (result === "exists") {
      exists++;
    } else {
      missing.push(file);
    }
  }

  console.log(`Legacy assets: ${downloaded} downloaded, ${exists} already present, ${missing.length} missing.`);
  if (missing.length > 0) {
    console.log(missing.join("\n"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
