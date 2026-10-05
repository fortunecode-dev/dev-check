const test = require("node:test");
const assert = require("node:assert/strict");
const { makeRepo, writeFiles, cli } = require("./helpers.cjs");

const config = (extra = {}) =>
  JSON.stringify({
    projects: [
      { path: "a", lint: null },
      { path: "b", lint: null },
    ],
    steps: { tsc: true, eslint: true, prettier: true, tests: false },
    ...extra,
  });

const repo = () =>
  makeRepo({
    "dev-checks.config.json": config(),
    "a/package.json": '{"name":"a"}',
    "a/x.ts": "export const x = 1;\n",
    "b/package.json": '{"name":"b"}',
    "b/y.ts": "export const y = 1;\n",
    "README.txt": "hola\n",
  });

test("sin cambios no revisa ningún proyecto", () => {
  const dir = repo();
  const { code, out } = cli(dir, "check", "--diff");
  assert.equal(code, 0);
  assert.match(out, /sin cambios en proyectos/);
});

test("un cambio en un proyecto revisa solo ese", () => {
  const dir = repo();
  writeFiles(dir, { "a/x.ts": "export const x = 2;\n" });
  const { code, out } = cli(dir, "check", "--diff");
  assert.equal(code, 0);
  assert.match(out, /^a\s+tsc/m);
  assert.doesNotMatch(out, /^b\s+tsc/m);
});

test("un archivo sin seguimiento también cuenta", () => {
  const dir = repo();
  writeFiles(dir, { "b/nuevo.ts": "export {};\n" });
  const { out } = cli(dir, "check", "--diff");
  assert.match(out, /^b\s+tsc/m);
  assert.doesNotMatch(out, /^a\s+tsc/m);
});

test("un archivo global revisa todos los proyectos", () => {
  const dir = repo();
  writeFiles(dir, { "package.json": '{"name":"root"}' });
  const { out } = cli(dir, "check", "--diff");
  assert.match(out, /^a\s+tsc/m);
  assert.match(out, /^b\s+tsc/m);
});

test("--only elige proyectos y rechaza nombres desconocidos", () => {
  const dir = repo();
  const ok = cli(dir, "check", "--only", "b");
  assert.match(ok.out, /^b\s+tsc/m);
  assert.doesNotMatch(ok.out, /^a\s+tsc/m);
  const bad = cli(dir, "check", "--only", "zzz");
  assert.equal(bad.code, 2);
  assert.match(bad.out, /Proyecto desconocido: zzz/);
});

test("un paso desactivado no aparece en la salida", () => {
  const dir = repo();
  writeFiles(dir, {
    "dev-checks.config.json": config({
      steps: { tsc: false, eslint: true, prettier: true, tests: false },
    }),
    "a/x.ts": "export const x = 3;\n",
  });
  const { out } = cli(dir, "check", "--only", "a");
  assert.doesNotMatch(out, /tsc/);
  assert.match(out, /eslint/);
});

test("enable/disable editan la config", () => {
  const dir = repo();
  assert.match(cli(dir, "disable", "tsc").out, /desactivado/);
  const { out } = cli(dir, "check", "--only", "a");
  assert.doesNotMatch(out, /tsc/);
  assert.match(cli(dir, "enable", "tsc").out, /activado/);
  assert.equal(cli(dir, "enable", "nada").code, 2);
});

test("una config inválida da un error claro", () => {
  const dir = repo();
  writeFiles(dir, { "dev-checks.config.json": '{"projects":[]}' });
  const { code, out } = cli(dir, "check");
  assert.equal(code, 2);
  assert.match(out, /"projects" debe ser una lista/);
});
