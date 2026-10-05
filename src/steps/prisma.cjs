const path = require("node:path");
const { bin, run, head, KO, OK } = require("../util.cjs");

// validate + format --check sin base de datos: la DATABASE_URL es de relleno,
// solo para que prisma.config.ts cargue. La deriva schema↔migraciones no se
// revisa aquí (exige una shadow database).
module.exports = async function stepPrisma(project, ctx) {
  const dir = path.join(ctx.root, project.path);
  const prisma = bin(ctx.root, dir, "prisma");
  if (!prisma) return { status: "skip", label: "prisma –" };
  const env = {
    DATABASE_URL: "postgresql://check:check@localhost:5432/check",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
  const [validate, format] = await Promise.all([
    run(prisma, ["validate"], dir, env),
    run(prisma, ["format", "--check"], dir, env),
  ]);
  const clean = (r) =>
    (r.stdout + r.stderr)
      .split("\n")
      .filter(
        (l) =>
          l.trim() && !/^(Loaded Prisma config|Prisma schema loaded)/.test(l),
      );
  const problems = [];
  if (validate.code !== 0) problems.push("validate", ...clean(validate));
  if (format.code !== 0)
    problems.push(
      "format --check (corre `prisma format` en el proyecto)",
      ...clean(format),
    );
  if (!problems.length) return { status: "ok", label: `prisma ${OK}` };
  return {
    status: "fail",
    label: `prisma ${KO}`,
    detail: head(problems.join("\n"), ctx.opts.verbose, ctx.maxLines),
  };
};
