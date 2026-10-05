# dev-checks

Checks de salida mínima (una línea por proyecto) sobre los proyectos con cambios, pensados para que un agente de IA los corra en vez de inventar comprobaciones y leer logs largos. Sin dependencias en runtime; Node >= 20.

## Uso

```bash
dev-checks init            # detecta el stack, instala dependencias, escribe config/hook/AGENTS.md
dev-checks check --diff    # solo los proyectos con cambios vs HEAD
dev-checks check --all | --base main | --only a,b | --verbose
dev-checks doctor          # config, herramientas, hook y AGENTS.md
dev-checks enable|disable <paso>
dev-checks hooks           # (re)instala o quita el hook commit-msg
```

`init` acepta `--yes` (defaults, sin preguntas), `--no-install` y `--dry-run`. Es re-ejecutable: conserva `dev-checks.config.json`, no pisa archivos existentes y no duplica bloques.

## Qué hace `init`

1. Detecta gestor (pnpm/yarn/bun/npm), workspaces, TypeScript, Next, Nest, Expo, Prisma, jest/vitest y las herramientas ya presentes. Pregunta solo lo que no se deduce: qué carpetas son proyectos (repo sin workspaces), y activar knip / dependency-cruiser / syncpack.
2. Escribe `dev-checks.config.json` (con `$schema`) y las configs base que falten (eslint, prettier, dependency-cruiser, syncpack).
3. Instala en la raíz las dependencias que falten, con versión exacta.
4. Agrega los scripts `check` y `prepare` (reinstala el hook en cada clone).
5. Instala el hook `commit-msg` en un bloque marcado, sin pisar hooks ajenos (con husky avisa y no lo toca).
6. Genera la sección `dev-checks` de `AGENTS.md` (flujo `check --diff`, cómo leer un `✘`) y, si existe `CLAUDE.md`, le agrega `@AGENTS.md`.

## Pasos (`steps` en la config)

`tsc`, `eslint`, `prettier`, `tests` (jest/vitest), `prisma` (validate + format), `expo` (expo-doctor), `knip`, `depcruise` y `syncpack`. Los pasos caros (prisma, expo, syncpack) solo corren con `--all`/`--only` o si cambió algo que los afecta. Esquema y descripción de cada opción: `schema.json`.

## Hook commit-msg

Agrega al mensaje `Archivos cambiados:` con la ruta relativa y `(+X -Y)` de cada archivo staged. Nunca bloquea un commit.

## Pendiente

- Pasos específicos de cada repo (contraste de color, Conventional Commits, bump de versión) no forman parte del módulo.
- Publicar en npm para poder instalarlo como devDependency (`init` hoy escribe `node <ruta>/bin/cli.cjs` si no encuentra el binario).
- Pruebas: `npm test` (`node --test`, repos temporales).
