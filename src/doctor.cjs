// `dev-checks doctor`: comprueba que la config sea válida y que cada paso
// activo tenga su herramienta instalada, el hook puesto y AGENTS.md al día.
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig, ConfigError } = require("./config.cjs");
const { hasBlock, hooksDir } = require("./hooks/install.cjs");
const { START } = require("./agents.cjs");
const { bin, green, red, yellow } = require("./util.cjs");

const OK = green("✓");
const WARN = yellow("⚠");
const KO = red("✘");

// Binario que necesita cada paso, y si se busca por proyecto o en la raíz.
const TOOLS = {
  tsc: { bin: "tsc", perProject: true },
  eslint: { bin: "eslint", perProject: true },
  prettier: { bin: "prettier" },
  knip: { bin: "knip" },
  depcruise: { bin: "depcruise" },
  syncpack: { bin: "syncpack" },
  expo: { bin: "expo-doctor" },
  prisma: { bin: "prisma", perProject: true },
};

// Devuelve 1 si la config es inválida; las herramientas que faltan son aviso.
function doctor(root, configFile) {
  let config;
  try {
    config = loadConfig(root, configFile);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.log(`  ${KO} config: ${err.message}`);
    return 1;
  }
  console.log(`  ${OK} config: ${config.projects.length} proyecto(s)`);

  const applies = {
    eslint: (p) => Boolean(p.lint),
    prisma: (p) => p.prisma,
    expo: (p) => p.expo,
  };
  for (const [id, tool] of Object.entries(TOOLS)) {
    if (!config.steps[id]) continue;
    const scoped = config.projects.filter(applies[id] ?? (() => true));
    if (!scoped.length && applies[id]) continue;
    const absent = tool.perProject
      ? scoped.filter((p) => !bin(root, path.join(root, p.path), tool.bin))
      : bin(root, root, tool.bin)
        ? []
        : [{ path: "raíz" }];
    if (!absent.length) console.log(`  ${OK} ${id}`);
    else
      console.log(
        `  ${WARN} ${id}: falta \`${tool.bin}\` (${absent.map((p) => p.path).join(", ")})`,
      );
  }

  if (config.hooks.enrichCommitMsg) {
    if (!hooksDir(root))
      console.log(`  ${WARN} hook commit-msg: no es un repo git`);
    else if (hasBlock(root, "commit-msg", "enrich-commit-msg"))
      console.log(`  ${OK} hook commit-msg`);
    else
      console.log(
        `  ${WARN} hook commit-msg: no instalado (corre \`dev-checks hooks\`)`,
      );
  }
  for (const name of config.agents.files) {
    const file = path.join(root, name);
    const has =
      fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(START);
    console.log(
      has
        ? `  ${OK} ${name}`
        : `  ${WARN} ${name}: sin la sección dev-checks (corre \`dev-checks init\`)`,
    );
  }
  return 0;
}

module.exports = { doctor };
