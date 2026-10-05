const { bin, run, head, KO, OK } = require("../util.cjs");

// Paso del repo (no de un proyecto): versiones consistentes entre package.json
// según .syncpackrc.json.
module.exports = async function stepSyncpack(ctx) {
  const syncpack = bin(ctx.root, ctx.root, "syncpack");
  if (!syncpack) return { status: "skip", label: "syncpack –" };
  const res = await run(syncpack, ["lint"], ctx.root);
  if (res.code === 0) return { status: "ok", label: `syncpack ${OK}` };
  const out = (res.stdout + res.stderr).split("\n");
  const bad = out.filter((l) => /✘/.test(l));
  return {
    status: "fail",
    label: `syncpack ${KO} (${bad.length || "?"})`,
    detail: head(
      (bad.length ? bad : out).join("\n"),
      ctx.opts.verbose,
      ctx.maxLines,
    ),
  };
};
