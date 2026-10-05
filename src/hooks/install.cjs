// Instala/quita los bloques de dev-checks en los hooks de git. Cada bloque va
// entre marcas propias: si el hook ya tiene contenido ajeno no se pisa, y
// reinstalar reemplaza solo el bloque.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const HOOK_SCRIPT = path.join(__dirname, "enrich-commit-msg.cjs");

function gitOut(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// Directorio de hooks real (respeta core.hooksPath); null si no es repo git.
function hooksDir(root) {
  try {
    const dir = gitOut(root, ["rev-parse", "--git-path", "hooks"]);
    return path.isAbsolute(dir) ? dir : path.join(root, dir);
  } catch {
    return null;
  }
}

// Con husky los hooks los administra husky: no se tocan sin permiso.
function managedByOtherTool(root) {
  try {
    const custom = gitOut(root, ["config", "--get", "core.hooksPath"]);
    return /husky/i.test(custom) ? custom : null;
  } catch {
    return null;
  }
}

const marks = (name) => ({
  start: `# >>> dev-checks: ${name}`,
  end: `# <<< dev-checks: ${name}`,
});

function removeBlock(content, name) {
  const { start, end } = marks(name);
  const s = content.indexOf(start);
  const e = content.indexOf(end);
  if (s === -1 || e === -1) return content;
  return content.slice(0, s) + content.slice(e + end.length + 1);
}

function upsertBlock(file, name, body) {
  const { start, end } = marks(name);
  const block = `${start}\n${body.trim()}\n${end}\n`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `#!/bin/sh\n${block}`, { mode: 0o755 });
    return "instalado";
  }
  let content = fs.readFileSync(file, "utf8");
  const s = content.indexOf(start);
  const e = content.indexOf(end);
  let result = "actualizado";
  if (s !== -1 && e !== -1) {
    content = content.slice(0, s) + block + content.slice(e + end.length + 1);
  } else {
    const first = content.startsWith("#!") ? content.indexOf("\n") + 1 : 0;
    content = content.slice(0, first) + block + content.slice(first);
    result = "agregado";
  }
  fs.writeFileSync(file, content, { mode: 0o755 });
  return result;
}

function hasBlock(root, hook, name) {
  const dir = hooksDir(root);
  if (!dir) return false;
  const file = path.join(dir, hook);
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").includes(marks(name).start)
    : false;
}

// Instala o quita el hook commit-msg según `enabled`. Devuelve un texto corto.
function syncCommitMsgHook(root, enabled) {
  const dir = hooksDir(root);
  if (!dir) return "omitido (no es un repo git)";
  const other = managedByOtherTool(root);
  if (other)
    return `omitido (core.hooksPath=${other}: agrega a mano \`node ${path.relative(root, HOOK_SCRIPT)} "$1"\` a su commit-msg)`;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "commit-msg");
  const name = "enrich-commit-msg";
  if (!enabled) {
    if (!fs.existsSync(file)) return "desactivado";
    const cleaned = removeBlock(fs.readFileSync(file, "utf8"), name);
    // Un hook que solo tenía nuestro bloque se elimina entero.
    if (cleaned.replace(/^#!.*\n?/, "").trim() === "") fs.rmSync(file);
    else fs.writeFileSync(file, cleaned, { mode: 0o755 });
    return "desactivado";
  }
  const rel = path.relative(root, HOOK_SCRIPT).split(path.sep).join("/");
  // El `if` evita bloquear commits si el paquete se desinstaló (un `&&` dejaría
  // el hook con código 1).
  const script = `"$(git rev-parse --show-toplevel)/${rel}"`;
  const body = `if [ -f ${script} ]; then node ${script} "$1"; fi`;
  return upsertBlock(file, name, body);
}

module.exports = { syncCommitMsgHook, hasBlock, hooksDir, HOOK_SCRIPT };
