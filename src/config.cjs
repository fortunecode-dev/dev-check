// Carga y valida dev-checks.config.json aplicando los valores por defecto.
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILE = "dev-checks.config.json";

const STEP_IDS = [
  "tsc",
  "eslint",
  "prettier",
  "tests",
  "knip",
  "depcruise",
  "prisma",
  "expo",
  "syncpack",
];

// Pasos que se activan por defecto; knip/depcruise/syncpack son opinados.
const DEFAULT_STEPS = {
  tsc: true,
  eslint: true,
  prettier: true,
  tests: true,
  knip: false,
  depcruise: false,
  prisma: true,
  expo: true,
  syncpack: false,
};

const DEFAULTS = {
  globalFiles: [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pnpm-workspace.yaml",
    ".prettierrc",
    ".prettierignore",
    ".editorconfig",
    "dev-checks.config.json",
  ],
  baseline: {},
  knownEmptySuites: [],
  expoAccepted: {},
  hooks: { enrichCommitMsg: true },
  agents: { files: ["AGENTS.md"], linkClaudeMd: true, noCommit: true },
  output: { maxLines: 15, concurrency: 3 },
};

const DEFAULT_LINT_EXT = "\\.[cm]?[jt]sx?$";

class ConfigError extends Error {}

function configPath(root, file) {
  return path.resolve(root, file || CONFIG_FILE);
}

function readRaw(root, file) {
  const p = configPath(root, file);
  if (!fs.existsSync(p)) {
    throw new ConfigError(
      `No existe ${path.relative(root, p) || CONFIG_FILE}. Corre \`dev-checks init\` para generarlo.`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILE} no es JSON válido: ${err.message}`);
  }
}

function normalizeProject(raw, index) {
  if (!raw || typeof raw.path !== "string" || !raw.path) {
    throw new ConfigError(`projects[${index}] necesita "path" (string).`);
  }
  const clean = raw.path.replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  let lintExt;
  try {
    lintExt = new RegExp(raw.lintExt ?? DEFAULT_LINT_EXT);
  } catch {
    throw new ConfigError(
      `projects[${index}].lintExt no es una expresión regular válida.`,
    );
  }
  return {
    ...raw,
    path: clean,
    name: clean,
    // null = sin eslint en ese proyecto; ausente = todo el proyecto.
    lint: raw.lint === null ? null : (raw.lint ?? ["."]),
    typeAware: Boolean(raw.typeAware),
    lintExt,
    lintIgnore: raw.lintIgnore ?? ["/generated/"],
    tests: raw.tests ?? null,
    prisma: Boolean(raw.prisma),
    expo: Boolean(raw.expo),
  };
}

function loadConfig(root, file) {
  return normalizeConfig(readRaw(root, file));
}

// Valida un objeto de config y le aplica los defaults (sin tocar el disco).
function normalizeConfig(raw) {
  if (!Array.isArray(raw.projects) || raw.projects.length === 0) {
    throw new ConfigError('"projects" debe ser una lista con al menos uno.');
  }
  const projects = raw.projects.map(normalizeProject);
  const seen = new Set();
  for (const p of projects) {
    if (seen.has(p.path)) {
      throw new ConfigError(`Proyecto repetido en "projects": ${p.path}`);
    }
    seen.add(p.path);
  }
  const steps = { ...DEFAULT_STEPS, ...raw.steps };
  for (const id of Object.keys(steps)) {
    if (!STEP_IDS.includes(id)) {
      throw new ConfigError(
        `Paso desconocido en "steps": ${id}. Disponibles: ${STEP_IDS.join(", ")}`,
      );
    }
  }
  return {
    ...DEFAULTS,
    ...raw,
    projects,
    steps,
    hooks: { ...DEFAULTS.hooks, ...raw.hooks },
    agents: { ...DEFAULTS.agents, ...raw.agents },
    output: { ...DEFAULTS.output, ...raw.output },
  };
}

// Cambia un paso en el archivo conservando el resto tal como está.
function setStep(root, file, id, enabled) {
  if (!STEP_IDS.includes(id)) {
    throw new ConfigError(
      `Paso desconocido: ${id}. Disponibles: ${STEP_IDS.join(", ")}`,
    );
  }
  const raw = readRaw(root, file);
  raw.steps = { ...DEFAULT_STEPS, ...raw.steps, [id]: enabled };
  fs.writeFileSync(
    configPath(root, file),
    JSON.stringify(raw, null, 2) + "\n",
    "utf8",
  );
}

module.exports = {
  CONFIG_FILE,
  STEP_IDS,
  DEFAULT_STEPS,
  DEFAULTS,
  ConfigError,
  configPath,
  loadConfig,
  normalizeConfig,
  setStep,
};
