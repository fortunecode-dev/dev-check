// Repos temporales para probar el CLI de punta a punta, sin dependencias.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "bin", "cli.cjs");

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { cwd, encoding: "utf8" },
  );
}

// Crea un repo con `files` ({ ruta: contenido }) ya commiteados.
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-checks-"));
  git(dir, "init", "-q");
  writeFiles(dir, files);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function cli(cwd, ...args) {
  const res = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: res.status, out: res.stdout + res.stderr };
}

module.exports = { makeRepo, writeFiles, cli, git };
