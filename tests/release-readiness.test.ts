import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

describe("open-source release readiness", () => {
  it("ships Docker entrypoints that use a small runtime image and do not copy local junk", () => {
    const dockerfile = read("Dockerfile");
    const dockerignore = read(".dockerignore");
    const compose = read("docker-compose.yml");

    expect(dockerfile).toContain(" AS build");
    expect(dockerfile).toContain(" AS runtime");
    expect(dockerfile).toContain("npm ci --omit=dev");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["node", "dist/server/index.js"]');
    expect(compose).toContain("HOST: 0.0.0.0");
    expect(compose).not.toContain("env_file");
    expect(compose).not.toContain("API_KEY");
    for (const ignored of ["node_modules", ".git", ".env", "logs", ".playwright-mcp"]) {
      expect(dockerignore).toContain(ignored);
    }
  });

  it("lets the server keep localhost as default while allowing Docker to bind all interfaces", () => {
    const server = read("server/index.ts");

    expect(server).toContain('const host = process.env.HOST ?? "127.0.0.1"');
    expect(server).toContain("app.listen(port, host");
    expect(server).toContain("http://${host}:${port}/");
  });

  it("has package metadata and scripts suitable for a public local-first project", () => {
    const pkg = JSON.parse(read("package.json"));

    expect(pkg.private).toBe(false);
    expect(pkg.name).toBe("llm-worms-arena");
    expect(pkg.scripts.start).toBe("node dist/server/index.js");
    expect(pkg.scripts["build:server"]).toBe("tsc -p tsconfig.server.json");
    expect(pkg.scripts.lint).toContain("npm run lint:ts");
    expect(pkg.scripts["lint:ts"]).toContain("eslint");
    expect(pkg.scripts["lint:css"]).toContain("stylelint");
    expect(pkg.scripts["format:check"]).toContain("prettier --check");
    expect(pkg.scripts.audit).toBe("npm audit --audit-level=high");
    expect(pkg.scripts.check).toContain("npm run lint");
    expect(pkg.scripts.docker).toContain("docker compose up");
    expect(pkg.keywords).toContain("llm");
    expect(pkg.keywords).toContain("artillery-game");
  });

  it("has community health docs and CI for public contributions", () => {
    for (const file of [
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      "AGENTS.md",
      "LICENSE.txt",
      ".github/workflows/ci.yml",
      "eslint.config.mjs",
      "stylelint.config.mjs"
    ]) {
      expect(exists(file), `${file} should exist`).toBe(true);
    }

    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("npm run format:check");
    expect(ci).toContain("npm run audit");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run typecheck");
    expect(ci).toContain("npm run build");
  });

  it("public-facing docs use the new project framing and no legacy brand notice", () => {
    const docs = [
      read("README.md"),
      read("ASSETS.md"),
      read("index.htm"),
      read("src/main.ts"),
      read("src/gui/MainMenu.ts"),
      read("src/gui/StartMenu.ts"),
      read("src/gui/MenuAudio.ts"),
      read("src/system/AssetManager.ts"),
      read("scripts/fetch-assets.ts"),
      read("css/menu.css"),
      read(".gitignore"),
      read("package.json"),
      exists("NOTICE") ? read("NOTICE") : ""
    ].join("\n");

    expect(docs).toContain("LLM Worms Arena");
    expect(docs).not.toMatch(/Team17|Worms Armageddon HTML5 Clone|original worms armageddon|copyrighted audio|fetch:assets:original/i);
  });

  it("nested data docs carry no legacy copyrighted-asset framing", () => {
    const dataDir = path.join(root, "data");
    const mdFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.toLowerCase().endsWith(".md")) {
          mdFiles.push(full);
        }
      }
    };
    if (fs.existsSync(dataDir)) {
      walk(dataDir);
    }

    // Catch both the public brand strings and bare copyright-ownership claims,
    // which the original data/images/README.md ("I don't own the copyright")
    // would otherwise slip past.
    const legacy = /Team17|Worms Armageddon HTML5 Clone|original worms armageddon|copyrighted audio|fetch:assets:original|do(?:n['’]t| not) own the copyright/i;
    for (const file of mdFiles) {
      const text = fs.readFileSync(file, "utf8");
      expect(legacy.test(text), `${path.relative(root, file)} should not carry legacy copyrighted-asset framing`).toBe(false);
    }
  });
});
