# Sistema Classul — Gestão de Pedidos

Sistema de pedidos com quadro Kanban, mensagens automáticas de WhatsApp (Evolution API) e extensão de browser integrada ao WhatsApp Web.

## Como funciona

```
WhatsApp Web ──(extensão)──▶ Sistema Classul (Kanban) ──(Evolution API)──▶ WhatsApp do cliente
```

1. Você atende o cliente no WhatsApp Web e clica no botão da **extensão** → preenche os dados → o pedido é criado na coluna **Novo Pedido** do Kanban, com número sequencial (#0001, #0002…).
2. No **sistema web**, você arrasta o card entre as colunas: `Novo Pedido → Em Produção → Pronto → Enviado/Entregue`.
3. Ao chegar em **Pronto** e em **Enviado/Entregue**, o cliente recebe automaticamente uma mensagem no WhatsApp (modelos editáveis em Configurações). Cada mensagem é enviada só uma vez por etapa (dá para reenviar manualmente abrindo o pedido).

## Estrutura das pastas

| Pasta | O que é |
|---|---|
| `api/` + `lib/` | API serverless para deploy na **Vercel** (Postgres) |
| `web/` | Sistema web com o Kanban (React) |
| `extension/` | Extensão Chrome para o WhatsApp Web |
| `server/` | Versão da API para rodar local ou em VPS/Docker (SQLite) |
| `projeto-extensao/` | Seu projeto original (referência, não é mais usado) |

## Rodando localmente (para testar)

Requisitos: Node.js 20+

```bash
# 1. Backend
cd server
npm install
# edite o .env (já criado) — principalmente API_TOKEN, que é a senha de acesso
npm run dev          # roda em http://localhost:3001

# 2. Frontend (em outro terminal)
cd web
npm install
npm run dev          # abre em http://localhost:5173
```

Entre com a senha definida em `API_TOKEN` no `server/.env`.

## Deploy na Vercel (recomendado)

O projeto já está preparado: `vercel.json` + `api/index.js` (funções serverless) + build do `web/`. O banco é **Postgres no Supabase** (já criado, com tabelas e configurações da Evolution gravadas — a connection string está no arquivo `.env` local, que não vai para o git).

**Passo a passo:**

1. **Suba para o GitHub** — crie um repositório (ex: `classul`) e rode na pasta do projeto:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/classul.git
   git push -u origin main
   ```
   (o repositório git local já está criado e com commit feito)

2. **Importe na Vercel** — [vercel.com/new](https://vercel.com/new) → **Import** no repositório. Não mude nada nas configurações de build (a Vercel lê o `vercel.json`). Pode clicar em **Deploy** — o primeiro deploy sobe sem banco mesmo.

3. **Configure as variáveis** — **Settings → Environment Variables**, adicione:
   | Nome | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Supabase (está no `.env` local) |
   | `API_TOKEN` | uma senha forte da sua escolha (é a senha de login do sistema) |

   As configurações da Evolution API (URL, chave, instância) já estão gravadas no banco e podem ser alteradas na tela Configurações do sistema.

4. **Redeploy** — aba **Deployments** → menu `⋯` do último deploy → **Redeploy** (para aplicar as variáveis).

5. Pronto: o sistema fica em `https://seu-projeto.vercel.app`. Use essa URL + o `API_TOKEN` no login do sistema e nas Opções da extensão.

Para testar a API localmente sem banco externo: `npm install && node smoke-test.mjs`.

## Deploy alternativo (VPS/Docker)

O sistema também roda como um único container Docker (frontend + backend + SQLite). Funciona em qualquer VPS, Railway, Render, EasyPanel etc.

### Opção A — VPS com Docker

```bash
# na pasta do projeto, no servidor:
API_TOKEN=sua-senha-forte docker compose up -d --build
```

O sistema fica em `http://SEU-SERVIDOR:3001`. Depois aponte um domínio/HTTPS (ex: `pedidos.classul.com.br`) usando o proxy que você já usa (Traefik/Nginx/EasyPanel). **HTTPS é necessário para a extensão funcionar.**

### Opção B — Railway / Render

1. Suba esta pasta para um repositório GitHub.
2. Crie o serviço apontando para o repositório (ele detecta o `Dockerfile`).
3. Defina as variáveis de ambiente: `API_TOKEN` (obrigatória), e opcionalmente `EVOLUTION_URL`, `EVOLUTION_APIKEY`, `EVOLUTION_INSTANCE`.
4. Adicione um volume/disco persistente montado em `/app/data` (senão os pedidos somem a cada deploy).

## Evolution API — o que você precisa

A Evolution API é um servidor que controla um WhatsApp conectado (como o WhatsApp Web faz) e expõe uma API para enviar mensagens. Para o sistema enviar as mensagens automáticas, são necessárias **3 informações**, preenchidas na tela **Configurações** do sistema:

1. **URL do servidor** — no seu caso: `https://evolution.scalemidia.com.br`
2. **API Key** — a chave de acesso (global ou da instância)
3. **Nome da instância** — o nome da instância conectada ao número da Classul. No painel (manager) da Evolution você vê a lista de instâncias; no sistema há um botão **"Listar instâncias disponíveis"** que busca os nomes automaticamente.

⚠️ Importante: a instância precisa estar com status **conectado** (QR code escaneado com o número que vai enviar as mensagens). Use a tela de Configurações → **Enviar teste** para validar tudo antes de usar no dia a dia.

## Extensão do Chrome

```bash
cd extension
npm install
npm run build        # gera a pasta extension/dist
```

1. Abra `chrome://extensions`, ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `extension/dist`.
3. Clique com o botão direito no ícone da extensão → **Opções** → informe a **URL do sistema** (ex: `https://pedidos.classul.com.br`) e a **senha** (`API_TOKEN`) → **Salvar e testar conexão**.
4. Abra o WhatsApp Web: no cabeçalho da conversa aparecem os botões de **Criar pedido**, **Mensagens rápidas** e **Copiar imagem de placa**.

## Mensagens automáticas

- Editáveis em **Configurações**, com liga/desliga por etapa.
- Variáveis disponíveis: `{nome}`, `{pedido}`, `{produto}`, `{valor}`, `{entrega}`, `{descricao}`.
- O histórico de envios (com sucesso/erro) aparece ao abrir o pedido no Kanban.

## API (resumo técnico)

Todas as rotas exigem header `Authorization: Bearer <API_TOKEN>`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/orders` | Lista pedidos (`?archived=1` para arquivados) |
| POST | `/api/orders` | Cria pedido |
| PUT | `/api/orders/:id` | Edita pedido |
| PATCH | `/api/orders/:id/status` | Move no Kanban (dispara WhatsApp em `pronto`/`entregue`) |
| POST | `/api/orders/:id/notify` | Reenvia mensagem de uma etapa |
| PATCH | `/api/orders/:id/archive` | Arquiva/restaura |
| DELETE | `/api/orders/:id` | Exclui |
| GET/PUT | `/api/settings` | Configurações (Evolution + modelos de mensagem) |
| GET | `/api/evolution/instances` | Lista instâncias da Evolution |
| POST | `/api/evolution/test` | Envia mensagem de teste |
