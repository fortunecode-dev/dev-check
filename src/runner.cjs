// Orquesta los checks: elige los proyectos afectados por el diff, corre los
// pasos activos y imprime una línea por proyecto. Devuelve el código de salida.
const fs = require("node:fs");
const path = require("node:path");
const {
  git,
  splitZ,
  green,
  red,
  yellow,
  dim,
  readJson,
  head,
  prefixOf,
} = require("./util.cjs");
const stepTsc = require("./steps/tsc.cjs");
const stepEslint = require("./steps/eslint.cjs");
const { stepPrettier, checkFiles } = require("./steps/prettier.cjs");
const stepTests = require("./steps/tests.cjs");
const { runKnip, knipCounts } = require("./steps/knip.cjs");
const stepDepcruise = require("./steps/depcruise.cjs");
const stepPrisma = require("./steps/prisma.cjs");
const stepExpo = require("./steps/expo.cjs");
const stepSyncpack = require("./steps/syncpack.cjs");

class UsageError extends Error {}

function changedFiles(root, base) {
  let ref = "HEAD";
  if (base) {
    try {
      ref = git(root, ["merge-base", base, "HEAD"]).trim();
    } catch {
      throw new UsageError(`No se pudo resolver la referencia "${base}".`);
    }
  }
  const tracked = splitZ(git(root, ["diff", "--name-only", "-z", ref]));
  const alive = new Set(
    splitZ(git(root, ["diff", "--name-only", "--diff-filter=d", "-z", ref])),
  );
  const untracked = splitZ(
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  );
  const all = [...new Set([...tracked, ...untracked])];
  const existing = all
    .filter((f) => alive.has(f) || untracked.includes(f))
    .filter((f) => fs.existsSync(path.join(root, f)));
  return { all, existing };
}

// Un cambio en un proyecto también afecta a quien lo consume por dependencia.
function dependentsOf(root, projects, project) {
  const pkg = readJson(path.join(root, project.path, "package.json"), null);
  if (!pkg || project.path === ".") return [];
  return projects
    .filter((p) => {
      if (p === project) return false;
      const other = readJson(path.join(root, p.path, "package.json"), {});
      const deps = { ...other.dependencies, ...other.devDependencies };
      return deps[pkg.name] !== undefined;
    })
    .map((p) => p.name);
}

