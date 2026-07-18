import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

loadEnv({ path: '../../.env' });
loadEnv();
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import * as schema from './schema';
import { catalogApps, templates, users } from './schema';

async function seedCatalogApps(
  db: ReturnType<typeof drizzle<typeof schema>>,
) {
  // Manifests live at <repo>/catalog/apps/*.json (two levels up from src/db).
  const dir = resolve(__dirname, '../../../../catalog/apps');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    console.warn(`Catalog apps directory not found: ${dir}`);
    return;
  }

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
      slug: string;
      name: string;
      description?: string;
      category?: string;
      icon?: string;
      minTier?: 'free' | 'homelab';
      deployKind: 'image' | 'compose' | 'git';
      image?: string;
      composeYaml?: string;
      composeGitUrl?: string;
      composeFile?: string;
      defaultPort?: number;
      recommendedVolumes?: { mountPath: string }[];
      envDefaults?: {
        key: string;
        value?: string;
        secret?: boolean;
        required?: boolean;
      }[];
    };
    const values = {
      slug: raw.slug,
      name: raw.name,
      description: raw.description ?? null,
      category: raw.category ?? null,
      icon: raw.icon ?? null,
      minTier: raw.minTier ?? 'free',
      deployKind: raw.deployKind,
      image: raw.image ?? null,
      composeYaml: raw.composeYaml ?? null,
      composeGitUrl: raw.composeGitUrl ?? null,
      composeFile: raw.composeFile ?? null,
      defaultPort: raw.defaultPort ?? null,
      recommendedVolumes: raw.recommendedVolumes ?? [],
      envDefaults: raw.envDefaults ?? [],
      updatedAt: new Date(),
    };
    const existing = await db
      .select({ id: catalogApps.id })
      .from(catalogApps)
      .where(eq(catalogApps.slug, raw.slug))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(catalogApps).values(values);
      console.log(`Catalog app created: ${raw.slug}`);
    } else {
      await db
        .update(catalogApps)
        .set(values)
        .where(eq(catalogApps.id, existing[0].id));
      console.log(`Catalog app updated: ${raw.slug}`);
    }
  }
  console.log(`Seeded ${files.length} catalog app(s).`);
}

