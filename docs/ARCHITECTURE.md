# Arquitetura e decisões estruturais

Registro das decisões de estrutura tomadas na criação do repositório (2026-10-22). Complementa o [AGENTS.md](../AGENTS.md), que continua sendo a fonte do contexto de negócio e fiscal. Quando uma decisão mudar, atualize a seção correspondente e registre a data.

---

## 1. Layout do repositório (monorepo)

```
jarja/
├── AGENTS.md            # contexto do produto e regras para agentes
├── docs/                # arquitetura, decisões, guias
├── docker-compose.yml   # serviços de apoio locais (Postgres, Redis, MinIO, Mailpit)
├── backend/             # API Laravel (PHP)
└── frontend/            # SPA Vue 3 (TypeScript)
```

**Decisão:** um único repositório com duas aplicações independentes, cada uma com seu próprio gerenciador de dependências, `.gitignore`, lint e testes.

**Por quê:** o time é pequeno e back e front evoluem juntos (o contrato da API muda nas duas pontas no mesmo PR). Separar em repositórios seria custo sem benefício nesta fase. Como as apps não compartilham código, dá para dividir depois sem refatoração.

## 2. Versões instaladas

| Item | Versão | Observação |
|---|---|---|
| PHP | 8.4 (NTS) | AGENTS.md pede 8.3+. Instalado via winget no Windows. |
| Composer | 2.10 | Em `%USERPROFILE%\bin`. |
| Laravel | 13.x | |
| Node.js | 24 LTS | |
| Vue | 3.5 | com Vite 8, Pinia 4, Vue Router 5, TypeScript 6 |
| PostgreSQL | 17 | via Docker |
| Redis | 7 | via Docker |

---

## 3. Backend (`backend/`)

### 3.1 API-only

O Laravel serve **apenas API** (`routes/api.php`, prefixo `/api`). Foram removidos do skeleton o Vite, o Tailwind e `resources/css|js`, porque a interface vive em `frontend/`. `resources/views` ficou para templates de e-mail e do PDF/DANFSe.

Os arquivos `AGENTS.md`/`CLAUDE.md` gerados pelo skeleton (guias genéricos do Laravel Boost) foram removidos para não concorrer com o `AGENTS.md` da raiz.

### 3.2 Pacotes

| Pacote | Para quê |
|---|---|
| `laravel/sanctum` (via `install:api`) | Auth da SPA (cookie) e tokens de API para ERPs |
| `laravel/horizon` | Painel e supervisão das filas Redis |
| `predis/predis` | Cliente Redis em PHP puro (não depende da extensão `phpredis`, que é chata no Windows) |
| `league/flysystem-aws-s3-v3` | Disco S3 para XML/PDF (MinIO em dev) |
| `sentry/sentry-laravel` | Erros e tracing |
| `larastan/larastan` (dev) | Análise estática, nível 6 (`phpstan.neon`) |
| `laravel/pint` (dev, já no skeleton) | Formatação PSR-12/Laravel |

**Observação sobre Horizon no Windows:** o Horizon exige as extensões `pcntl` e `posix`, que só existem em Linux. O `composer.json` declara essas extensões em `config.platform` para que o Composer resolva as dependências no Windows. **O Horizon só roda em Linux/Docker**; em dev no Windows use `php artisan queue:work`.

### 3.3 Organização do código: Domínio + Infraestrutura

Mantivemos a estrutura padrão do Laravel (`app/Http`, `app/Models`, `app/Providers`, `app/Jobs`...) e acrescentamos duas camadas:

