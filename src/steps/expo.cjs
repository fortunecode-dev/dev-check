const path = require("node:path");
const { bin, run, head, KO, OK, yellow } = require("../util.cjs");

const NETWORK =
  /fetch failed|ENOTFOUND|requires a connection|unexpected server response/i;

// expo-doctor corre con cwd = la app (Metro resuelve tailwind.config relativo
// al cwd). Lo que depende de la red, los parches pendientes del SDK y los
// avisos de React Native Directory son aviso (⚠), no fallo.
module.exports = async function stepExpo(project, ctx) {
  const doctor = bin(ctx.root, ctx.root, "expo-doctor");
  if (!doctor) return { status: "skip", label: "expo –" };
  const dir = path.join(ctx.root, project.path);
  const res = await run(doctor, [], dir);
  const lines = (res.stdout + res.stderr).split("\n");
  if (res.code === 0) return { status: "ok", label: `expo ${OK}` };

  // Secciones: "✖ título" seguido de su detalle hasta el siguiente "✖".
  const sections = [];
  for (const line of lines) {
    if (line.startsWith("✖ "))
      sections.push({ title: line.slice(2).trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
  }
  // Errores "Unexpected error while running '<check>'" por falta de red.
  const offlineChecks = new Set();
  lines.forEach((l, i) => {
    const m = /Unexpected error while running '(.+)' check/.exec(l);
    if (m && NETWORK.test(lines.slice(i + 1, i + 6).join("\n")))
      offlineChecks.add(m[1]);
  });

  const failures = [];
  const warns = [];
  const accepted = (ctx.config.expoAccepted[project.name] || []).map(
    (src) => new RegExp(src),
  );
  for (const s of sections) {
    const body = s.body.join("\n");
    if (offlineChecks.has(s.title) || NETWORK.test(body)) {
      warns.push("sin red");
    } else if (/React Native Directory/.test(s.title)) {
      warns.push("rn-directory");
    } else if (
      /match versions required/.test(s.title) &&
      /Patch version mismatches/.test(body) &&
      !/(Minor|Major) version mismatches/i.test(body)
    ) {
      warns.push("parches del SDK (npx expo install --check)");
    } else {
      const issues = s.body.filter((l) => /^- /.test(l));
      const left = issues.filter((l) => !accepted.some((re) => re.test(l)));
      if (issues.length && !left.length) continue;
      failures.push(s.title, ...s.body.filter((l) => l.trim()).slice(0, 6));
    }
  }
  if (failures.length) {
    return {
      status: "fail",
      label: `expo ${KO}`,
      detail: head(failures.join("\n"), ctx.opts.verbose, ctx.maxLines),
    };
  }
  if (warns.length) {
    const all = [...new Set(warns)];
    return {
      status: "ok",
      label: `expo ${yellow("⚠")} ${all.join(", ")}`,
    };
  }
  return { status: "ok", label: `expo ${OK}` };
};