async function main() {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://selfhosted:selfhosted@localhost:5432/selfhosted';
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'changeme123';

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(users).values({
      email,
      password: await bcrypt.hash(password, 12),
      role: 'ADMIN',
    });
    console.log(`Admin user created: ${email}`);
  } else {
    console.log(`Admin user already exists: ${email}`);
  }

  const builtInTemplates: (typeof templates.$inferInsert)[] = [
    {
      name: 'Java 21 (Maven)',
      description:
        'Builds a Maven project into a JAR and runs it on Temurin 21.',
      category: 'Java',
      type: 'BACKEND',
      baseImage: 'eclipse-temurin:21-jre',
      dockerfilePath: 'templates/java/Dockerfile',
      installImage: 'maven:3.9-eclipse-temurin-21',
      installScript: ['#!/bin/bash', 'set -e', 'mvn -q -DskipTests package'].join(
        '\n',
      ),
      defaultBuildCommand: 'mvn -q -DskipTests package',
      defaultRunCommand: 'java -jar target/app.jar',
      defaultPort: 8080,
      healthcheckPath: '/actuator/health',
      isBuiltIn: true,
      variables: [
        {
          name: 'JAR file',
          envVariable: 'JAR_FILE',
          defaultValue: 'target/*.jar',
          description: 'Path/glob to the built JAR file.',
          rules: 'required|string',
        },
        {
          name: 'JVM options',
          envVariable: 'JAVA_OPTS',
          defaultValue: '-Xmx512m',
          description: 'Extra JVM flags.',
          rules: 'string',
        },
      ],
    },
    {
      name: 'Java 25 (Gradle)',
      description:
        'Builds a Gradle project (via the repo wrapper) into a JAR and runs it on Temurin 25.',
      category: 'Java',
      type: 'BACKEND',
      baseImage: 'eclipse-temurin:25-jre',
      dockerfilePath: 'templates/java-gradle/Dockerfile',
      installImage: 'eclipse-temurin:25-jdk',
      installScript: [
        '#!/bin/bash',
        'set -e',
        './gradlew --no-daemon clean build -x test',
      ].join('\n'),
      defaultBuildCommand: './gradlew --no-daemon clean build -x test',
      defaultRunCommand: 'java -jar app.jar',
      defaultPort: 8080,
      healthcheckPath: '/actuator/health',
      isBuiltIn: true,
      variables: [
        {
          name: 'JVM options',
          envVariable: 'JAVA_OPTS',
          defaultValue: '-Xmx512m',
          description: 'Extra JVM flags.',
          rules: 'string',
        },
      ],
    },
    {
      name: 'Java (Maven WAR → Tomcat)',
      description:
        'Builds a Maven WAR from source and deploys it to Tomcat 9 at the root context.',
      category: 'Java',
      type: 'BACKEND',
      baseImage: 'tomcat:9.0',
      dockerfilePath: 'templates/java-war/Dockerfile',
      installImage: 'maven:3.9-eclipse-temurin-17',
      installScript: ['#!/bin/bash', 'set -e', 'mvn -q -DskipTests package'].join(
        '\n',
      ),
      defaultBuildCommand: 'mvn -q -DskipTests package',
      defaultRunCommand: 'catalina.sh run',
      defaultPort: 8080,
      healthcheckPath: '/',
      isBuiltIn: true,
      variables: [],
    },
    {
      name: 'Next.js 20',
      description:
        'Builds a Next.js app (standalone output) and runs it on Node 20.',
      category: 'JavaScript',
      type: 'FRONTEND',
      baseImage: 'node:20-alpine',
      dockerfilePath: 'templates/nextjs/Dockerfile',
      installImage: 'node:20-alpine',
      installScript: ['#!/bin/sh', 'set -e', 'npm ci', 'npm run build'].join(
        '\n',
      ),
      defaultBuildCommand: 'npm ci && npm run build',
      defaultRunCommand: 'node server.js',
      defaultPort: 3000,
      healthcheckPath: '/',
      isBuiltIn: true,
      variables: [
        {
          name: 'Backend URL',
          envVariable: 'BACKEND_URL',
          defaultValue: '',
          description: 'Public or internal URL of the backend service.',
          rules: 'string',
        },
      ],
    },
    {
      name: 'React (Vite)',
      description:
        'Builds a Vite React SPA and serves the static assets with nginx.',
      category: 'JavaScript',
      type: 'FRONTEND',
      baseImage: 'nginx:1.27-alpine',
      dockerfilePath: 'templates/react-vite/Dockerfile',
      installImage: 'node:20-alpine',
      installScript: ['#!/bin/sh', 'set -e', 'npm ci', 'npm run build'].join(
        '\n',
      ),
      defaultBuildCommand: 'npm ci && npm run build',
      defaultRunCommand: 'nginx -g "daemon off;"',
      defaultPort: 80,
      healthcheckPath: '/',
      isBuiltIn: true,
      variables: [
        {
          name: 'API base URL',
          envVariable: 'VITE_API_URL',
          defaultValue: '',
          description: 'Backend API base URL baked into the build.',
          rules: 'string',
        },
      ],
    },
  ];

  for (const tpl of builtInTemplates) {
    const found = await db
      .select({ id: templates.id, category: templates.category })
      .from(templates)
      .where(eq(templates.name, tpl.name))
      .limit(1);
    if (found.length === 0) {
      await db.insert(templates).values(tpl);
      console.log(`Template created: ${tpl.name}`);
    } else if (!found[0].category && tpl.category) {
      // Backfill the category for templates seeded before categories existed.
      await db
        .update(templates)
        .set({ category: tpl.category })
        .where(eq(templates.id, found[0].id));
      console.log(`Template category set: ${tpl.name} → ${tpl.category}`);
    } else {
      console.log(`Template already exists: ${tpl.name}`);
    }
  }

  console.log('Seeded built-in templates.');
  await seedCatalogApps(db);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
