const path = require("node:path");
const { bin, run, head, KO, OK, prefixOf } = require("../util.cjs");

module.exports = async function stepEslint(project, ctx) {
  if (!project.lint) return { status: "skip", label: "eslint –" };
  const dir = path.join(ctx.root, project.path);
  const eslint = bin(ctx.root, dir, "eslint");
  if (!eslint) return { status: "skip", label: "eslint –" };
  let targets = project.lint;
  if (project.typeAware && !ctx.full && !ctx.globalChange) {
    // Con reglas type-aware la caché de eslint puede quedar vieja si cambia un
    // tipo en otro archivo: en modo diff se revisan solo los archivos tocados.
    const prefix = prefixOf(project);
    targets = ctx.existing
      .filter((f) => f.startsWith(prefix) && project.lintExt.test(f))
      .map((f) => f.slice(prefix.length))
      .filter((f) => !project.lintIgnore.some((frag) => f.includes(frag)));
    if (!targets.length)
      return { status: "ok", label: `eslint ${OK} (sin archivos cambiados)` };
  }
  const args = [...targets, "-f", "json"];
  if (!project.typeAware) {
    args.push(
      "--cache",
      "--cache-location",
      path.join(dir, "node_modules", ".cache", "eslint", ".eslintcache"),
    );
  }
  const res = await run(eslint, args, dir);
  let results;
  try {
    results = JSON.parse(res.stdout);
  } catch {
    return {
      status: "fail",
      label: `eslint ${KO} (no pudo correr)`,
      detail: head(res.stderr || res.stdout, ctx.opts.verbose, ctx.maxLines),
    };
  }
  let errors = 0;
  let warnings = 0;
  const lines = [];
  for (const file of results) {
    for (const m of file.messages) {
      if (m.severity === 2) {
        errors++;
        const rel = path.relative(dir, file.filePath);
        lines.push(
          `${rel}:${m.line}:${m.column} ${m.ruleId ?? "error"} ${m.message}`,
        );
      } else warnings++;
    }
  }
  const counts = `${errors} err, ${warnings} warn`;
  if (errors > 0)
    return {
      status: "fail",
      label: `eslint ${KO} (${counts})`,
      detail: head(lines.join("\n"), ctx.opts.verbose, ctx.maxLines),
    };
  return { status: "ok", label: `eslint ${OK} (${counts})` };
};
