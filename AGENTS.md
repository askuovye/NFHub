# AGENTS.md

Guia para agentes de IA e desenvolvedores que trabalham neste projeto. Leia antes de gerar ou alterar código.

> **Status:** fase de planejamento. A stack do backend (Laravel) ainda pode ser revista. Itens marcados com **[validar]** dependem de dados atuais (prazos, provedores por município, custos) e não devem ser tratados como fato.

---

## 1. Visão geral

Sistema para **emissão automática e universal de NFS-e** (Nota Fiscal de Serviço Eletrônica), que dispensa o acesso manual ao site de cada prefeitura. O usuário emite, consulta e cancela notas em um único lugar, e o sistema decide sozinho por qual caminho a nota é enviada.

- **Público final:** MEIs, empresas do Simples Nacional e de outros regimes (Lucro Presumido e Real), além de contadores que gerenciam várias empresas.
- **Visão de longo prazo:** todas as cidades e estados do Brasil.
- **Foco inicial:** região **Sul** (PR, SC e RS).
- **Diferencial:** abstrair a fragmentação fiscal municipal atrás de uma interface única (UI e API).

## 2. Contexto fiscal (resumo)

Historicamente cada município tinha seu próprio padrão técnico (ABRASF, GISS, IPM, Betha, WebISS, sistemas próprios etc.). Hoje existe o **padrão nacional de NFS-e** (Emissor Nacional / SEFIN Nacional, com API), instituído pela LC 214/2025. A obrigatoriedade para optantes do Simples Nacional está em transição e as datas divergem por município **[validar]**. Na prática, o sistema precisa suportar o padrão nacional e padrões municipais legados ao mesmo tempo.

## 3. Estratégia de emissão: o funil A/B/C

O sistema escolhe a rota por empresa e município:

| Rota | Quando | Esforço |
|---|---|---|
| **A. Nacional** | Município e contribuinte no Emissor Nacional | 1 integração, vale para o Brasil todo |
| **B. Provedor/padrão municipal** | Município com sistema próprio | 1 conector por **padrão**, não por cidade |
| **C. Agregador externo (fallback)** | Município ainda sem conector próprio | Terceirizado, cobrado por nota |

Princípio: integrar **por padrão/provedor**, nunca por prefeitura. Adicionar uma cidade deve ser **cadastro de dados**, não deploy.

## 4. Stack

- **Backend:** Laravel (PHP 8.3+), filas com Redis + Horizon.
- **Front-end:** Vue 3 + Vite + Pinia + TypeScript.
- **Banco:** PostgreSQL (JSONB para variações por município).
- **Storage:** S3 compatível para XML e PDF/DANFSe, com retenção de 5+ anos **[validar prazo com contador]**.
- **Segredos:** certificados A1 criptografados, de preferência em KMS/Vault.
- **Observabilidade:** Sentry, logs estruturados e métricas por driver.
- **Infra:** Docker, com ambientes separados de homologação e produção.

## 5. Arquitetura

```
[Vue SPA / PWA]  ── painel do cliente, contador, admin
        │
[API Laravel]  (auth, tenants, REST + webhooks)
        │
 ┌──────┴────────────────────────────────────────┐
 │ Domínio Fiscal (core)                         │
 │  • Cadastro (empresa, tomador, serviços)      │
 │  • Motor de regras (ISS, retenções, regime)   │
 │  • Roteador de emissão (município → driver)   │
 └──────┬────────────────────────────────────────┘
        │ fila (Redis + Horizon)
 ┌──────┴────────────┬──────────────┬─────────────┐
 │ Driver Nacional   │ Drivers      │ Driver      │
 │ (SEFIN Nacional)  │ municipais   │ Agregador   │
 └──────┬────────────┴──────┬───────┴──────┬──────┘
        │                    │              │
   Assinatura XML (A1)   SOAP/REST       API externa
        │
[Storage: XML, PDF]  [PostgreSQL]  [Logs/Auditoria]
```

### Padrões obrigatórios

- **Adapter/Strategy** para drivers, com interface única: `emitir()`, `consultar()`, `cancelar()`, `substituir()`.
- **Idempotência** por chave de emissão (evita nota duplicada em retry).
- **Máquina de estados** da nota: `rascunho → validada → enfileirada → enviada → autorizada | rejeitada → cancelada`.
- **Outbox pattern** para webhooks e notificações.
- **Emissão sempre assíncrona** (fila, retry com backoff).
- **Erros normalizados:** o erro bruto do município é traduzido para uma mensagem padronizada, mantendo o original em log.
- **Regras como dados:** alíquotas, retenções e campos obrigatórios por município ficam em tabela, não em código.

## 6. Modelo de dados (núcleo)

- `tenants` (conta do contador ou da empresa)
- `empresas` (CNPJ, regime MEI/Simples/Presumido/Real, IM, município, certificado)
- `certificados` (arquivo criptografado, validade, alertas de vencimento)
- `tomadores` (CPF/CNPJ, endereço, exterior)
- `servicos` (código LC 116, CNAE, código de tributação nacional/municipal, alíquota padrão)
- `municipios` (IBGE, UF, `driver`, `padrao`, `ambiente`, flag "migrou para o Nacional", data da migração)
- `municipio_regras` (alíquotas, retenções, regras especiais, campos extras)
- `notas` (status, chave, número, XML, PDF, protocolo, erro normalizado)
- `notas_eventos` (histórico: envio, retorno, cancelamento, tentativas)
- `webhooks` e `api_keys`

