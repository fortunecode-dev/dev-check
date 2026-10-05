// Configs base que `init` escribe solo cuando el proyecto no las tiene.
const ESLINT_TS = `import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/build/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
`;

const ESLINT_JS = `import js from "@eslint/js";

export default [
  { ignores: ["**/dist/**", "**/build/**", "**/node_modules/**"] },
  js.configs.recommended,
];
`;

const PRETTIERRC = `{}\n`;

const PRETTIERIGNORE = `node_modules
dist
build
coverage
.next
.expo
pnpm-lock.yaml
package-lock.json
yarn.lock
`;

const DEPCRUISE = `/** Reglas base: sin ciclos de imports. Agrega reglas de capas según el proyecto. */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Un ciclo de imports vuelve frágil el orden de carga.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
`;

const SYNCPACK = `{
  "semverGroups": [
    {
      "label": "Versiones exactas en todos los package.json (sin ^ ni ~)",
      "range": ""
    }
  ]
}
`;

module.exports = {
  eslint: (ts) => (ts ? ESLINT_TS : ESLINT_JS),
  prettierrc: PRETTIERRC,
  prettierignore: PRETTIERIGNORE,
  depcruise: DEPCRUISE,
  syncpack: SYNCPACK,
};
