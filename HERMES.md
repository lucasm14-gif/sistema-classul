# Conectando o Hermes (VPS) ao sistema Classul

O Hermes tem **controle do sistema**: ele lê e cria pedidos, consulta clientes, manda
WhatsApp e recebe um aviso sempre que algo muda aqui. Tudo passa por duas coisas:

| Direção | O que é | Onde configura |
|---|---|---|
| **Hermes → sistema** | Ele chama `POST /api/hermes/call` com o nome de uma ferramenta | Chave do Hermes |
| **Sistema → Hermes** | O sistema chama a URL da VPS quando algo acontece | Webhook do Hermes |

Ligar: **Configurações → Hermes (bot na VPS)**. Lá ficam a chave, o endereço do sistema,
a URL do webhook e o botão **Testar**. Enquanto o interruptor estiver desligado, a chave
não vale para nada — nenhuma chamada passa.

---

## 1. Hermes → sistema (ferramentas)

Base: `https://sistema-classul.vercel.app`
Autenticação: `Authorization: Bearer <CHAVE_DO_HERMES>` (ou o header `X-Hermes-Token`).

### Conferir a conexão

```bash
curl -H "Authorization: Bearer $CHAVE" \
  https://sistema-classul.vercel.app/api/hermes/ping
# {"ok":true,"sistema":"Classul","ferramentas":49,"pre_atendimento":"hermes"}
```

### Pegar o catálogo de ferramentas

O sistema já entrega os schemas no formato dos SDKs — não precisa escrever nada à mão,
e quando eu adicionar uma ferramenta nova ela aparece sozinha para o Hermes.

```bash
curl -H "Authorization: Bearer $CHAVE" \
  "https://sistema-classul.vercel.app/api/hermes/tools?format=openai"
# ?format=anthropic  → [{name, description, input_schema}]
# sem format         → [{name, description, parameters}]
```

### Executar uma ferramenta

```bash
curl -X POST https://sistema-classul.vercel.app/api/hermes/call \
  -H "Authorization: Bearer $CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"tool":"buscar_pedido","args":{"codigo_retirada":"4821"}}'
```

Resposta:

```jsonc
{ "ok": true,  "tool": "buscar_pedido", "result": { /* ... */ } }
{ "ok": false, "tool": "buscar_pedido", "error": "Pedido não encontrado." }
```

**Importante:** erro de regra vem como `ok:false` com **HTTP 200**, de propósito — assim o
laço de tool calling do Hermes devolve o motivo para o modelo e a conversa continua, em vez
de estourar uma exceção. HTTP 401 = chave errada; HTTP 403 = conexão desligada no painel.

### O laço de tool calling (exemplo em Node, com a OpenAI)

```js
const BASE = 'https://sistema-classul.vercel.app';
const H = { Authorization: `Bearer ${process.env.CLASSUL_KEY}`, 'Content-Type': 'application/json' };

const tools = (await (await fetch(`${BASE}/api/hermes/tools?format=openai`, { headers: H })).json()).tools;

async function chamar(nome, args) {
  const r = await fetch(`${BASE}/api/hermes/call`, {
    method: 'POST', headers: H, body: JSON.stringify({ tool: nome, args })
  });
  return r.json(); // { ok, result } ou { ok, error }
}

async function conversar(mensagens) {
  const r = await openai.chat.completions.create({ model: 'gpt-4o', messages: mensagens, tools });
  const msg = r.choices[0].message;
  if (!msg.tool_calls) return msg.content;

  mensagens.push(msg);
  for (const tc of msg.tool_calls) {
    const saida = await chamar(tc.function.name, JSON.parse(tc.function.arguments));
    mensagens.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(saida.ok ? saida.result : { erro: saida.error })
    });
  }
  return conversar(mensagens); // deixa o modelo ver o resultado e seguir
}
```

### As 49 ferramentas

