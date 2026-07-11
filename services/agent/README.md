# Agent

Go-демон, устанавливается на каждый сервер (нода): управляет
Docker-контейнерами, собирает приложения из git, стримит логи.

## Запуск (dev)

```bash
cp .env.example .env   # заполнить AGENT_DAEMON_TOKEN из панели
go run ./cmd/agent
```

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `AGENT_PORT` | `8443` | порт HTTP API |
| `AGENT_DAEMON_TOKEN` | — | bearer-токен (из панели, `daemonTokenPlaintext`) |
| `AGENT_WORKDIR` | `/tmp/agent-builds` | куда клонируются репозитории при сборке |
| `AGENT_NETWORK` | `bridge` | Docker-сеть для контейнеров сервисов |
| `AGENT_TEMPLATES_DIR` | `/opt/agent/templates` | корень Dockerfile-шаблонов |

## API

| Метод | Путь | Назначение | Статус |
|---|---|---|---|
| GET | `/api/system` | ресурсы/версия | заглушка |
| POST | `/api/servers/{id}/build` | clone + docker build (стрим лога + финальная JSON-строка) | готово |
| POST | `/api/servers/{id}/run` | docker run (JSON: `{ok, containerId}`) | готово |
| POST | `/api/servers/{id}/power` | start/stop/restart/kill | готово |
| DELETE | `/api/servers/{id}` | удалить контейнер | готово |
| GET | `/api/servers/{id}/logs` | стрим логов контейнера | готово |
| WS | `/api/servers/{id}/ws` | консоль + метрики (Фаза 4) | TODO |

Все запросы требуют `Authorization: Bearer <AGENT_DAEMON_TOKEN>`.
Позже bearer-токен заменяется на короткоживущий JWT, подписанный панелью.

## Реализация

- `internal/docker` — `Client` поверх `docker` CLI: `BuildImage`, `RunContainer`
  (возвращает id), `Power`, `Remove`, `Logs`.
- `internal/builder` — пайплайн `clone (depth 1) → docker build`. Если в репозитории
  есть свой `Dockerfile`, используется он; иначе — шаблон из `AGENT_TEMPLATES_DIR`.
  Стримит build-лог, возвращает commit SHA.
- `/run` навешивает Traefik-метки, когда к сервису привязан домен (роутер `svc-<id>`).
- PAT передаётся в теле `/build` только на время сборки (вшивается в clone URL,
  рабочая директория удаляется в `defer`) и не сохраняется на ноде.