```
app/
├── Domain/                  # regras de negócio, sem saber de SOAP, XML de prefeitura ou SDK
│   ├── Tenancy/             # tenants (contador ou empresa)
│   ├── Empresas/            # empresa, regime (enum), IM, município
│   ├── Certificados/        # certificado A1: metadados, validade, alertas
│   │   └── Contracts/       # interface do cofre de segredos (implementada em Infrastructure/Secrets)
│   ├── Cadastros/           # tomadores e serviços (LC 116, CNAE)
│   ├── Municipios/          # municípios e municipio_regras (regras como dados)
│   ├── Tributacao/          # motor de regras: ISS, retenções, regime
│   ├── Notas/               # nota, eventos, máquina de estados, eventos de domínio
│   │   ├── Enums/           # NotaStatus
│   │   └── States/          # transições permitidas
│   ├── Emissao/             # contrato do driver, roteador A/B/C, erros normalizados
│   │   ├── Contracts/       # EmissorDriver: emitir(), consultar(), cancelar(), substituir()
│   │   ├── Data/            # DTOs de entrada/saída do driver (independentes de padrão)
│   │   ├── Routing/         # município + empresa → driver
│   │   └── Errors/          # tradução do erro bruto para erro padronizado
│   └── Webhooks/            # outbox e entregas
├── Infrastructure/          # detalhes técnicos e integrações externas
│   ├── Drivers/
│   │   ├── Nacional/        # Rota A: SEFIN / Emissor Nacional
│   │   ├── Municipais/      # Rota B: um subdiretório por PADRÃO (Abrasf/, ...), nunca por cidade
│   │   └── Agregador/       # Rota C: fallback terceirizado
│   ├── Xml/Signing          # assinatura XMLDSig com A1
│   ├── Xml/Schemas          # XSDs oficiais por padrão/versão
│   ├── Secrets/             # KMS/Vault/criptografia dos certificados
│   ├── Storage/             # gravação de XML/PDF com retenção
│   └── Pdf/                 # geração do DANFSe
├── Http/
│   ├── Controllers/Api/V1/
│   ├── Requests/Api/V1/     # validação (FormRequest)
│   └── Resources/Api/V1/    # serialização (JsonResource)
├── Jobs/
│   ├── Emissao/             # emissão assíncrona, retry com backoff
│   └── Webhooks/            # despacho do outbox
└── Policies/                # autorização por tenant
```

**Decisões:**

- **Organizar por contexto de negócio, não por tipo técnico.** Cada pasta de `Domain/` agrupa models, actions, enums e DTOs do mesmo assunto. Em Laravel puro, `app/Models` com 30 arquivos misturados vira um problema rápido.
- **`Domain/` não depende de `Infrastructure/`.** O domínio declara interfaces (`Contracts/`); a infraestrutura implementa; o binding acontece num ServiceProvider. É isso que garante a regra do AGENTS.md de que um driver "não vaza peculiaridades do município para o domínio".
- **Drivers por padrão/provedor.** `Municipais/Abrasf` atende todas as cidades ABRASF. Uma cidade nova é linha em `municipios`/`municipio_regras`, não pasta nova.
- **Actions** (classes de caso de uso com um método `handle`/`__invoke`) em vez de services gigantes. Controllers e Jobs ficam finos e só chamam actions.
- **API versionada em `V1`** desde o início, porque ERPs de clientes vão integrar e não podemos quebrá-los.
- **Models do Eloquent ficam dentro do contexto** (`Domain/Notas/Models/Nota.php`). O `app/Models/User.php` do skeleton fica onde está por enquanto (auth).

### 3.4 Testes

```
tests/
├── Unit/Domain/        # regras puras (cálculo, máquina de estados)
├── Feature/Api/V1/     # endpoints HTTP
├── Contract/Drivers/   # testes de contrato de cada driver (suíte "Contract" no phpunit.xml)
└── Fixtures/xml/       # XMLs de exemplo por padrão (nacional/, abrasf/) — nunca dados reais
```

A suíte `Contract` é separada para poder rodar isolada (`php artisan test --testsuite=Contract`) e, no futuro, contra a homologação.

### 3.5 Configuração (`.env.example`)

- `DB_CONNECTION=pgsql` (JSONB para regras por município).
- `QUEUE_CONNECTION=redis`, `CACHE_STORE=redis`, `REDIS_CLIENT=predis`.
- Disco S3 apontando para o MinIO local (`AWS_ENDPOINT`, `AWS_USE_PATH_STYLE_ENDPOINT=true`).
- `APP_LOCALE=pt_BR`.
- `FRONTEND_URL` e `SANCTUM_STATEFUL_DOMAINS` para a SPA.
- Os testes usam SQLite em memória (`phpunit.xml`), então rodam sem Docker. Testes que dependam de JSONB/Postgres vão precisar de um banco real; quando aparecerem, criar uma suíte ou grupo específico.

---

## 4. Frontend (`frontend/`)

Criado com `create-vue` (TypeScript, Vue Router, Pinia, Vitest, ESLint + Prettier + Oxlint).

### 4.1 Organização: por módulo (feature)

