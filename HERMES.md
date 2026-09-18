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
# {"ok":true,"sistema":"Classul","ferramentas":24,"pre_atendimento":"hermes"}
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

### As 24 ferramentas

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

A descrição e os campos de cada uma vêm no `/api/hermes/tools` — esta lista é só o resumo.

**Não existe ferramenta que apague nada.** Pedido sai do quadro por `arquivar_pedido`, que é
reversível. Apagar de verdade continua só na mão, pela tela do sistema.

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
| `mensagem.recebida` | cliente mandou mensagem (só com o Hermes no comando) | `{ telefone, de_mim, nome, texto, tipo, wa_message_id }` |
| `teste` | botão Testar do painel | `{ mensagem }` |

O sistema espera até 6s pela resposta da VPS. Se o Hermes estiver fora do ar, **nada
quebra**: o pedido acontece normalmente e a falha fica registrada em "Últimas trocas com
o Hermes", no painel.

---

## 3. O Hermes assumindo o pré-atendimento

No painel, em **Quem faz o pré-atendimento no WhatsApp**:

- **Bot deste sistema** — a IA configurada aqui (comportamento de sempre).
- **Hermes (VPS)** — o webhook da Evolution passa a mandar as mensagens dos clientes para o
  Hermes, via evento `mensagem.recebida`. O bot interno não responde nada.
- **Ninguém** — só atendimento humano.

Com o Hermes no comando, ele responde chamando a ferramenta `enviar_mensagem` e encerra a
conversa com `encerrar_conversa`. As mensagens continuam sendo gravadas aqui, então a aba
**Bot** do sistema segue mostrando o histórico de cada conversa.

O **observador de conversas** (aba Recebidos, arquivos e sugestões de pedido) continua
funcionando do mesmo jeito nos três modos — ele só escuta, nunca responde.

Não é preciso mexer na Evolution: o webhook dela continua apontando para
`/api/bot/webhook`, e é o sistema que decide quem atende.

---

## 4. Segurança

- A chave do Hermes é separada do login do sistema. Trocar uma não afeta a outra.
- **Gerar chave nova** (botão de recarregar ao lado da chave) invalida a antiga na hora —
  é o que fazer se a VPS for comprometida.
- Com o interruptor desligado, nenhuma chamada do Hermes passa, mesmo com a chave certa.
- Toda troca fica registrada (entrada e saída, com erro quando houver) e aparece no painel.

---

Testes: `node smoke-test-hermes.mjs` (46 verificações, banco em memória, nada sai para a
internet — a Evolution é mockada e o "Hermes" é um servidor local).
