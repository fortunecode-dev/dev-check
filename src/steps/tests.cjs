const path = require("node:path");
const { bin, run, head, KO, OK } = require("../util.cjs");

// Soporta jest y vitest (su reporter json comparte la forma que se lee aquí).
const RUNNERS = {
  jest: { bin: "jest", args: ["--json", "--silent"] },
  vitest: { bin: "vitest", args: ["run", "--reporter=json"] },
};

module.exports = async function stepTests(project, ctx) {
  if (!project.tests) return null;
  const runner = RUNNERS[project.tests];
  if (!runner) {
    return {
      status: "fail",
      label: `tests ${KO} (runner desconocido: ${project.tests})`,
    };
  }
  const dir = path.join(ctx.root, project.path);
  const exe = bin(ctx.root, dir, runner.bin);
  if (!exe) return { status: "skip", label: `${project.tests} –` };
  const res = await run(exe, runner.args, dir);
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    return {
      status: "fail",
      label: `${project.tests} ${KO} (no pudo correr)`,
      detail: head(res.stderr || res.stdout, ctx.opts.verbose, ctx.maxLines),
    };
  }
  const realFailures = [];
  let known = 0;
  for (const suite of report.testResults || []) {
    if (suite.status !== "failed") continue;
    // Una suite vacía que ya estaba así no cuenta como fallo.
    const isEmpty = /must contain at least one test/i.test(suite.message || "");
    if (
      isEmpty &&
      ctx.config.knownEmptySuites.some((s) => suite.name.endsWith(s))
    ) {
      known++;
      continue;
    }
    realFailures.push(
      `${path.relative(dir, suite.name)}\n${(suite.message || "").replace(/\x1b\[[0-9;]*m/g, "")}`,
    );
  }
  const summary = `${report.numPassedTests} ok${known ? `, ${known} vacía conocida` : ""}`;
  if (realFailures.length) {
    return {
      status: "fail",
      label: `${project.tests} ${KO} (${report.numFailedTests} fallan)`,
      detail: head(realFailures.join("\n"), ctx.opts.verbose, ctx.maxLines),
    };
  }
  return { status: "ok", label: `${project.tests} ${OK} (${summary})` };
};