```
src/
├── main.ts / App.vue
├── router/              # rotas raiz; cada módulo pode exportar as suas
├── stores/              # stores globais (sessão, tenant atual)
├── services/http/       # client.ts: instância axios única (baseURL, cookies, XSRF)
├── components/
│   ├── ui/              # componentes visuais genéricos (botão, input, tabela)
│   └── layout/          # header, sidebar
├── layouts/             # layouts de página (autenticado, público)
├── composables/         # lógica reutilizável (useX)
├── types/               # tipos compartilhados (DTOs da API)
├── utils/               # formatação de CNPJ/CPF, moeda, datas
├── assets/styles/
├── views/               # ORIGEM DAS PÁGINAS: todo componente ligado a uma rota mora aqui
│   ├── auth/            # login, recuperação de senha
│   ├── empresas/        # cadastro e onboarding
│   ├── certificados/    # upload e validade do A1
│   ├── tomadores/
│   ├── servicos/
│   ├── notas/           # emissão, consulta, cancelamento
│   ├── contador/        # visão multiempresa
│   └── admin/           # municípios, drivers, saúde
└── modules/             # lógica e componentes de cada feature (mesmos nomes de views/)
    ├── auth/
    ├── empresas/
    ├── ...
    └── admin/
```

**Views (páginas):** `src/views/` é a origem de todas as páginas. Só componentes referenciados pelo router ficam aqui, organizados em subpastas com o mesmo nome do módulo e nomeados com sufixo `View` (ex.: `views/notas/NotaListView.vue`, `views/notas/NotaEmitirView.vue`). As rotas importam sempre de `@/views/...`, com lazy loading (`component: () => import('@/views/notas/NotaListView.vue')`).

As views são finas: montam a página com layout e componentes, leem o estado das stores e disparam ações. Regras, chamadas à API e componentes específicos da feature ficam em `src/modules/<feature>/`, que tem `components/` (só daquele módulo), `stores/` (Pinia) e `api/` (funções que chamam `http`).

**Decisões:**

- **Páginas centralizadas em `src/views/`.** Fica num só lugar o mapa de telas do sistema, que espelha o router. Também é a convenção padrão do Vue/create-vue, o que facilita a vida de quem chega ao projeto.
- **Lógica por módulo, espelhando os contextos do backend.** Quem mexe em "notas" encontra a página em `views/notas` e a lógica em `modules/notas`, e no backend em `Domain/Notas`.
- **Dependência num só sentido:** `views` → `modules` → `services`/`components/ui`. Um módulo nunca importa de `views/`.
- **Um único cliente HTTP** (`services/http/client.ts`). Os módulos não criam instâncias do axios, para que auth, CSRF e tratamento de erro fiquem centralizados.
- **Auth da SPA por cookie (Sanctum stateful)**, por isso `withCredentials` e `withXSRFToken`. Token Bearer fica para a API pública de ERPs.
- **Proxy do Vite** (`/api` e `/sanctum` → `localhost:8000`) para que, em dev, front e API estejam na mesma origem e não haja dor de CORS/cookies.
- **Biblioteca de componentes/CSS ainda não escolhida** (ver pendências).

---

## 5. Ambiente local

`docker-compose.yml` na raiz sobe só os serviços de apoio:

| Serviço | Porta | Uso |
|---|---|---|
| postgres | 5432 | banco (`jarja`/`jarja`) |
| redis | 6379 | filas e cache |
| minio | 9000 (API), 9001 (console) | S3 local |
| mailpit | 1025 (SMTP), 8025 (UI) | captura de e-mails |

Backend e frontend rodam no host (`php artisan serve` / `npm run dev`). Containerizar as próprias apps fica para quando houver pipeline de deploy.

**Docker ainda não está instalado nesta máquina** (exige Docker Desktop + WSL2 e permissões de administrador).

---

## 6. Segurança aplicada desde já

- `.gitignore` da raiz bloqueia `.env*` (exceto `.env.example`), `*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.crt`, para evitar commit acidental de certificado A1.
- Certificados terão interface própria (`Domain/Certificados/Contracts`) com implementação em `Infrastructure/Secrets`, para trocar criptografia local por KMS/Vault sem tocar no domínio.

---

## 7. Pendências e próximas decisões

- [ ] Instalar Docker Desktop e validar o `docker-compose.yml`.
- [ ] Escolher biblioteca de UI/CSS para o front (ex.: Tailwind, PrimeVue, Vuetify).
- [ ] Escolher a biblioteca de assinatura XMLDSig em PHP (avaliar `robrichards/xmlseclibs` ou similar) **[validar]** com os requisitos do Emissor Nacional.
- [ ] Definir a estratégia de multi-tenancy (coluna `tenant_id` + global scope vs. schema por tenant). Recomendação inicial: `tenant_id` + global scope.
- [ ] Definir o padrão de commits e o CI (lint, PHPStan, testes nas duas apps).
- [ ] Gerar tipos TypeScript a partir da API (OpenAPI) para evitar divergência entre back e front.
- [ ] Containerizar backend/frontend para homologação e produção.
