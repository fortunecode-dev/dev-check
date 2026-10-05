// `dev-checks init`: detecta el stack, pregunta solo lo que no se puede
// deducir, instala dependencias y deja config, hooks e instrucciones listos.
// Es re-ejecutable: reaplica sin duplicar ni pisar archivos del usuario.
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { spawnSync } = require("node:child_process");
const { detectStack, detectProject, allDeps } = require("./detect.cjs");
const {
  CONFIG_FILE,
  DEFAULTS,
  DEFAULT_STEPS,
  configPath,
  loadConfig,
  normalizeConfig,
} = require("./config.cjs");
const templates = require("./templates.cjs");
const { syncCommitMsgHook } = require("./hooks/install.cjs");
const agents = require("./agents.cjs");
const { readJson, green, yellow, dim } = require("./util.cjs");
const { doctor } = require("./doctor.cjs");

const PKG_ROOT = path.resolve(__dirname, "..");
const CLI = path.join(PKG_ROOT, "bin", "cli.cjs");
const SCHEMA = path.join(PKG_ROOT, "schema.json");

const rel = (root, target) =>
  path.relative(root, target).split(path.sep).join("/");

// ─── Preguntas ──────────────────────────────────────────────────────────────
// Sin TTY o con --yes se usan los valores por defecto.
function createPrompter(opts) {
  const rl =
    !opts.yes && process.stdin.isTTY
      ? readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        })
      : null;
  return {
    async confirm(question, def) {
      if (!rl) return def;
      const a = (await rl.question(`? ${question} [${def ? "S/n" : "s/N"}] `))
        .trim()
        .toLowerCase();
      return a === "" ? def : /^(s|si|sí|y|yes)$/.test(a);
    },
    async text(question, def) {
      if (!rl) return def;
      const a = (await rl.question(`? ${question} [${def}] `)).trim();
      return a === "" ? def : a;
    },
    close() {
      if (rl) rl.close();
    },
  };
}

// ─── package.json ───────────────────────────────────────────────────────────
function readPackageJson(root) {
  const file = path.join(root, "package.json");
  const raw = fs.readFileSync(file, "utf8");
  const indent = /^(\s+)"/m.exec(raw)?.[1] ?? "  ";
  return { file, data: JSON.parse(raw), indent, newline: raw.endsWith("\n") };
}

function writePackageJson({ file, data, indent, newline }) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, indent) + (newline ? "\n" : ""),
    "utf8",
  );
}

// Dependencias que ya declara algún package.json del repo (raíz o proyectos).
function declaredDeps(root, projectPaths) {
  const names = new Set();
  for (const p of [".", ...projectPaths]) {
    const pkg = readJson(path.join(root, p, "package.json"), {});
    Object.keys(allDeps(pkg)).forEach((n) => names.add(n));
  }
  return names;
}

function installCommand(pm, root, hasWorkspaces, pkgs) {
  if (pm === "pnpm")
    return [
      "pnpm",
      ["add", "-D", "-E", ...(hasWorkspaces ? ["-w"] : []), ...pkgs],
    ];
  if (pm === "yarn") {
    const lock = path.join(root, "yarn.lock");
    const berry =
      fs.existsSync(lock) &&
      fs.readFileSync(lock, "utf8").includes("__metadata");
    const flags = hasWorkspaces && !berry ? ["-W"] : [];
    return ["yarn", ["add", "-D", "--exact", ...flags, ...pkgs]];
  }
  if (pm === "bun") return ["bun", ["add", "-d", "--exact", ...pkgs]];
  return ["npm", ["install", "-D", "-E", ...pkgs]];
}

// ─── Detección → decisiones ─────────────────────────────────────────────────
async function chooseProjects(root, detected, prompt) {
  if (detected.workspaces.length)
    return detected.workspaces.map((p) => detectProject(root, p));
  const rp = detected.rootProject;
  const rootIsProject =
    rp.stack.length > 0 || fs.existsSync(path.join(root, "src"));
  if (rootIsProject || detected.candidates.length === 0) return [rp];
  // Varias carpetas con package.json y sin workspaces: no se puede saber
  // cuáles son proyectos.
  const answer = await prompt.text(
    `Carpetas con package.json: ${detected.candidates.join(", ")}. ¿Cuáles son proyectos? (separadas por coma)`,
    detected.candidates.join(","),
  );
  const chosen = answer
    .split(",")
    .map((s) => s.trim())
    .filter((s) => detected.candidates.includes(s));
  return (chosen.length ? chosen : detected.candidates).map((p) =>
    detectProject(root, p),
  );
}

