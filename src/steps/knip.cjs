const { bin, run, KO, OK, prefixOf } = require("../util.cjs");

// knip corre una sola vez para todo el repo y se filtra por proyecto.
// undefined = no pudo correr; null = no está instalado.
async function runKnip(ctx) {
  const knip = bin(ctx.root, ctx.root, "knip");
  if (!knip) return null;
  const res = await run(knip, ["--reporter", "json"], ctx.root);
  try {
    return JSON.parse(res.stdout).issues || [];
  } catch {
    return undefined;
  }
}

const itemName = (it) => (typeof it === "string" ? it : (it.name ?? ""));

// Cualquier hallazgo (archivo, dependencia o export sin uso) falla el check.
function knipCounts(issues, project) {
  if (issues === null) return { label: "knip –" };
  if (issues === undefined) return { label: "knip ?" };
  const prefix = prefixOf(project);
  const byCat = {};
  const lines = [];
  let total = 0;
  for (const issue of issues) {
    if (!issue.file.startsWith(prefix)) continue;
    for (const [cat, items] of Object.entries(issue)) {
      if (!Array.isArray(items) || !items.length) continue;
      byCat[cat] = (byCat[cat] || 0) + items.length;
      total += items.length;
      for (const it of items)
        lines.push(`${issue.file} ${cat} ${itemName(it)}`);
    }
  }
  const breakdown = Object.entries(byCat)
    .map(([c, n]) => `${n} ${c}`)
    .join(", ");
  return {
    label: total ? `knip ${KO} (${total})` : `knip ${OK}`,
    breakdown,
    total,
    lines,
  };
}

module.exports = { runKnip, knipCounts };