**Pedidos** — `listar_pedidos`, `buscar_pedido` (por número, id, código de retirada de 4
dígitos ou telefone), `criar_pedido`, `atualizar_pedido`, `mover_pedido`, `arquivar_pedido`,
`comentar_pedido`, `entregas_proximas`.

**Clientes** — `listar_clientes`, `buscar_cliente` (vem com o histórico de pedidos),
`criar_cliente`, `atualizar_cliente`.

**WhatsApp** — `enviar_mensagem`, `enviar_foto`, `avisar_status_pedido` (reenvia a mensagem
automática da etapa, com o código de retirada).

**Negócio** — `faturamento`, `resumo_do_dia`, `catalogo`, `mensagens_rapidas`,
`listar_funcionarios`.

**Conversas** — `listar_conversas`, `historico_conversa`, `encerrar_conversa`,
`reativar_conversa`.

**Finanças** (a aba com PIN) — `financas_resumo`: saldos, cartões, investimentos, gastos e
entradas do mês, categorias, últimos lançamentos e contas a pagar.

**Notas fiscais** (a aba com PIN) — `notas_listar`, `nota_detalhe` (por id ou número),
`nfe_situacao` (ambiente, próximo número, certificado, SEFAZ no ar), `nfe_clientes`,
`nfe_produtos`. Só leitura: emitir, cancelar e carta de correção continuam pela tela.

**Arquivos** — `arquivos_do_pedido`, `arquivos_recebidos`, `placas_do_site`, `leads_do_site`,
`enviar_arquivo` (manda por WhatsApp como documento) e `baixar_arquivo` (base64, até 3 MB).

**Atendente** — `roteiro_atendimento` e `calcular_placa_sem_estojo` (preço da placa sem estojo
pela conta da Classul; nunca calcule de cabeça).

**Agentes** (seção 6) — `agentes_listar`, `agente_criar`, `agente_postar`, `agente_mensagens`,
`agente_respostas`, `ficha_placa`, `subir_arquivo`, `anexar_arquivo_pedido`, `gerar_orcamento`, `nf_rascunho`
e `nf_rascunhos`. `enviar_arquivo` ganhou `como_imagem: true` para mandar arte como foto.

O Hermes entra em Finanças e Notas **sem PIN**: a chave dele basta. A exceção é **emitir nota**:
não existe ferramenta para isso; o Hermes monta o rascunho e o Lucas aprova na tela, com o PIN.

#### Arquivos: a "ref"

Toda listagem devolve, para cada arquivo, `{ ref, nome, baixar }`. A `ref` é o que identifica
o arquivo em qualquer lugar:

| Ref | O que é |
|---|---|
| `nfe:<id>:pdf` / `nfe:<id>:xml` | DANFE e XML autorizado de uma nota |
| `drive:<fileId>` | anexo de pedido ou arquivo recebido de cliente |
| `placa:<id>:jpg` (ou `svg`, `foto`, `arte`, `logo`, `logo2`) | arquivos de uma placa do site |

Três jeitos de usar:

```bash
# 1. mandar direto por WhatsApp (para o Lucas ou para o cliente)
{"tool":"enviar_arquivo","args":{"telefone":"5551999999999","ref":"nfe:12:pdf","legenda":"Segue a nota"}}

# 2. pegar o conteúdo em base64 (até 3 MB)
{"tool":"baixar_arquivo","args":{"ref":"nfe:12:xml"}}

# 3. baixar o binário (qualquer tamanho que a Vercel deixe passar, ~4 MB)
curl -H "Authorization: Bearer $CHAVE" -OJ \
  "https://sistema-classul.vercel.app/api/hermes/arquivo?ref=nfe:12:pdf"
```

#### Catálogo para o atendimento

`GET /api/hermes/tools?perfil=atendimento` devolve o catálogo **sem** finanças, notas e
`baixar_arquivo`. Use esse no laço que conversa com cliente: quem escreve no WhatsApp
pode tentar convencer o modelo a chamar ferramenta, e o que ele não enxerga ele não chama.
O catálogo completo fica para as conversas com o Lucas.