async function chooseSteps(projects, tools, prompt) {
  const any = (fn) => projects.some(fn);
  const steps = {
    ...DEFAULT_STEPS,
    tsc: any((p) => p.hasTsconfig || p.hasTypescript),
    tests: any((p) => Boolean(p.tests)),
    prisma: any((p) => Boolean(p.prisma)),
    expo: any((p) => Boolean(p.expo)),
  };
  // Pasos opinados: por defecto solo si el repo ya los usa.
  const opinated = [
    ["knip", "knip (archivos, exports y dependencias sin uso)"],
    ["depcruise", "dependency-cruiser (ciclos de imports y reglas de capas)"],
    ["syncpack", "syncpack (versiones consistentes entre package.json)"],
  ];
  for (const [id, label] of opinated) {
    if (id === "syncpack" && projects.length < 2 && !tools.syncpack) {
      steps.syncpack = false;
      continue;
    }
    steps[id] = await prompt.confirm(`¿Activar ${label}?`, Boolean(tools[id]));
  }
  return steps;
}

function projectEntry(p, lint) {
  const entry = { path: p.path, stack: p.stack, lint, typeAware: p.typeAware };
  if (p.lintExt) entry.lintExt = p.lintExt;
  if (p.prisma) entry.prisma = true;
  if (p.expo) entry.expo = true;
  if (p.tests) entry.tests = p.tests;
  return entry;
}

// ─── Archivos base, dependencias y scripts ──────────────────────────────────
function createBaseConfigs(root, config, tools, hasTs, write) {
  const missing = (f) => !fs.existsSync(path.join(root, f));
  const put = (f, content) =>
    missing(f) && write(path.join(root, f), content, `${f} (base)`);
  if (config.steps.eslint && !tools.eslint)
    put("eslint.config.mjs", templates.eslint(hasTs));
  if (config.steps.prettier && !tools.prettier) {
    put(".prettierrc", templates.prettierrc);
    put(".prettierignore", templates.prettierignore);
  }
  if (config.steps.depcruise)
    put(".dependency-cruiser.cjs", templates.depcruise);
  if (config.steps.syncpack) put(".syncpackrc.json", templates.syncpack);
}

function missingDeps(root, config, hasTs) {
  const s = config.steps;
  const need = [];
  if (s.tsc && hasTs) need.push("typescript");
  if (s.eslint && config.projects.some((p) => p.lint)) {
    need.push("eslint");
    // Los paquetes que importa el eslint.config.mjs de la raíz (el base de
    // init o uno propio).
    const cfg = path.join(root, "eslint.config.mjs");
    const src = fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8") : "";
    for (const pkg of ["@eslint/js", "typescript-eslint"])
      if (src.includes(`"${pkg}"`)) need.push(pkg);
  }
  if (s.prettier) need.push("prettier");
  if (s.knip) need.push("knip");
  if (s.depcruise) need.push("dependency-cruiser");
  if (s.syncpack) need.push("syncpack");
  if (s.expo && config.projects.some((p) => p.expo)) need.push("expo-doctor");
  const declared = declaredDeps(
    root,
    config.projects.map((p) => p.path),
  );
  return [...new Set(need)].filter((n) => !declared.has(n));
}

// `dev-checks` si ya está instalado como binario; si no, la ruta a este CLI.
function cliInvocation(root) {
  const local = path.join(root, "node_modules", ".bin", "dev-checks");
  return fs.existsSync(local) ? "dev-checks" : `node ${rel(root, CLI)}`;
}

const isOurs = (v) =>
  typeof v === "string" &&
  (v.includes("dev-checks") || v.includes("bin/cli.cjs"));

// Agrega `check` (o `dev-checks` si `check` ya es otra cosa) y `prepare` para
// reinstalar el hook en cada clone. Devuelve el nombre del script y si cambió.
function ensureScripts(root, config, cli, dryRun) {
  const pkg = readPackageJson(root);
  const scripts = (pkg.data.scripts ??= {});
  const name =
    scripts.check === undefined || isOurs(scripts.check)
      ? "check"
      : "dev-checks";
  let changed = false;
  if (!isOurs(scripts[name])) {
    scripts[name] = `${cli} check`;
    changed = true;
  }
  if (config.hooks.enrichCommitMsg && !isOurs(scripts.prepare)) {
    scripts.prepare = scripts.prepare
      ? `${scripts.prepare} && ${cli} hooks`
      : `${cli} hooks`;
    changed = true;
  }
  if (changed && !dryRun) writePackageJson(pkg);
  return { name, changed };
}