function ownerOf(projects, file) {
  let best = null;
  for (const p of projects) {
    if (
      file.startsWith(prefixOf(p)) &&
      (!best || p.path.length > best.path.length)
    )
      best = p;
  }
  return best;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

function selectProjects(root, config, opts, all, globalChange) {
  const { projects } = config;
  const selected = new Set();
  if (opts.only) {
    for (const name of opts.only) {
      const p = projects.find(
        (x) => x.name === name || x.name.endsWith("/" + name),
      );
      if (!p) {
        throw new UsageError(
          `Proyecto desconocido: ${name}\nDisponibles: ${projects.map((x) => x.name).join(", ")}`,
        );
      }
      selected.add(p.name);
    }
  } else if (opts.all || globalChange) {
    projects.forEach((p) => selected.add(p.name));
  } else {
    for (const f of all) {
      const p = ownerOf(projects, f);
      if (p) {
        selected.add(p.name);
        dependentsOf(root, projects, p).forEach((d) => selected.add(d));
      }
    }
  }
  return projects.filter((p) => selected.has(p.name));
}

async function runChecks(root, config, opts) {
  const started = Date.now();
  const { steps } = config;
  const { all, existing } = changedFiles(root, opts.base);
  const changedSet = new Set(all);
  const globalFiles = new Set(config.globalFiles);
  const globalChange = all.some((f) => globalFiles.has(f));
  const full = opts.all;
  const forced = full || Boolean(opts.only);
  const projects = selectProjects(root, config, opts, all, globalChange);

  const touches = (project, files) =>
    files.some((f) => changedSet.has(path.posix.join(project.name, f)));
  // Pasos caros: solo con --all, --only o si cambió algo que los afecta.
  const runPrismaFor = (p) =>
    steps.prisma &&
    p.prisma &&
    (forced ||
      [...changedSet].some(
        (f) =>
          f.startsWith(`${prefixOf(p)}prisma/`) ||
          f === `${prefixOf(p)}prisma.config.ts`,
      ));
  const runExpoFor = (p) =>
    steps.expo &&
    p.expo &&
    (forced ||
      touches(p, [
        "package.json",
        "app.json",
        "app.config.js",
        "app.config.ts",
      ]));
  const runSyncpack =
    steps.syncpack &&
    (full ||
      [...changedSet].some((f) =>
        /(^|\/)package\.json$|^\.syncpackrc\.json$/.test(f),
      ));

  // Archivos fuera de todo proyecto (docs, scripts, configs): solo Prettier.
  const rootFiles =
    steps.prettier && !forced
      ? existing.filter((f) => !ownerOf(config.projects, f))
      : [];

  if (!projects.length && !rootFiles.length && !runSyncpack) {
    console.log(`${green("✔ todo OK")} ${dim("(sin cambios en proyectos)")}`);
    return 0;
  }

  const ctx = {
    root,
    config,
    opts,
    changedSet,
    existing,
    globalChange,
    full,
    maxLines: config.output.maxLines,
  };
  const knipPromise =
    steps.knip && projects.length ? runKnip(ctx) : Promise.resolve(null);
  const syncpackPromise = runSyncpack
    ? stepSyncpack(ctx)
    : Promise.resolve(null);

  const rows = await pool(projects, config.output.concurrency, async (p) => {
    // Los pasos independientes corren en paralelo con la cadena
    // tsc → eslint → prettier → tests.
    const extra = Promise.all([
      steps.depcruise ? stepDepcruise(p, ctx) : null,
      runPrismaFor(p) ? stepPrisma(p, ctx) : null,
      runExpoFor(p) ? stepExpo(p, ctx) : null,
    ]);
    const rowSteps = [];
    if (steps.tsc) rowSteps.push(await stepTsc(p, ctx));
    if (steps.eslint) rowSteps.push(await stepEslint(p, ctx));
    if (steps.prettier) rowSteps.push(await stepPrettier(p, ctx));
    if (steps.tests) {
      const tests = await stepTests(p, ctx);
      if (tests) rowSteps.push(tests);
    }
    rowSteps.push(...(await extra).filter(Boolean));
    return { project: p, steps: rowSteps };
  });

  // Fila (raíz): Prettier de archivos fuera de todo proyecto + syncpack.
  const rootSteps = [];
  if (rootFiles.length) rootSteps.push(await checkFiles(rootFiles, ctx));
  const syncpackStep = await syncpackPromise;
  if (syncpackStep) rootSteps.push(syncpackStep);
  const knipIssues = await knipPromise;

  // ─── Salida ───────────────────────────────────────────────────────────────
  const width =
    Math.max(...projects.map((p) => p.name.length), rootSteps.length ? 6 : 0) +
    2;
  const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  let failures = 0;
  const details = [];
  const hints = [];
  for (const { project, steps: rowSteps } of rows) {
    const labels = rowSteps.map((s) => s.label);
    const knip = steps.knip ? knipCounts(knipIssues, project) : null;
    if (knip) labels.push(knip.label);
    console.log(`${project.name.padEnd(width)}${labels.join("  ")}`);
    if (knip && knip.total) {
      failures++;
      details.push({
        title: `${project.name} · knip (${knip.breakdown})`,
        lines: head(knip.lines.join("\n"), opts.verbose, ctx.maxLines),
      });
    }
    for (const s of rowSteps) {
      if (s.status === "fail") {
        failures++;
        details.push({
          title: `${project.name} · ${plain(s.label)}`,
          lines: s.detail || [],
        });
      }
      if (s.hint) hints.push(s.hint);
    }
  }
  if (rootSteps.length) {
    console.log(
      `${"(raíz)".padEnd(width)}${rootSteps.map((s) => s.label).join("  ")}`,
    );
    for (const s of rootSteps) {
      if (s.status === "fail") {
        failures++;
        details.push({
          title: `(raíz) · ${plain(s.label)}`,
          lines: s.detail || [],
        });
      }
    }
  }

  for (const d of details) {
    console.log(`\n${red("▸")} ${d.title}`);
    for (const l of d.lines) console.log(`  ${l}`);
  }
  for (const h of hints) console.log(`\n${yellow("ℹ")} ${h}`);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${failures ? red(`✘ ${failures} ${failures === 1 ? "fallo" : "fallos"}`) : green("✔ todo OK")} ${dim(`(${secs} s)`)}`,
  );
  return failures ? 1 : 0;
}

module.exports = { runChecks, UsageError, changedFiles, ownerOf };
