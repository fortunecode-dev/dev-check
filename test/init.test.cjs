const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeRepo, writeFiles, cli, git } = require("./helpers.cjs");

const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");

const tsRepo = () =>
  makeRepo({
    "package.json": JSON.stringify(
      {
        name: "demo",
        scripts: { test: "jest" },
        devDependencies: { jest: "1.0.0" },
      },
      null,
      2,
    ),
    "tsconfig.json": "{}",
    "src/index.ts": "export const a = 1;\n",
    "CLAUDE.md": "# Demo\n",
  });

test("init --yes deja config, scripts, hook y AGENTS.md", () => {
  const dir = tsRepo();
  const { code, out } = cli(dir, "init", "--yes", "--no-install");
  assert.equal(code, 0, out);

  const config = JSON.parse(read(dir, "dev-checks.config.json"));
  assert.equal(config.projects[0].path, ".");
  assert.equal(config.projects[0].tests, "jest");
  assert.equal(config.steps.tsc, true);
  assert.equal(config.steps.knip, false);

  const pkg = JSON.parse(read(dir, "package.json"));
  assert.match(pkg.scripts.check, /cli\.cjs check$/);
  assert.match(pkg.scripts.prepare, /cli\.cjs hooks$/);
  assert.equal(pkg.scripts.test, "jest");

  assert.match(read(dir, "AGENTS.md"), /dev-checks:start/);
  assert.match(read(dir, "AGENTS.md"), /--diff/);
  assert.match(read(dir, "CLAUDE.md"), /@AGENTS\.md/);
  assert.ok(fs.existsSync(path.join(dir, "eslint.config.mjs")));
  assert.match(
    read(dir, ".git/hooks/commit-msg"),
    /dev-checks: enrich-commit-msg/,
  );
});

test("init es idempotente", () => {
  const dir = tsRepo();
  cli(dir, "init", "--yes", "--no-install");
  const files = [
    "dev-checks.config.json",
    "package.json",
    "AGENTS.md",
    "CLAUDE.md",
    ".git/hooks/commit-msg",
  ];
  const before = files.map((f) => read(dir, f));
  const second = cli(dir, "init", "--yes", "--no-install");
  assert.equal(second.code, 0, second.out);
  assert.deepEqual(
    files.map((f) => read(dir, f)),
    before,
  );
});

test("init --dry-run no escribe nada", () => {
  const dir = tsRepo();
  const { code } = cli(dir, "init", "--yes", "--no-install", "--dry-run");
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(path.join(dir, "dev-checks.config.json")));
  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")));
});

test("init detecta workspaces pnpm", () => {
  const dir = makeRepo({
    "package.json": '{"name":"mono"}',
    "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n',
    "apps/web/package.json": '{"name":"web","dependencies":{"next":"1.0.0"}}',
    "apps/web/tsconfig.json": "{}",
    "apps/api/package.json":
      '{"name":"api","dependencies":{"@nestjs/core":"1.0.0"}}',
    "apps/api/tsconfig.json": "{}",
  });
  assert.equal(cli(dir, "init", "--yes", "--no-install").code, 0);
  const config = JSON.parse(read(dir, "dev-checks.config.json"));
  assert.deepEqual(
    config.projects.map((p) => p.path),
    ["apps/api", "apps/web"],
  );
  assert.deepEqual(config.projects[0].lint, ["src/**/*.ts"]);
});

test("el hook commit-msg agrega archivos y +/- al mensaje", () => {
  const dir = tsRepo();
  cli(dir, "init", "--yes", "--no-install");
  writeFiles(dir, {
    "src/index.ts": "export const a = 2;\nexport const b = 3;\n",
  });
  git(dir, "add", "src/index.ts");
  git(dir, "commit", "-q", "-m", "feat: prueba");
  const msg = git(dir, "log", "-1", "--pretty=%B");
  assert.match(msg, /Archivos cambiados:/);
  assert.match(msg, /src\/index\.ts \(\+2 -1\)/);
});

test("un commit no se bloquea si el paquete del hook desaparece", () => {
  const dir = tsRepo();
  cli(dir, "init", "--yes", "--no-install");
  const hook = read(dir, ".git/hooks/commit-msg");
  fs.writeFileSync(
    path.join(dir, ".git/hooks/commit-msg"),
    hook.replace(/enrich-commit-msg\.cjs/g, "no-existe.cjs"),
    { mode: 0o755 },
  );
  writeFiles(dir, { "src/otro.ts": "export {};\n" });
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "feat: sigue funcionando");
  assert.match(git(dir, "log", "-1", "--pretty=%s"), /sigue funcionando/);
});

test("doctor reporta herramientas faltantes como aviso", () => {
  const dir = tsRepo();
  cli(dir, "init", "--yes", "--no-install");
  const { code, out } = cli(dir, "doctor");
  assert.equal(code, 0);
  assert.match(out, /config: 1 proyecto/);
  assert.match(out, /falta `tsc`/);
});
