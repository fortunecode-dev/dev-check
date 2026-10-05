// Utilidades compartidas: colores, git, ejecución de procesos y búsqueda de
// binarios. Sin dependencias: solo módulos de Node.
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const dim = paint(2);
const OK = green("✓");
const KO = red("✘");

const stripAnsi = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
const splitZ = (s) => s.split("\0").filter(Boolean);

// Ejecuta un proceso sin lanzar nunca: un binario que no arranca vuelve como
// código 127 para que el paso lo reporte en vez de romper el runner.
function run(cmd, args, cwd, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      resolve({
        code: 127,
        stdout,
        stderr: stderr + String(err),
        ms: Date.now() - started,
      }),
    );
    // Algunas herramientas ignoran NO_COLOR/FORCE_COLOR: se quitan los ANSI.
    child.on("close", (code) =>
      resolve({
        code,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        ms: Date.now() - started,
      }),
    );
  });
}

// Busca el binario en el proyecto y, si no está, en la raíz del repo.
function bin(root, projectDir, name) {
  const local = path.join(projectDir, "node_modules", ".bin", name);
  if (fs.existsSync(local)) return local;
  const rootBin = path.join(root, "node_modules", ".bin", name);
  return fs.existsSync(rootBin) ? rootBin : null;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Recorta una salida larga a `lines` líneas; con --verbose entrega todo.
function head(text, verbose, lines) {
  const all = text.split("\n").filter((l) => l.trim());
  if (verbose || all.length <= lines) return all;
  return [
    ...all.slice(0, lines),
    dim(`… ${all.length - lines} líneas más (usa --verbose)`),
  ];
}

// Prefijo de rutas de un proyecto ("" si el proyecto es la raíz del repo).
const prefixOf = (project) => (project.path === "." ? "" : project.path + "/");

module.exports = {
  green,
  red,
  yellow,
  dim,
  OK,
  KO,
  stripAnsi,
  git,
  splitZ,
  run,
  bin,
  readJson,
  head,
  prefixOf,
};
