<div align="center">

<img src="docs/banner.png" alt="Self-Hosted PaaS" width="100%" />

# Self-Hosted PaaS

**Deploy apps from Git to Docker on your own servers — a modern, self-hosted alternative to Heroku/Vercel.**

[![CI](https://github.com/KROWIEL/self-hosted-public/actions/workflows/ci.yml/badge.svg)](https://github.com/KROWIEL/self-hosted-public/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Made with NestJS](https://img.shields.io/badge/API-NestJS-e0234e.svg)](https://nestjs.com)
[![Made with Next.js](https://img.shields.io/badge/UI-Next.js%2014-black.svg)](https://nextjs.org)
[![Agent in Go](https://img.shields.io/badge/agent-Go-00add8.svg)](https://go.dev)
[![Docker](https://img.shields.io/badge/runtime-Docker-2496ed.svg)](https://www.docker.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**🌐 Language:** [English](#english) · [Русский](#русский)

</div>

---

## English

> Open-core, self-hosted platform to deploy backends and frontends straight from Git into Docker — with managed databases, HTTPS, multi-tenant projects, RBAC, 2FA, live logs & metrics, backups, and reverse tunnels for home-lab / NAT nodes.

### ✨ Features

- **Git-to-Docker deploys** — build & run services from a repo with isolated build steps and one-click redeploys.
- **Stack templates** — curated, editable templates (Java, Node/Next.js, …) grouped by category; create your own.
- **Managed databases** — provision Postgres/MySQL per project, with scheduled backups & restore.
- **Zero-downtime releases** — blue-green deploys with health-gating.
- **Multi-tenant projects + quotas** — CPU/RAM limits per project.
- **RBAC** — `OWNER / ADMIN / MEMBER / VIEWER` roles, plus an append-only audit log.
- **Accounts & security** — two-stage registration, TOTP 2FA, strict password policy, soft-forced rotation of weak passwords.
- **Nodes** — run the Go agent on any server; local dev agent, remote self-enrollment with TLS pinning & heartbeats.
- **Reverse tunnels** — expose NAT / home-lab nodes to the internet through a lightweight public relay *(Home-Lab / Pro module)*.
- **Live logs, metrics & web exec** — real-time container logs, resource usage, and an in-browser terminal.
- **Automatic HTTPS** — Traefik + Let's Encrypt (HTTP-01 or DNS-01 wildcard).
- **Localized UI** — English & Russian out of the box.

### 📸 Screenshots

|  |  |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Service](docs/screenshots/service.png) |
| ![Deploy & logs](docs/screenshots/deploy.png) | ![Reverse tunnels](docs/screenshots/tunnels.png) |
| ![Templates](docs/screenshots/templates.png) | ![Billing & plans](docs/screenshots/billing.png) |

> Live demo & walkthrough GIF coming soon.

### 🚀 Quick start

**Prerequisites:** Docker + Docker Compose, Node.js ≥ 20, and (for building agents) Go ≥ 1.24.

```bash
git clone https://github.com/KROWIEL/self-hosted-public.git
cd self-hosted-public
cp .env.example .env          # then edit secrets (see below)
npm install
```

Generate real secrets before first run:

```bash
# 32-byte base64 key for AES-256-GCM (secrets at rest)
openssl rand -base64 32       # -> ENCRYPTION_KEY
openssl rand -base64 48       # -> JWT_SECRET / JWT_REFRESH_SECRET
```

Boot the stack (Windows PowerShell):

```powershell
./start.ps1
```

…or manually:

```bash
docker compose up -d postgres redis   # infra
npm run db:push                        # apply schema
npm run db:seed                        # seed the first admin
npm run dev:cp                         # control-plane API  -> :3001
npm run dev:web                        # web UI            -> :3000
```

Open **http://localhost:3000** and sign in with the seeded admin.

### 🧩 Tiers

Open-core: the free tier is unlimited. Paid tiers unlock add-on modules via a signed license key (activate under **Billing → License key**).

| Tier | Price* | Unlocks |
|------|--------|---------|
| **Free** | $0 | Full core: deploys, templates, HTTPS, managed DBs, projects, RBAC, 2FA, unlimited nodes |
| **Home-Lab** | ~$3/mo | Everything in Free **+ Reverse-tunnels** (NAT / home-lab) |
| **Pro** | ~$15/mo | Everything + all modules (preview-envs, off-site backups, alerts, metrics history, SSO, API/CLI, white-label) |

<sub>*Suggested pricing. See [`docs/LICENSING.md`](docs/LICENSING.md).</sub>

### 🏗️ Architecture

- **`apps/control-plane`** — NestJS API (auth, RBAC, deploy orchestration, licensing, audit).
- **`apps/web`** — Next.js 14 dashboard (localized).
- **`services/agent`** — Go daemon per node (builds, runs containers, health, logs, tunnels).
- **`packages/shared`** — shared TypeScript contracts.
- **Infra** — PostgreSQL, Redis (BullMQ), Traefik via `docker-compose.yml`.

### 🔐 Security

- Secrets (PATs, env secrets, tokens) encrypted at rest (AES-256-GCM).
- JWT sessions, TOTP 2FA, strict password policy.
- Per-project RBAC + append-only audit log.
- TLS pinning for remote agents.

Never commit your `.env` or private keys — see the bundled `gitleaks` pre-commit hook (`git config core.hooksPath .githooks`).

### 🤝 Contributing

Issues and PRs are welcome. By contributing you agree your changes are licensed under AGPL-3.0.

### 📄 License

[GNU AGPL-3.0](LICENSE). A separate commercial license key unlocks paid modules — see [`docs/LICENSING.md`](docs/LICENSING.md).

---

## Русский

> Open-core платформа для self-hosting: деплой бэкендов и фронтендов прямо из Git в Docker — с managed-базами, HTTPS, мульти-тенант проектами, RBAC, 2FA, live-логами и метриками, бэкапами и обратными туннелями для home-lab / NAT-нод.

### ✨ Возможности

- **Деплой Git → Docker** — сборка и запуск сервисов из репозитория с изолированным шагом сборки и редеплоем в один клик.
- **Шаблоны стеков** — готовые редактируемые шаблоны (Java, Node/Next.js, …) по категориям; можно создавать свои.
- **Managed-базы** — Postgres/MySQL на проект, с бэкапами по расписанию и восстановлением.
- **Zero-downtime релизы** — blue-green деплой с проверкой health.
- **Мульти-тенант проекты + квоты** — лимиты CPU/RAM на проект.
- **RBAC** — роли `OWNER / ADMIN / MEMBER / VIEWER` и append-only аудит-лог.
- **Аккаунты и безопасность** — двухэтапная регистрация, TOTP 2FA, строгая парольная политика, мягкое принуждение к смене слабых паролей.
- **Ноды** — Go-агент на любом сервере; локальный dev-агент и удалённое самоподключение с TLS-пиннингом и heartbeat.
- **Обратные туннели** — публикация NAT / home-lab нод в интернет через лёгкий публичный релей *(модуль Home-Lab / Pro)*.
- **Live-логи, метрики и web-exec** — логи контейнеров в реальном времени, потребление ресурсов и терминал в браузере.
- **Автоматический HTTPS** — Traefik + Let's Encrypt (HTTP-01 или DNS-01 wildcard).
- **Локализация** — английский и русский «из коробки».

### 📸 Скриншоты

|  |  |
|---|---|
| ![Дашборд](docs/screenshots/dashboard.png) | ![Сервис](docs/screenshots/service.png) |
| ![Деплой и логи](docs/screenshots/deploy.png) | ![Обратные туннели](docs/screenshots/tunnels.png) |
| ![Шаблоны](docs/screenshots/templates.png) | ![Тарифы](docs/screenshots/billing.png) |

> Живое демо и GIF-обзор — скоро.

### 🚀 Быстрый старт

**Требования:** Docker + Docker Compose, Node.js ≥ 20 и (для сборки агентов) Go ≥ 1.24.

```bash
git clone https://github.com/KROWIEL/self-hosted-public.git
cd self-hosted-public
cp .env.example .env          # затем впишите секреты (см. ниже)
npm install
```

Сгенерируйте реальные секреты перед первым запуском:

```bash
openssl rand -base64 32       # -> ENCRYPTION_KEY (32 байта)
openssl rand -base64 48       # -> JWT_SECRET / JWT_REFRESH_SECRET
```

Запуск (Windows PowerShell):

```powershell
./start.ps1
```

…или вручную:

```bash
docker compose up -d postgres redis   # инфраструктура
npm run db:push                        # схема БД
npm run db:seed                        # первый администратор
npm run dev:cp                         # API control-plane  -> :3001
npm run dev:web                        # веб-интерфейс       -> :3000
```

Откройте **http://localhost:3000** и войдите под созданным админом.

### 🧩 Тарифы

Open-core: бесплатный тариф без ограничений. Платные тарифы открывают модули по подписанному ключу лицензии (активация в **Тарифы → Ключ лицензии**).

| Тариф | Цена* | Что открывает |
|-------|-------|---------------|
| **Free** | $0 | Полное ядро: деплой, шаблоны, HTTPS, managed-БД, проекты, RBAC, 2FA, неограниченные ноды |
| **Home-Lab** | ~$3/мес | Всё из Free **+ Reverse-tunnels** (NAT / home-lab) |
| **Pro** | ~$15/мес | Всё + все модули (preview-env, офсайт-бэкапы, алерты, история метрик, SSO, API/CLI, white-label) |

<sub>*Рекомендованные цены. См. [`docs/LICENSING.md`](docs/LICENSING.md).</sub>

### 🏗️ Архитектура

- **`apps/control-plane`** — API на NestJS (auth, RBAC, оркестрация деплоя, лицензирование, аудит).
- **`apps/web`** — дашборд на Next.js 14 (локализованный).
- **`services/agent`** — Go-демон на каждой ноде (сборка, запуск контейнеров, health, логи, туннели).
- **`packages/shared`** — общие TypeScript-контракты.
- **Инфраструктура** — PostgreSQL, Redis (BullMQ), Traefik через `docker-compose.yml`.

### 🔐 Безопасность

- Секреты (PAT, env-секреты, токены) шифруются at rest (AES-256-GCM).
- JWT-сессии, TOTP 2FA, строгая парольная политика.
- RBAC на проект + append-only аудит-лог.
- TLS-пиннинг для удалённых агентов.

Никогда не коммитьте `.env` и приватные ключи — используйте встроенный `gitleaks` pre-commit хук (`git config core.hooksPath .githooks`).

### 🤝 Вклад

Issues и PR приветствуются. Внося вклад, вы соглашаетесь лицензировать изменения под AGPL-3.0.

### 📄 Лицензия

[GNU AGPL-3.0](LICENSE). Отдельный коммерческий ключ лицензии открывает платные модули — см. [`docs/LICENSING.md`](docs/LICENSING.md).
