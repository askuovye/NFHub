# Jarja — emissor universal de NFS-e

Monorepo com a API (`backend/`, Laravel) e o painel (`frontend/`, Vue 3).

- Contexto do produto e regras: [AGENTS.md](AGENTS.md)
- Estrutura e decisões de arquitetura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Requisitos

PHP 8.3+, Composer 2, Node 24 LTS e Docker (para Postgres, Redis, MinIO e Mailpit).

## Rodando localmente

```sh
docker compose up -d

# backend (http://localhost:8000)
cd backend
composer setup        # instala, cria .env, gera chave e migra
php artisan serve
php artisan queue:work   # em Linux/Docker: php artisan horizon

# frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

## Qualidade

| | Backend | Frontend |
|---|---|---|
| Testes | `php artisan test` (suítes Unit, Feature, Contract) | `npm run test:unit` |
| Lint/format | `composer lint` (Pint) | `npm run lint` / `npm run format` |
| Análise estática | `composer analyse` (Larastan) | `npm run type-check` |