A descrição e os campos de cada uma vêm no `/api/hermes/tools` — esta lista é só o resumo.

**Nenhuma ferramenta do Classul apaga nada.** Pedido sai do quadro por `arquivar_pedido`, que
é reversível. Apagar de verdade continua só na mão, pela tela do sistema.

Um pedido criado pelo Hermes já nasce com código de retirada de 4 dígitos, cliente vinculado
(ou criado) pelo telefone e autoria `Hermes` — exatamente como um pedido criado na tela.

---

## 2. Sistema → Hermes (webhook)

O sistema faz `POST` na URL que você cadastrar, com:

```
Authorization: Bearer <CHAVE_DO_HERMES>
X-Classul-Event: pedido.status
X-Classul-Signature: <HMAC-SHA256 do corpo, com a chave como segredo>
```

```json
{ "event": "pedido.status", "at": "2026-09-17T18:40:00.000Z", "data": { } }
```

Conferir a assinatura na VPS (recomendado — garante que o aviso veio mesmo daqui):

```js
const esperado = crypto.createHmac('sha256', CHAVE).update(corpoCru).digest('hex');
if (esperado !== req.headers['x-classul-signature']) return res.sendStatus(401);
```

### Eventos

| Evento | Quando | `data` |
|---|---|---|
| `pedido.criado` | pedido novo (pela tela, pela extensão ou pelo próprio Hermes) | `{ pedido, por }` |
| `pedido.atualizado` | campos mudaram | `{ pedido, por }` |
| `pedido.status` | mudou de etapa no Kanban | `{ pedido, de, para, por, aviso_enviado }` |
| `lead.novo` | alguém clicou no WhatsApp do site | `{ pagina, botao, origem, campanha }` |
| `mensagem.recebida` | cliente mandou mensagem (só com o Hermes no comando) | `{ telefone, de_mim, nome, texto, tipo, wa_message_id, atender, motivo }` |
| `teste` | botão Testar do painel | `{ mensagem }` |
| `agente.resposta` | o Lucas decidiu numa mensagem de agente (aprovou, pediu correção, respondeu dúvida, devolveu ficha) | `{ agente, mensagem_id, codigo, tipo, decisao, resposta, referencia, texto_original, anexos, dados, feita_no_mac, por }` |
| `agente.mensagem` | o Lucas escreveu livre no chat de um agente | `{ agente, mensagem_id, texto, por }` |
| `nf.emitida` | o Lucas aprovou o rascunho e a SEFAZ autorizou | `{ rascunho_id, nota_id, numero, situacao, ref_pdf, telefone_cliente, pedido }` |
| `nf.problema` | a nota aprovada foi rejeitada ou deu erro | `{ rascunho_id, nota_id?, erro? motivo?, telefone_cliente, pedido }` |
| `atendente.fase` | o Lucas ligou/desligou "Arte direto ao cliente" ou "Arte pelo Mac" | `{ arte_automatica, arte_pelo_mac }` |

O sistema espera até 6s pela resposta da VPS. Se o Hermes estiver fora do ar, **nada
quebra**: o pedido acontece normalmente e a falha fica registrada em "Últimas trocas com
o Hermes", no painel.

---

## 3. O Hermes assumindo o pré-atendimento

O bot antigo deste sistema foi removido em 24/11/2026. O único atendente agora é o Hermes.
No painel, em **Quem faz o pré-atendimento no WhatsApp**, há duas opções:

- **Atendente novo (Hermes)**: o webhook da Evolution manda as mensagens dos clientes para o
  Hermes, pelo evento `mensagem.recebida`.
- **Ninguém**: só atendimento humano. É o padrão, e um `interno` antigo gravado no banco também
  vale como desligado.

### Quem atender

O Hermes lê as conversas e avalia se é para responder, como o roteiro manda.