## 7. Processos principais

**Onboarding da empresa**
1. Cadastro do CNPJ (pré-preenchimento por dados públicos).
2. Upload do certificado A1 (valida senha e validade).
3. Detecção de município e regime, com definição da rota A/B/C.
4. Teste em homologação antes de liberar produção.
5. Orientação sobre habilitação/credenciamento no município, quando exigido.

**Emissão**
1. Usuário ou ERP (via API) envia dados do serviço e do tomador.
2. Validação local (campos, CNAE × código de serviço, alíquota).
3. O motor calcula ISS, retenções e tributos.
4. O roteador escolhe o driver, monta o XML/JSON do padrão e assina.
5. Envio assíncrono, com retorno por polling ou callback.
6. Autorizada: guarda XML/PDF e notifica por webhook/e-mail.
7. Rejeitada: traduz o erro e sugere correção.

**Cancelamento e substituição:** regras variam por município (prazo, justificativa, aprovação) e ficam em `municipio_regras`.

**Notas tomadas:** integração com o repositório nacional para conciliação automática.

**Monitoramento contínuo:** alertas de certificados a vencer, mudanças de status de município e falhas recorrentes por driver.

## 8. Fases

- **Fase 0, Descoberta:** levantar municípios do PR/SC/RS e o padrão de cada um **[validar]**, obter acesso à homologação do Emissor Nacional e escolher o agregador de fallback.
- **Fase 1, MVP:** driver Nacional, cadastros, certificado A1, emissão, cancelamento, PDF, painel Vue, API REST, fallback por agregador e piloto com clientes reais (de preferência contadores). Começar por Simples/MEI.
- **Fase 2, Cobertura do Sul:** drivers dos provedores mais usados nas cidades-alvo, motor de regras por município, tradução de erros, webhooks, notas tomadas e relatórios.
- **Fase 3, Escala nacional:** novos drivers guiados por demanda, painel de saúde por município, multi-tenant robusto, planos e cobrança, e preparação para IBS/CBS (Reforma Tributária).

## 9. Modelo de negócio (hipótese)

Assinatura mensal por CNPJ com franquia de notas e excedente por nota. Planos distintos para MEI e para contadores (multi-empresa). O certificado A1 é custo do cliente. As rotas A e B têm margem melhor que a C. Custos de emissão no Emissor Nacional e em prefeituras devem ser conferidos na documentação oficial **[validar]**.

## 10. Regras para agentes

**Segurança e dados sensíveis**
- Nunca commitar certificados, senhas, tokens ou `.env`. Use variáveis de ambiente e gerenciador de segredos.
- Certificados A1 e suas senhas devem ser sempre criptografados em repouso e nunca aparecer em logs.
- Dados de CPF/CNPJ e notas seguem a LGPD: mínimo necessário, log de acesso e política de retenção.
- Não usar dados reais de clientes em testes ou fixtures.

**Código**
- Todo conector novo implementa a interface de driver e **não** vaza peculiaridades do município para o domínio.
- Não codificar regras municipais (alíquotas, prazos) no código. Vão para dados.
- Toda emissão deve ser idempotente e auditável (registrar evento em `notas_eventos`).
- Cada driver precisa de testes de contrato com XMLs de exemplo e ambiente de **homologação** antes de produção.
- Mudanças em lógica tributária exigem revisão humana, idealmente de um contador.
- Preferir migrations versionadas e mudanças retrocompatíveis.

**Postura diante de incerteza**
- Se uma regra fiscal, prazo ou padrão de município não estiver documentado aqui ou na fonte oficial, **não assuma**: sinalize e peça validação.
- Prefira a documentação oficial (gov.br/nfse e portais das prefeituras) a artigos de terceiros.

## 11. Riscos principais

1. **Mudança de regras fiscais** (prazos divergentes, Reforma Tributária). Mitigação: regras como dados e testes de contrato.
2. **Guarda de certificado do cliente.** Mitigação: criptografia, auditoria e LGPD.
3. **Responsabilidade fiscal** por erro de cálculo. Mitigação: validação com contador e termos de uso claros.
4. **Instabilidade de webservices municipais.** Mitigação: filas, retry, status page e alertas.
5. **Escopo excessivo** (todas as cidades no dia 1). Mitigação: funil A/B/C e priorização por dados.

## 12. Pontos em aberto

- Confirmar a stack final do backend (Laravel é a escolha atual).
- Definir o agregador de fallback e o custo por nota.
- Mapear os provedores usados em cada município do Sul.
- Definir o escopo tributário do MVP com um contador (começar por Simples/MEI).
- Decidir política de retenção de XML/PDF e de certificados.

## 13. Comandos e convenções do repositório

- **Estrutura de pastas e decisões de arquitetura:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Leia antes de criar arquivos novos.
- **Setup local:** ver [README.md](README.md) (`docker compose up -d`, `composer setup`, `npm install`).
- **Backend (`backend/`):** `php artisan test`, `composer lint` (Pint), `composer analyse` (Larastan).
- **Frontend (`frontend/`):** `npm run test:unit`, `npm run lint`, `npm run type-check`.
- **Padrão de commits:** _a definir._
