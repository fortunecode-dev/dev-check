// Detección de stack: solo lee archivos del repo, no ejecuta nada.
const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./util.cjs");

const exists = (...p) => fs.existsSync(path.join(...p));

const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
];
const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
];

function detectPackageManager(root) {
  if (exists(root, "pnpm-lock.yaml") || exists(root, "pnpm-workspace.yaml"))
    return "pnpm";
  if (exists(root, "yarn.lock")) return "yarn";
  if (exists(root, "bun.lock") || exists(root, "bun.lockb")) return "bun";
  if (exists(root, "package-lock.json")) return "npm";
  const pm = readJson(path.join(root, "package.json"), {}).packageManager;
  if (typeof pm === "string") return pm.split("@")[0];
  return "npm";
}

// Patrones de workspace de pnpm-workspace.yaml o package.json#workspaces.
function workspacePatterns(root) {
  const patterns = [];
  const yamlFile = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(yamlFile)) {
    let inPackages = false;
    for (const line of fs.readFileSync(yamlFile, "utf8").split("\n")) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (/^\S/.test(line)) inPackages = false;
      else if (inPackages) {
        const m = /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(line);
        if (m) patterns.push(m[1]);
      }
    }
  }
  const ws = readJson(path.join(root, "package.json"), {}).workspaces;
  const list = Array.isArray(ws) ? ws : (ws?.packages ?? []);
  patterns.push(...list);
  return patterns;
}

function expandPattern(root, pattern) {
  const clean = pattern.replace(/\/+$/, "");
  if (/\/\*\*?$/.test(clean)) {
    const base = clean.replace(/\/\*\*?$/, "");
    const baseDir = path.join(root, base);
    if (!fs.existsSync(baseDir)) return [];
    return fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "node_modules")
      .map((e) => `${base}/${e.name}`)
      .filter((p) => exists(root, p, "package.json"));
  }
  return exists(root, clean, "package.json") ? [clean] : [];
}

function detectWorkspaces(root) {
  const patterns = workspacePatterns(root);
  const found = patterns
    .filter((p) => !p.startsWith("!"))
    .flatMap((p) => expandPattern(root, p));
  return [...new Set(found)].sort();
}

// Carpetas de primer nivel con package.json en un repo sin workspaces: el
// usuario decide cuáles son proyectos (no se puede deducir).
function candidateDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        e.name !== "node_modules" &&
        exists(root, e.name, "package.json"),
    )
    .map((e) => e.name)
    .sort();
}

function allDeps(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function detectProject(root, projectPath) {
  const dir = path.join(root, projectPath);
  const pkg = readJson(path.join(dir, "package.json"), {});
  const deps = allDeps(pkg);
  const has = (name) => deps[name] !== undefined;
  const stack = [];
  const ts = exists(dir, "tsconfig.json") || has("typescript");
  if (ts) stack.push("ts");
  if (has("@nestjs/core")) stack.push("nest");
  if (has("next")) stack.push("next");
  if (has("expo")) stack.push("expo");
  if (has("react-native")) stack.push("react-native");
  if (has("vite")) stack.push("vite");
  const prisma = exists(dir, "prisma", "schema.prisma") || has("prisma");
  if (prisma) stack.push("prisma");

  const eslintFile = ESLINT_CONFIGS.find((f) => exists(dir, f));
  const hasEslint = Boolean(eslintFile) || has("eslint");
  let typeAware = false;
  if (eslintFile) {
    try {
      const src = fs.readFileSync(path.join(dir, eslintFile), "utf8");
      typeAware =
        /projectService|parserOptions[\s\S]{0,80}project\b|TypeChecked/.test(
          src,
        );
    } catch {
      typeAware = false;
    }
  }

  // Los servers (Nest) suelen tener el código en src/ y los tests en test/.
  let lint = ["."];
  if (
    stack.includes("nest") ||
    (ts && exists(dir, "src") && !stack.includes("next"))
  ) {
    lint = ["src/**/*.ts"];
    if (exists(dir, "test")) lint.push("test/**/*.ts");
  }
  const tests = has("vitest") ? "vitest" : has("jest") ? "jest" : null;

  const project = {
    path: projectPath,
    stack,
    lint: hasEslint ? lint : null,
    typeAware,
  };
  if (ts && !stack.includes("next") && !stack.includes("expo"))
    project.lintExt = "\\.ts$";
  else if (ts) project.lintExt = "\\.tsx?$";
  if (prisma) project.prisma = true;
  if (stack.includes("expo")) project.expo = true;
  if (tests) project.tests = tests;
  return {
    ...project,
    lintTargets: lint,
    hasEslint,
    hasTypescript: has("typescript"),
    hasTsconfig: exists(dir, "tsconfig.json"),
  };
}

function detectRepoTools(root) {
  const pkg = readJson(path.join(root, "package.json"), {});
  const deps = allDeps(pkg);
  const anyFile = (names) => names.some((f) => exists(root, f));
  return {
    prettier: anyFile(PRETTIER_CONFIGS) || deps.prettier !== undefined,
    knip:
      anyFile(["knip.json", "knip.jsonc", ".knip.json"]) ||
      deps.knip !== undefined,
    depcruise:
      anyFile([".dependency-cruiser.cjs", ".dependency-cruiser.js"]) ||
      deps["dependency-cruiser"] !== undefined,
    syncpack:
      anyFile([".syncpackrc", ".syncpackrc.json", ".syncpackrc.js"]) ||
      deps.syncpack !== undefined,
  };
}

// Devuelve lo detectado; la decisión de qué proyectos usar queda a `init`.
function detectStack(root) {
  const workspaces = detectWorkspaces(root);
  return {
    packageManager: detectPackageManager(root),
    workspaces,
    candidates: workspaces.length ? [] : candidateDirs(root),
    rootProject: exists(root, "package.json") ? detectProject(root, ".") : null,
    tools: detectRepoTools(root),
  };
}

module.exports = {
  detectStack,
  detectProject,
  detectPackageManager,
  detectWorkspaces,
  allDeps,
};