// ─── Principal ──────────────────────────────────────────────────────────────
async function init(root, opts) {
  const { dryRun } = opts;
  const tag = dryRun ? `${dim("(dry-run)")} ` : "";
  const done = (m) => console.log(`  ${tag}${green("✓")} ${m}`);
  const note = (m) => console.log(`  ${yellow("⚠")} ${m}`);
  const write = (file, content, label) => {
    if (!dryRun) fs.writeFileSync(file, content, "utf8");
    done(label);
  };

  if (!fs.existsSync(path.join(root, "package.json")))
    throw new Error("init necesita un package.json en la raíz del repo.");

  const prompt = createPrompter(opts);
  try {
    const detected = detectStack(root);
    const pm = detected.packageManager;
    console.log(
      `Gestor: ${pm}${detected.workspaces.length ? ` · workspaces: ${detected.workspaces.length}` : ""}`,
    );

    // 1) Config: se conserva la existente (puede estar editada a mano).
    const cfgFile = configPath(root, opts.configFile);
    let config;
    let projects;
    if (fs.existsSync(cfgFile)) {
      config = loadConfig(root, opts.configFile);
      projects = config.projects.map((p) => detectProject(root, p.path));
      done(`${CONFIG_FILE} existente (se conserva)`);
    } else {
      projects = await chooseProjects(root, detected, prompt);
      const steps = await chooseSteps(projects, detected.tools, prompt);
      const baseOk = await prompt.confirm(
        "¿Crear las configs base que falten (eslint, prettier, …)?",
        true,
      );
      const enrich = await prompt.confirm(
        "¿Instalar el hook commit-msg (archivos y +/- en el mensaje)?",
        true,
      );
      // Si ningún proyecto tiene eslint, se crea una base y todos lo usan.
      const eslintExists = projects.some((p) => p.hasEslint);
      const createEslint = steps.eslint && baseOk && !eslintExists;
      const entries = projects.map((p) =>
        projectEntry(p, p.hasEslint || createEslint ? p.lintTargets : null),
      );
      if (!entries.some((e) => e.lint)) steps.eslint = false;
      const raw = {
        $schema: rel(root, SCHEMA),
        projects: entries,
        steps,
        globalFiles: DEFAULTS.globalFiles,
        baseline: {},
        knownEmptySuites: [],
        expoAccepted: {},
        hooks: { enrichCommitMsg: enrich },
        agents: { files: ["AGENTS.md"], linkClaudeMd: true, noCommit: true },
        output: { maxLines: 15, concurrency: 3 },
      };
      config = normalizeConfig(raw);
      write(
        cfgFile,
        JSON.stringify(raw, null, 2) + "\n",
        `${CONFIG_FILE} generado`,
      );
      if (baseOk) {
        const hasTs = projects.some((p) => p.hasTsconfig || p.hasTypescript);
        createBaseConfigs(
          root,
          config,
          { ...detected.tools, eslint: eslintExists },
          hasTs,
          write,
        );
      }
    }

    // 2) Dependencias (a nivel de la raíz, versiones exactas).
    const hasTs = projects.some((p) => p.hasTsconfig || p.hasTypescript);
    const missing = missingDeps(root, config, hasTs);
    if (missing.length) {
      const [cmd, args] = installCommand(
        pm,
        root,
        detected.workspaces.length > 0,
        missing,
      );
      const line = `${cmd} ${args.join(" ")}`;
      if (dryRun || !opts.install) {
        note(`dependencias sin instalar: ${line}`);
      } else if (
        await prompt.confirm(`¿Instalar dependencias? (${line})`, true)
      ) {
        const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
        if (res.status === 0)
          done(`dependencias instaladas: ${missing.join(", ")}`);
        else note(`falló la instalación; corre a mano: ${line}`);
      } else {
        note(`omitido; corre a mano: ${line}`);
      }
    } else {
      done("dependencias: nada que instalar");
    }

    // 3) Scripts del package.json.
    const scripts = ensureScripts(root, config, cliInvocation(root), dryRun);
    done(
      scripts.changed
        ? `package.json: script "${scripts.name}"${config.hooks.enrichCommitMsg ? " y prepare" : ""}`
        : `package.json: script "${scripts.name}" ya configurado`,
    );

    // 4) Hook commit-msg.
    if (dryRun) {
      done(
        `hook commit-msg: ${config.hooks.enrichCommitMsg ? "se instalaría" : "desactivado"}`,
      );
    } else {
      done(
        `hook commit-msg: ${syncCommitMsgHook(root, config.hooks.enrichCommitMsg)}`,
      );
    }

    // 5) AGENTS.md (+ import desde CLAUDE.md).
    const section = agents.buildSection(config, { pm, script: scripts.name });
    for (const name of config.agents.files) {
      if (dryRun) done(`${name}: se actualizaría la sección dev-checks`);
      else
        done(
          `${name}: ${agents.upsertSection(path.join(root, name), section)}`,
        );
    }
    const linkable =
      config.agents.linkClaudeMd && config.agents.files.includes("AGENTS.md");
    if (linkable && !dryRun) {
      if (!fs.existsSync(path.join(root, "CLAUDE.md"))) {
        note(
          "no hay CLAUDE.md: Claude Code no lee AGENTS.md por sí solo (crea uno con la línea `@AGENTS.md`)",
        );
      } else if (
        await prompt.confirm(
          "¿Importar AGENTS.md desde CLAUDE.md (línea @AGENTS.md)?",
          true,
        )
      ) {
        done(`CLAUDE.md: ${agents.linkClaudeMd(root, "AGENTS.md")}`);
      }
    }

    // 6) Resumen.
    if (!dryRun) {
      console.log("\nEstado:");
      doctor(root, opts.configFile);
    }
    console.log(
      `\nListo. Siguiente paso: ${agents.runCommand(pm, scripts.name, "--diff")}`,
    );
  } finally {
    prompt.close();
  }
}

module.exports = { init };
