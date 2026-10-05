// Genera la sección de instrucciones para agentes de IA (AGENTS.md) con el
// flujo de checks. Va entre marcas: re-ejecutar reemplaza solo la sección.
const fs = require("node:fs");
const path = require("node:path");

const START = "<!-- dev-checks:start -->";
const END = "<!-- dev-checks:end -->";

const STEP_HELP = {
  tsc: "errores de tipos (`archivo(línea,col): error TSxxxx`)",
  eslint: "reglas de lint (`archivo:línea:col regla mensaje`)",
  prettier: "formato: corrige con `prettier --write <archivos>`",
  tests: "tests fallidos (jest/vitest)",
  knip: "archivos, exports o dependencias sin uso",
  depcruise: "ciclos de imports o reglas de capas",
  prisma:
    "`prisma validate` / `prisma format --check`: corrige con `prisma format`",
  expo: "expo-doctor (`⚠` = aviso que no falla)",
  syncpack: "versiones inconsistentes entre package.json",
};

// Comando para correr el script `script` con argumentos según el gestor.
function runCommand(pm, script, args) {
  if (pm === "npm") return `npm run ${script} -- ${args}`;
  return `${pm} run ${script} ${args}`;
}

function buildSection(config, { pm, script }) {
  const active = Object.entries(config.steps)
    .filter(([, on]) => on)
    .map(([id]) => id);
  const diff = runCommand(pm, script, "--diff");
  const only = runCommand(pm, script, "--only <proyecto> --verbose");
  const projects = config.projects.map((p) => `\`${p.name}\``).join(", ");
  const lines = [
    START,
    "## Verificación del agente (dev-checks)",
    "",
    "Los checks del proyecto tienen salida mínima para gastar pocos tokens: úsalos en vez de inventar comprobaciones propias (`tsc`, `eslint`, `prettier` sueltos) ni analizar logs largos.",
    "",
  ];
  if (config.agents.noCommit)
    lines.push(
      "El agente **solo aplica cambios; no hace `git commit` ni `push`** (lo decide el usuario).",
      "",
    );
  lines.push(
    "Al terminar de editar:",
    "",
    `1. Corre \`${diff}\`: detecta solo los proyectos con cambios contra HEAD e imprime una línea por proyecto. No elijas proyectos a mano.`,
    `2. Una línea con \`✘\` trae debajo el detalle mínimo del fallo: léelo y corrige. Solo si no alcanza, repite con \`${only}\`.`,
    `3. Vuelve a correr \`${diff}\` hasta que termine en verde (\`✔ todo OK\`); no des la tarea por terminada en rojo.`,
    "",
    `Proyectos: ${projects}. Pasos activos y qué significa un \`✘\`:`,
    "",
  );
  for (const id of active) lines.push(`- \`${id}\`: ${STEP_HELP[id]}`);
  lines.push(
    "",
    "Más opciones: `--all` (todos los proyectos), `--base <ref>` (cambios contra una rama).",
    "Configuración y pasos activos: `dev-checks.config.json` (`dev-checks enable|disable <paso>`).",
  );
  if (config.hooks.enrichCommitMsg)
    lines.push(
      "",
      "El hook `commit-msg` agrega solo al mensaje la sección `Archivos cambiados:` con la ruta y `(+X -Y)` de cada archivo: no la escribas a mano.",
    );
  lines.push(END, "");
  return lines.join("\n");
}

// Inserta o reemplaza la sección en `file`. Devuelve 'creado' | 'actualizado'
// | 'sin cambios'.
function upsertSection(file, section) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      `# Instrucciones para agentes\n\n${section}`,
      "utf8",
    );
    return "creado";
  }
  const content = fs.readFileSync(file, "utf8");
  const s = content.indexOf(START);
  const e = content.indexOf(END);
  let next;
  if (s !== -1 && e !== -1) {
    next = content.slice(0, s) + section + content.slice(e + END.length + 1);
  } else {
    next = `${content.trimEnd()}\n\n${section}`;
  }
  if (next === content) return "sin cambios";
  fs.writeFileSync(file, next, "utf8");
  return "actualizado";
}

// Claude Code lee CLAUDE.md, no AGENTS.md: una línea `@AGENTS.md` lo importa.
function linkClaudeMd(root, target) {
  const file = path.join(root, "CLAUDE.md");
  if (!fs.existsSync(file)) return "sin CLAUDE.md";
  const content = fs.readFileSync(file, "utf8");
  if (content.includes(`@${target}`)) return "ya enlazado";
  fs.writeFileSync(file, `${content.trimEnd()}\n\n@${target}\n`, "utf8");
  return "enlazado";
}

module.exports = {
  buildSection,
  upsertSection,
  linkClaudeMd,
  runCommand,
  START,
  END,
};
