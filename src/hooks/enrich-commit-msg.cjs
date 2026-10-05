#!/usr/bin/env node
// Hook commit-msg: agrega al mensaje la lista de archivos staged con su ruta
// relativa y las líneas +/- de cada uno. Nunca bloquea el commit: ante
// cualquier fallo deja el mensaje como está.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const msgFile = process.argv[2];
if (!msgFile) process.exit(0);

const MARK = "Archivos cambiados:";

try {
  const message = fs.readFileSync(msgFile, "utf8");
  // Un amend reutiliza el mensaje: no se duplica la sección.
  if (message.includes(`\n${MARK}\n`)) process.exit(0);

  const numstat = execFileSync(
    "git",
    ["diff", "--cached", "--numstat", "--no-renames"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const rows = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [add = "0", del = "0", ...rest] = line.split("\t");
      const file = rest.join("\t");
      // Binarios salen como "-\t-": sin conteo de líneas.
      return add === "-"
        ? `  ${file} (binario)`
        : `  ${file} (+${add} -${del})`;
    });
  if (rows.length === 0) process.exit(0);

  const section = `${MARK}\n${rows.join("\n")}\n`;

  // Con editor, git deja al final un bloque de líneas "# ..." (se descarta
  // después del hook): la sección va antes, junto al mensaje real.
  const lines = message.split("\n");
  let end = lines.length;
  const firstComment = lines.findIndex((l) => l.startsWith("#"));
  if (firstComment !== -1) end = firstComment;
  const body = lines.slice(0, end).join("\n").trimEnd();
  const tail = lines.slice(end).join("\n");

  fs.writeFileSync(
    msgFile,
    `${body}\n\n${section}${tail ? `\n${tail}` : ""}`,
    "utf8",
  );
} catch (err) {
  console.error(`[enrich-commit-msg] omitido: ${err.message}`);
}
process.exit(0);
