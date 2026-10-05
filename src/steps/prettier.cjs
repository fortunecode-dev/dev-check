const { bin, run, head, KO, OK, prefixOf } = require("../util.cjs");

// Revisa con Prettier una lista de archivos (o rutas) y resume los que fallan.
async function checkFiles(files, ctx) {
  const prettier = bin(ctx.root, ctx.root, "prettier");
  if (!prettier) return { status: "skip", label: "prettier –" };
  if (!files.length) return { status: "ok", label: `prettier ${OK}` };
  const res = await run(
    prettier,
    [
      "--check",
      "--ignore-unknown",
      "--no-error-on-unmatched-pattern",
      ...files,
    ],
    ctx.root,
  );
  if (res.code === 0) return { status: "ok", label: `prettier ${OK}` };
  const bad = (res.stdout + res.stderr)
    .split("\n")
    .filter(
      (l) =>
        /^\[(warn|error)\]/.test(l) &&
        !/Code style issues|Run Prettier|All matched/.test(l),
    );
  return {
    status: "fail",
    label: `prettier ${KO} (${bad.length || "?"})`,
    detail: head(bad.join("\n"), ctx.opts.verbose, ctx.maxLines),
  };
}

function stepPrettier(project, ctx) {
  const prefix = prefixOf(project);
  const files = ctx.full
    ? [project.path]
    : ctx.existing.filter((f) => f.startsWith(prefix));
  return checkFiles(files, ctx);
}

module.exports = { stepPrettier, checkFiles };
