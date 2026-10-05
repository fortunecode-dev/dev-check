const fs = require("node:fs");
const path = require("node:path");
const { bin, run, head, KO, OK } = require("../util.cjs");

const CONFIG = ".dependency-cruiser.cjs";

// Ciclos y reglas de capas. Corre desde la raíz porque las reglas usan rutas
// relativas a ella; el tsconfig va en ruta absoluta (con una relativa TS no
// encuentra archivos).
module.exports = async function stepDepcruise(project, ctx) {
  const depcruise = bin(ctx.root, ctx.root, "depcruise");
  if (!depcruise || !fs.existsSync(path.join(ctx.root, CONFIG)))
    return { status: "skip", label: "deps –" };
  const hasSrc = fs.existsSync(path.join(ctx.root, project.path, "src"));
  const srcDir = hasSrc ? path.join(project.path, "src") : project.path;
  const args = [srcDir, "--config", CONFIG, "--output-type", "json"];
  const tsconfig = path.join(ctx.root, project.path, "tsconfig.json");
  if (fs.existsSync(tsconfig)) args.push("--ts-config", tsconfig);
  const res = await run(depcruise, args, ctx.root);
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    return {
      status: "fail",
      label: `deps ${KO} (no pudo correr)`,
      detail: head(res.stderr || res.stdout, ctx.opts.verbose, ctx.maxLines),
    };
  }
  const violations = report.summary.violations || [];
  const describe = (v) => {
    const to = v.cycle ? v.cycle.map((c) => c.name).join(" → ") : v.to;
    return `${v.rule.name}: ${v.from} → ${to}`;
  };
  const errors = violations.filter((v) => v.rule.severity === "error");
  const warns = violations.filter((v) => v.rule.severity === "warn");
  if (errors.length) {
    return {
      status: "fail",
      label: `deps ${KO} (${errors.length}${warns.length ? `, ${warns.length} warn` : ""})`,
      detail: head(
        errors.map(describe).join("\n"),
        ctx.opts.verbose,
        ctx.maxLines,
      ),
    };
  }
  return {
    status: "ok",
    label: warns.length ? `deps ${OK} (${warns.length} warn)` : `deps ${OK}`,
    hint:
      warns.length && ctx.opts.verbose
        ? `${project.name} deps (warn):\n  ${warns.map(describe).join("\n  ")}`
        : undefined,
  };
};