- **Não responder estes números:** os números dessa lista nas Configurações chegam com
  `atender: false` e `motivo`.
- **Número de teste:** com ele preenchido nas Configurações, só ele chega com `atender: true`.
  Os demais vêm com `atender: false` e `motivo: "fase de teste: só o número de teste é atendido"`.
  Respeite sempre o `atender`.
- **Humano respondeu:** a mensagem chega com `de_mim: true`. Pare de responder naquela conversa.

Antes de responder, chame **`roteiro_atendimento`**. Ela devolve as respostas padrão, a tabela,
as fotos, o pagamento, o endereço, o limite de urgentes e a regra de desconto. As regras
completas estão em `output/hermes-skill/ATENDENTE-CLASSUL.md`.

Responda com `enviar_mensagem`, `enviar_foto` e `enviar_arquivo`. Tudo fica gravado, e
`historico_conversa` devolve a conversa.

O **observador de conversas** (aba Recebidos) continua igual: ele só escuta e nunca responde.
O webhook da Evolution continua apontando para `/api/bot/webhook`.

### Conversas de teste (aba Testar atendente)

O Lucas finge ser cliente numa conversa falsa.

- **Telefone:** cada conversa tem um telefone de teste no formato `5500000` + 6 dígitos (DDD 00
  não existe).
- **Mensagem do cliente:** chega como `mensagem.recebida` igual à do WhatsApp, com
  `teste: true`, `atender: true` e o nome do cliente de teste. Se ele mandar logo ou arquivo,
  vem em `arquivo: { ref: "teste:ID", nome, tipo }`, que você baixa com `baixar_arquivo` ou
  usa em `enviar_arquivo`.
- **Sua resposta:** use as mesmas ferramentas de sempre (`enviar_mensagem`, `enviar_foto`,
  `enviar_arquivo`) com o telefone de teste. O sistema desvia tudo para a tela de teste, e nada
  sai pela Evolution.
- **Agentes:** funcionam igual. Passe `referencia` com o telefone de teste, porque quando o
  Lucas apaga a conversa os avisos dela somem dos agentes.
- **Nota:** em `nf_rascunho`, passe `telefone_cliente` com o telefone de teste. Aprovar não emite
  nada: chega `nf.emitida` com `teste: true` e `ref_pdf: null`. Diga ao cliente de teste que a
  nota foi emitida.
- **Pedido:** criar pedido no teste funciona. Ao apagar a conversa, o pedido vai para Arquivados.
- **Conversa apagada:** mandar para ela dá erro. Esqueça esse telefone.

---

## 4. Segurança

- A chave do Hermes é separada do login do sistema. Trocar uma não afeta a outra.
- **Gerar chave nova** (botão de recarregar ao lado da chave) invalida a antiga na hora —
  é o que fazer se a VPS for comprometida.
- Com o interruptor desligado, nenhuma chamada do Hermes passa, mesmo com a chave certa.
- Toda troca fica registrada (entrada e saída, com erro quando houver) e aparece no painel.
  As chamadas das áreas com PIN (finanças, notas, `baixar_arquivo`) entram no registro só com o nome e se deu certo — sem argumentos,
  resultado nem mensagem de erro —, porque o painel do Hermes não pede o PIN da área.

## 5. Orçamento em PDF (botão da extensão)

O botão de orçamento da extensão lê as últimas 20 mensagens da conversa e o sistema manda
para a **rota de texto do Hermes** (`POST /claude`, padrão `https://evo.brindideias.com.br/claude`;
URL e chave em Configurações → Hermes → "Orçamento em PDF", ou `HERMES_AI_KEY` /
`HERMES_CLAUDE_KEY` no ambiente). Corpo: `{ "texto": "<instruções + conversa>", "modo": "texto" }`.
Espera `{ "ok": true, "texto": "<JSON do orçamento>" }`; se vier `{ "tarefa": "ID" }`, a extensão
consulta `GET /claude/tarefa/ID` a cada 4 s.

