const path = require("node:path");
const { bin, run, readJson, head, KO, OK } = require("../util.cjs");

const countTscErrors = (out) => (out.match(/error TS\d+/g) || []).length;

module.exports = async function stepTsc(project, ctx) {
  const dir = path.join(ctx.root, project.path);
  const tsc = bin(ctx.root, dir, "tsc");
  if (!tsc) return { status: "skip", label: "tsc –" };
  const args = ["--noEmit", "--pretty", "false", "-p", "."];
  // TS 6 marca `baseUrl` como deprecado y aborta con TS5101 si no se silencia.
  const tsPkg = readJson(
    path.join(dir, "node_modules", "typescript", "package.json"),
    { version: "0.0.0" },
  );
  if (parseInt(tsPkg.version, 10) >= 6)
    args.push("--ignoreDeprecations", "6.0");
  const res = await run(tsc, args, dir);
  const out = res.stdout + res.stderr;
  const errors = countTscErrors(out);
  const baseline = ctx.config.baseline[project.name] ?? 0;
  if (res.code !== 0 && errors === 0) {
    return {
      status: "fail",
      label: `tsc ${KO} (no pudo correr)`,
      detail: head(out, ctx.opts.verbose, ctx.maxLines),
    };
  }
  if (errors > baseline) {
    const lines = out.split("\n").filter((l) => /error TS\d+/.test(l));
    // Primero los errores de archivos que cambiaron: son los del agente.
    const touched = lines.filter((l) =>
      ctx.changedSet.has(path.posix.join(project.name, l.split("(")[0])),
    );
    return {
      status: "fail",
      label: baseline
        ? `tsc ${KO} (${errors} > baseline ${baseline})`
        : `tsc ${KO} (${errors})`,
      detail: head(
        (touched.length && !ctx.opts.verbose ? touched : lines).join("\n"),
        ctx.opts.verbose,
        ctx.maxLines,
      ),
    };
  }
  if (errors < baseline) {
    return {
      status: "ok",
      label: `tsc ${OK} (${errors}, baseline ${baseline})`,
      hint: `${project.name}: tsc bajó a ${errors}; baja "baseline" en dev-checks.config.json.`,
    };
  }
  return {
    status: "ok",
    label: baseline ? `tsc ${OK} (${errors}, baseline)` : `tsc ${OK}`,
  };
};
