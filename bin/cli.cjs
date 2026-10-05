#!/usr/bin/env node
// Punto de entrada: dev-checks <comando>
const { execFileSync } = require("node:child_process");
const {
  loadConfig,
  setStep,
  ConfigError,
  STEP_IDS,
} = require("../src/config.cjs");
const { runChecks, UsageError } = require("../src/runner.cjs");
const { init } = require("../src/init.cjs");
const { doctor } = require("../src/doctor.cjs");
const { syncCommitMsgHook } = require("../src/hooks/install.cjs");
const pkg = require("../package.json");

const USAGE = `dev-checks ${pkg.version}

Uso: dev-checks <comando> [opciones]

  check [--diff] [--all] [--base <ref>] [--only a,b] [--verbose]
        Corre los checks activos. Por defecto solo los proyectos con cambios
        contra HEAD (--diff es ese mismo modo, explícito).
  init [--yes] [--no-install] [--dry-run]
        Detecta el stack, instala dependencias y deja todo configurado.
  doctor            Revisa config, herramientas, hook y AGENTS.md.
  enable <paso>     Activa un paso (${STEP_IDS.join(", ")}).
  disable <paso>    Desactiva un paso.
  hooks             (Re)instala o quita el hook commit-msg según la config.

Opción común: --config <archivo> (por defecto dev-checks.config.json).`;

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

// Opciones simples: --flag, --clave valor o --clave=valor.
function parseArgs(argv, spec) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [key, inline] = a.startsWith("--")
      ? a.slice(2).split("=", 2)
      : [null];
    if (key === null) rest.push(a);
    else if (spec.flags.includes(key)) opts[key] = true;
    else if (spec.values.includes(key)) {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "")
        throw new UsageError(`--${key} necesita un valor.`);
      opts[key] = v;
    } else throw new UsageError(`Opción desconocida: --${key}`);
  }
  return { opts, rest };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(pkg.version);
    return 0;
  }
  const root = repoRoot();

  if (command === "check") {
    const { opts } = parseArgs(argv, {
      flags: ["diff", "all", "verbose"],
      values: ["base", "only", "config"],
    });
    const config = loadConfig(root, opts.config);
    return runChecks(root, config, {
      all: Boolean(opts.all),
      verbose: Boolean(opts.verbose),
      base: opts.base ?? null,
      only: opts.only ? opts.only.split(",").filter(Boolean) : null,
    });
  }
  if (command === "init") {
    const { opts } = parseArgs(argv, {
      flags: ["yes", "no-install", "dry-run"],
      values: ["config"],
    });
    await init(root, {
      yes: Boolean(opts.yes),
      install: !opts["no-install"],
      dryRun: Boolean(opts["dry-run"]),
      configFile: opts.config,
    });
    return 0;
  }
  if (command === "doctor") {
    const { opts } = parseArgs(argv, { flags: [], values: ["config"] });
    return doctor(root, opts.config);
  }
  if (command === "enable" || command === "disable") {
    const { opts, rest } = parseArgs(argv, { flags: [], values: ["config"] });
    if (rest.length !== 1)
      throw new UsageError(`Uso: dev-checks ${command} <paso>`);
    setStep(root, opts.config, rest[0], command === "enable");
    console.log(
      `${rest[0]}: ${command === "enable" ? "activado" : "desactivado"}`,
    );
    return 0;
  }
  if (command === "hooks") {
    const { opts } = parseArgs(argv, { flags: [], values: ["config"] });
    // Corre desde `prepare` en cada install: nunca debe romper la instalación.
    try {
      const config = loadConfig(root, opts.config);
      console.log(
        `hook commit-msg: ${syncCommitMsgHook(root, config.hooks.enrichCommitMsg)}`,
      );
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      console.log(`hook commit-msg: omitido (${err.message})`);
    }
    return 0;
  }
  throw new UsageError(`Comando desconocido: ${command}\n\n${USAGE}`);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof UsageError || err instanceof ConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err);
    process.exit(2);
  },
);