- A ideia é o Hermes responder com a **assinatura da OpenAI** do Lucas — conferir na VPS que a
  rota de texto usa a assinatura, não chave de API.
- O roteador do Hermes desvia para o gerador de imagem quando o texto parece pedir uma
  ("criar a arte com o logo"). O sistema troca esses termos por neutros antes de mandar, mas o
  certo é a VPS respeitar `"modo": "texto"` e nunca gerar imagem nesse caso.

## 6. Agentes (aba Agentes do sistema)

Cada agente é um chat no estilo WhatsApp entre o Hermes e o Lucas, dentro do sistema. Vêm
seis prontos — `artes`, `notas`, `duvidas`, `pendencias`, `orcamentos`, `descontos` — e o Hermes cria
outros com `agente_criar` quando precisar.

- `agente_postar` com `tipo`:
  - `info`: só avisa;
  - `aprovacao`: botões Aprovar e Corrigir (arte, estojo colorido);
  - `pergunta`: o Lucas escreve a resposta (dúvida de cliente).

  As que esperam ganham um código (`ART12`, `DUV7`…).
- A decisão chega no evento `agente.resposta`. Se o webhook falhar, `agente_respostas` devolve o
  que ainda não foi entregue, uma vez só.
- **Arquivos:** suba com `subir_arquivo` (base64, até 3 MB, cai na pasta "Classul - Agentes" do
  Drive) e passe as refs em `anexos`. A tela mostra imagem e PDF.
- **Pedido fechado:**
  1. `criar_pedido`, com a quantidade na descrição e o valor total em `value`;
  2. `anexar_arquivo_pedido` com a arte aprovada e o vetor (categoria `arte`).
- **Orçamento:** `gerar_orcamento` faz o PDF da Classul, guarda, avisa no agente Orçamentos e,
  com `enviar_para`, manda ao cliente.
- **Nota fiscal:**
  1. `nf_rascunho` confere os dados sem gastar número e posta no agente Notas fiscais;
  2. o Lucas clica em **Aprovar e emitir** e digita o PIN das Notas;
  3. o próprio sistema emite e manda `nf.emitida` com `ref_pdf`;
  4. o Hermes manda ao cliente com `enviar_arquivo`.

  Se o Lucas pedir correção, chega `agente.resposta` com `decisao: "corrigir"`: monte um
  rascunho novo.
- A fase do atendente fica em `agentes_listar().arte_automatica`. Com `false`, toda arte passa
  pelo agente Artes antes do cliente.
- **Arte pelo Mac** (`agentes_listar().arte_pelo_mac`): o Hermes não chama o Claude da VPS para
  arte. Ele posta a ficha com `ficha_placa` (etapas `arte`, `ajuste`, `vetor`); o Lucas faz no Mac
  com `node tools/fichas.mjs listar | baixar ART21 | entregar ART21 arte.jpg foto.jpg`, que usa as
  rotas `GET /api/agentes/fichas[/:codigo]` e `POST /api/agentes/fichas/:codigo/entregar` (login do
  sistema). A arte volta como `aprovacao` de autor `claude-mac`; aprovada, o `agente.resposta` leva
  os `anexos`. Na tela, "devolver ao Hermes" manda `decisao: "devolvida"` e o Claude da VPS faz.

O roteiro completo do atendente (quem faz o quê, regras da Classul, aprovações) está em
`output/hermes-skill/ATENDENTE-CLASSUL.md`.

---

Testes: `node smoke-test-hermes.mjs` (70 verificações, banco em memória, nada sai para a
internet — a Evolution é mockada e o "Hermes" é um servidor local).
Orçamento: `node smoke-test-quotes.mjs` (24 verificações, Hermes falso local).
Agentes: `node smoke-test-agentes.mjs` (84 verificações: Drive, Evolution e SEFAZ falsos).
