# Stack Templates

Build/run recipes for supported stacks: a base image plus the build and run
steps for each stack.

Each template is also represented as a `Template` row in the database (see
`apps/control-plane/src/db/seed.ts`), which carries the metadata:
`installImage`, `installScript`, `defaultBuildCommand`, `defaultRunCommand`,
`defaultPort`, and declared `variables`.

| Template | Path | Runtime | For |
|---|---|---|---|
| Java 21 (Maven) | `java/Dockerfile` | `eclipse-temurin:21-jre` | Backends (executable JAR) |
| Java 25 (Gradle) | `java-gradle/Dockerfile` | `eclipse-temurin:25-jre` | Backends (executable JAR) |
| Java (Maven WAR → Tomcat) | `java-war/Dockerfile` | `tomcat:9.0` | Backends (servlet WAR) |
| Next.js 20 | `nextjs/Dockerfile` | `node:20-alpine` | Frontends |
| React (Vite) | `react-vite/Dockerfile` | `nginx:1.27-alpine` | Frontends (SPA) |

## Build model

The control plane sends the template's `installScript` and `installImage` to the
agent. The agent clones the repo (using the PAT only transiently), runs the build
in an isolated installer container, then produces the runtime image from the
Dockerfile here.

## Adding a template

1. Add `templates/<stack>/Dockerfile`.
2. Add a corresponding built-in `Template` in `seed.ts` (or via an admin API later).
