// Ferramentas que o Hermes (bot na VPS) pode executar no sistema.
// Cada ferramenta tem nome, descrição e um schema JSON — o formato que os
// modelos de IA usam para tool calling. O Hermes lista em GET /api/hermes/tools
// e executa em POST /api/hermes/call { tool, args }.
import { q, STATUSES, getSettings } from './db.js';
import { notifyHermes } from './hermes-events.js';
import { normalizePhone, formatOrderNumber, sendText, sendImageUrl, notifyStatus } from './whatsapp.js';
import {
  getOrder,
  getClient,
  serializeOrder,
  createOrder,
  updateOrderFields,
  moveOrderStatus,
  findOrCreateClient,
  parseValueBRL,
  monthKeySP,
  dayKeySP,
  PAYMENT_STATUSES,
  OrderError
} from './orders.js';

const AUTOR_PADRAO = 'Hermes';
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const clamp = (n, min, max, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback;
};

// Soma dias a uma data YYYY-MM-DD sem cair em fuso horário.
function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function weekdayName(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

async function resolveOrder(args = {}) {
  if (args.id) {
    const byId = await getOrder(args.id);
    if (byId) return byId;
  }
  if (args.numero) {
    const n = parseInt(String(args.numero).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) {
      const byNumber = await getOrder(n);
      if (byNumber) return byNumber;
    }
  }
  if (args.codigo_retirada) {
    const code = String(args.codigo_retirada).replace(/\D/g, '').slice(0, 4);
    const { rows } = await q(
      'SELECT * FROM orders WHERE pickup_code = $1 ORDER BY archived ASC, id DESC LIMIT 1',
      [code]
    );
    if (rows.length) return rows[0];
  }
  if (args.telefone) {
    const phone = normalizePhone(args.telefone);
    if (phone) {
      const { rows } = await q(
        'SELECT * FROM orders WHERE phone = $1 ORDER BY archived ASC, id DESC LIMIT 1',
        [phone]
      );
      if (rows.length) return rows[0];
    }
  }
  return null;
}

async function orderWithDetails(order) {
  const { rows: comments } = await q(
    'SELECT author, body, created_at FROM order_comments WHERE order_id = $1 ORDER BY created_at ASC, id ASC',
    [order.id]
  );
  const { rows: attachments } = await q(
    'SELECT name, category, web_view_link, created_at FROM attachments WHERE order_id = $1 ORDER BY id DESC',
    [order.id]
  );
  const client = order.client_id ? await getClient(order.client_id) : null;
  return {
    ...serializeOrder(order),
    cliente: client ? { id: client.id, nome: client.name, telefone: client.phone, email: client.email } : null,
    comentarios: comments,
    anexos: attachments,
    tem_nota_fiscal: attachments.some((a) => a.category === 'nota_fiscal')
  };
}

// ---------------------------------------------------------------- ferramentas

export const TOOLS = [
  {
    name: 'listar_pedidos',
    description:
      'Lista os pedidos do quadro. Filtra por etapa (novo, producao, pronto, entregue), por texto no nome do cliente/descrição, e permite ver os arquivados.',
    parameters: obj({
      status: { type: 'string', enum: STATUSES, description: 'Etapa do Kanban' },
      busca: str('Texto para procurar no nome do cliente, produto ou descrição'),
      arquivados: bool('true para listar os arquivados em vez dos ativos'),
      limite: num('Máximo de pedidos (padrão 30, máximo 200)')
    }),
    async run(args = {}) {
      const archived = args.arquivados ? 1 : 0;
      const limit = clamp(args.limite, 1, 200, 30);
      const { rows } = await q(
        'SELECT * FROM orders WHERE archived = $1 ORDER BY created_at DESC, id DESC',
        [archived]
      );
      let list = rows;
      if (args.status) list = list.filter((o) => o.status === args.status);
      if (args.busca) {
        const t = String(args.busca).toLowerCase();
        list = list.filter((o) =>
          [o.customer_name, o.description, o.product, o.product_type, o.phone]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(t))
        );
      }
      return {
        total: list.length,
        pedidos: list.slice(0, limit).map((o) => ({
          id: o.id,
          numero: formatOrderNumber(o.id),
          cliente: o.customer_name,
          telefone: o.phone,
          produto: o.product || o.product_type,
          tamanho: o.size,
          descricao: o.description,
          valor: o.value,
          entrega: o.due_date,
          hora_retirada: o.pickup_time,
          status: o.status,
          pagamento: o.payment_status,
          codigo_retirada: o.pickup_code
        }))
      };
    }
  },
  {
    name: 'buscar_pedido',
    description:
      'Abre um pedido inteiro (dados, cliente, comentários, anexos, nota fiscal). Encontra pelo número do pedido, pelo id, pelo código de retirada de 4 dígitos ou pelo telefone do cliente.',
    parameters: obj({
      numero: str('Número do pedido, ex: 0042'),
      id: num('Id do pedido'),
      codigo_retirada: str('Código de retirada de 4 dígitos'),
      telefone: str('Telefone do cliente (pega o pedido mais recente dele)')
    }),
    async run(args = {}) {
      const order = await resolveOrder(args);
      if (!order) throw new OrderError('Pedido não encontrado.', 404);
      return orderWithDetails(order);
    }
  },
  {
    name: 'criar_pedido',
    description:
      'Cria um pedido novo no quadro (entra na etapa "novo"). O cliente é vinculado ou criado automaticamente pelo telefone/nome, e o pedido já ganha um código de retirada de 4 dígitos.',
    parameters: obj(
      {
        customer_name: str('Nome do cliente (obrigatório)'),
        phone: str('Telefone com DDI e DDD, ex: 5551999999999'),
        product: str('Produto vendido, ex: Placa de homenagem'),
        size: str('Tamanho, ex: 14x20'),
        case_color: str('Cor do estojo: preto, azul ou vermelho'),
        case_only: bool('true quando é estojo avulso, sem placa'),
        description: str('O que o cliente quer: texto da homenagem, ocasião, quantidade'),
        value: str('Valor combinado, ex: 250,00'),
        due_date: str('Data de entrega no formato AAAA-MM-DD'),
        pickup_time: str('A partir de que horas pode buscar, ex: 14:00'),
        payment_status: { type: 'string', enum: PAYMENT_STATUSES, description: 'Situação do pagamento' }
      },
      ['customer_name']
    ),
    run: (args = {}) => createOrder(args, AUTOR_PADRAO)
  },
  {
    name: 'atualizar_pedido',
    description: 'Muda campos de um pedido existente (valor, prazo, descrição, pagamento, tamanho...).',
    parameters: obj(
      {
        id: num('Id do pedido'),
        numero: str('Número do pedido, se não souber o id'),
        customer_name: str('Nome do cliente'),
        phone: str('Telefone'),
        product: str('Produto'),
        size: str('Tamanho'),
        case_color: str('Cor do estojo'),
        description: str('Descrição'),
        value: str('Valor'),
        due_date: str('Data de entrega AAAA-MM-DD'),
        pickup_time: str('Hora a partir da qual pode buscar'),
        payment_status: { type: 'string', enum: PAYMENT_STATUSES, description: 'Situação do pagamento' }
      },
      []
    ),
    async run(args = {}) {
      const order = await resolveOrder(args);
      if (!order) throw new OrderError('Pedido não encontrado.', 404);
      return updateOrderFields(order, args, AUTOR_PADRAO);
    }
  },
  {
    name: 'mover_pedido',
    description:
      'Move o pedido de etapa no Kanban. Ao entrar em "pronto" ou "entregue", o sistema manda a mensagem automática para o cliente (se estiver ligada nas configurações).',
    parameters: obj(
      {
        id: num('Id do pedido'),
        numero: str('Número do pedido, se não souber o id'),
        status: { type: 'string', enum: STATUSES, description: 'Etapa de destino' }
      },
      ['status']
    ),
    async run(args = {}) {
      const order = await resolveOrder(args);
      if (!order) throw new OrderError('Pedido não encontrado.', 404);
      return moveOrderStatus(order, args.status, AUTOR_PADRAO);
    }
  },
  {
    name: 'arquivar_pedido',
    description:
      'Arquiva um pedido (sai do quadro, mas continua no histórico) ou desarquiva. Nada é apagado de verdade.',
    parameters: obj(
      {
        id: num('Id do pedido'),
        numero: str('Número do pedido, se não souber o id'),
        arquivar: bool('true arquiva, false devolve ao quadro (padrão true)')
      },
      []
    ),
    async run(args = {}) {
      const order = await resolveOrder(args);
      if (!order) throw new OrderError('Pedido não encontrado.', 404);
      const archived = args.arquivar === false ? 0 : 1;
      await q('UPDATE orders SET archived = $1, updated_at = now() WHERE id = $2', [archived, order.id]);
      return serializeOrder(await getOrder(order.id));
    }
  },
  {
    name: 'comentar_pedido',
    description: 'Escreve um comentário no pedido — aparece na task para a equipe ver.',
    parameters: obj(
      {
        id: num('Id do pedido'),
        numero: str('Número do pedido, se não souber o id'),
        texto: str('O comentário'),
        autor: str('Quem está falando (padrão: Hermes)')
      },
      ['texto']
    ),
    async run(args = {}) {
      const order = await resolveOrder(args);
      if (!order) throw new OrderError('Pedido não encontrado.', 404);
      const { rows } = await q(
        'INSERT INTO order_comments (order_id, author, body) VALUES ($1, $2, $3) RETURNING *',
        [order.id, String(args.autor || AUTOR_PADRAO).slice(0, 60), String(args.texto).slice(0, 2000)]
      );
      return rows[0];
    }
  },
  {
    name: 'entregas_proximas',
    description:
      'Pedidos que precisam ser entregues nos próximos dias, com o nome do dia da semana e a partir de que horas o cliente pode buscar. Inclui os atrasados.',
    parameters: obj({ dias: num('Quantos dias olhar para frente (padrão 4, máximo 30)') }),
    async run(args = {}) {
      const dias = clamp(args.dias, 1, 30, 4);
      const hoje = dayKeySP(new Date());
      const limite = addDaysISO(hoje, dias - 1);
      const { rows } = await q(
        "SELECT * FROM orders WHERE archived = 0 AND status <> 'entregue' AND due_date IS NOT NULL AND due_date <> '' ORDER BY due_date ASC, id ASC"
      );
      const mapear = (o) => ({
        id: o.id,
        numero: formatOrderNumber(o.id),
        cliente: o.customer_name,
        telefone: o.phone,
        produto: o.product || o.product_type,
        entrega: o.due_date,
        dia_da_semana: /^\d{4}-\d{2}-\d{2}$/.test(o.due_date) ? weekdayName(o.due_date) : null,
        pode_buscar_a_partir_de: o.pickup_time || null,
        status: o.status,
        pagamento: o.payment_status,
        codigo_retirada: o.pickup_code
      });
      return {
        hoje,
        atrasados: rows.filter((o) => o.due_date < hoje).map(mapear),
        proximos: rows.filter((o) => o.due_date >= hoje && o.due_date <= limite).map(mapear)
      };
    }
  },
  {
    name: 'listar_clientes',
    description: 'Lista ou procura clientes cadastrados.',
    parameters: obj({
      busca: str('Nome, telefone ou empresa'),
      limite: num('Máximo de clientes (padrão 30, máximo 200)')
    }),
    async run(args = {}) {
      const limit = clamp(args.limite, 1, 200, 30);
      const { rows } = await q('SELECT * FROM clients ORDER BY name ASC');
      let list = rows;
      if (args.busca) {
        const t = String(args.busca).toLowerCase();
        list = list.filter((c) =>
          [c.name, c.phone, c.company, c.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(t))
        );
      }
      return { total: list.length, clientes: list.slice(0, limit) };
    }
  },
  {
    name: 'buscar_cliente',
    description: 'Abre um cliente com todo o histórico de pedidos dele.',
    parameters: obj({
      id: num('Id do cliente'),
      telefone: str('Telefone do cliente'),
      nome: str('Nome exato do cliente')
    }),
    async run(args = {}) {
      let client = null;
      if (args.id) client = await getClient(args.id);
      if (!client && args.telefone) {
        const phone = normalizePhone(args.telefone);
        const { rows } = await q('SELECT * FROM clients WHERE phone = $1 ORDER BY id ASC LIMIT 1', [phone]);
        client = rows[0] || null;
      }
      if (!client && args.nome) {
        const { rows } = await q('SELECT * FROM clients WHERE LOWER(name) = LOWER($1) ORDER BY id ASC LIMIT 1', [
          String(args.nome).trim()
        ]);
        client = rows[0] || null;
      }
      if (!client) throw new OrderError('Cliente não encontrado.', 404);
      const { rows: orders } = await q('SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at DESC, id DESC', [
        client.id
      ]);
      return {
        ...client,
        pedidos: orders.map((o) => ({
          id: o.id,
          numero: formatOrderNumber(o.id),
          produto: o.product || o.product_type,
          valor: o.value,
          entrega: o.due_date,
          status: o.status,
          pagamento: o.payment_status,
          arquivado: Boolean(o.archived)
        }))
      };
    }
  },
  {
    name: 'criar_cliente',
    description: 'Cadastra um cliente (ou devolve o que já existir com o mesmo telefone/nome).',
    parameters: obj({ nome: str('Nome'), telefone: str('Telefone'), email: str('E-mail'), empresa: str('Empresa'), observacoes: str('Observações') }, ['nome']),
    async run(args = {}) {
      const client = await findOrCreateClient(args.nome, args.telefone);
      if (!client) throw new OrderError('Informe o nome do cliente.');
      if (args.email || args.empresa || args.observacoes) {
        await q(
          'UPDATE clients SET email = COALESCE($1, email), company = COALESCE($2, company), notes = COALESCE($3, notes), updated_at = now() WHERE id = $4',
          [args.email || null, args.empresa || null, args.observacoes || null, client.id]
        );
      }
      return getClient(client.id);
    }
  },
  {
    name: 'atualizar_cliente',
    description: 'Muda os dados de um cliente já cadastrado.',
    parameters: obj({ id: num('Id do cliente'), nome: str('Nome'), telefone: str('Telefone'), email: str('E-mail'), empresa: str('Empresa'), observacoes: str('Observações') }, ['id']),
    async run(args = {}) {
      const client = await getClient(args.id);
      if (!client) throw new OrderError('Cliente não encontrado.', 404);
      await q(
        'UPDATE clients SET name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email), company = COALESCE($4, company), notes = COALESCE($5, notes), updated_at = now() WHERE id = $6',
        [
          args.nome || null,
          args.telefone ? normalizePhone(args.telefone) || args.telefone : null,
          args.email || null,
          args.empresa || null,
          args.observacoes || null,
          client.id
        ]
      );
      return getClient(client.id);
    }
  },
  {
    name: 'enviar_mensagem',
    description:
      'Manda uma mensagem de WhatsApp pelo número da Classul (Evolution API). É assim que o Hermes responde os clientes.',
    parameters: obj({ telefone: str('Telefone com DDI e DDD, ex: 5551999999999'), texto: str('A mensagem') }, [
      'telefone',
      'texto'
    ]),
    async run(args = {}) {
      const phone = normalizePhone(args.telefone);
      if (!phone) throw new OrderError('Telefone inválido.');
      if (!String(args.texto || '').trim()) throw new OrderError('Mensagem vazia.');
      const sent = await sendText(phone, String(args.texto));
      await q('INSERT INTO bot_messages (phone, role, content, wa_message_id) VALUES ($1, $2, $3, $4)', [
        phone,
        'assistant',
        String(args.texto),
        sent?.key?.id || null
      ]);
      return { enviado: true, telefone: phone, wa_message_id: sent?.key?.id || null };
    }
  },
  {
    name: 'enviar_foto',
    description: 'Manda uma foto por WhatsApp a partir de um link (URL pública da imagem).',
    parameters: obj({ telefone: str('Telefone'), url: str('URL da imagem'), legenda: str('Legenda (opcional)') }, [
      'telefone',
      'url'
    ]),
    async run(args = {}) {
      const phone = normalizePhone(args.telefone);
      if (!phone) throw new OrderError('Telefone inválido.');
      await sendImageUrl(phone, String(args.url), args.legenda || '');
      return { enviado: true, telefone: phone };
    }
  },
  {
    name: 'avisar_status_pedido',
    description:
      'Reenvia para o cliente a mensagem automática de uma etapa do pedido (ex: avisar de novo que está pronto, com o código de retirada).',
    parameters: obj({
      id: num('Id do pedido'),
      numero: str('Número do pedido'),
      status: { type: 'string', enum: STATUSES, description: 'Qual mensagem mandar (padrão: a etapa atual)' }
    }),
    async run(args = {}) {
      const order = await resolveOrder(args);
      if (!order) throw new OrderError('Pedido não encontrado.', 404);
      const notification = await notifyStatus(order, args.status || order.status, { force: true });
      return { pedido: formatOrderNumber(order.id), notification };
    }
  },
  {
    name: 'faturamento',
    description: 'Fechamento do mês: quanto foi entregue, quantos pedidos e o que ainda está para receber.',
    parameters: obj({ mes: str('Mês no formato AAAA-MM (padrão: mês atual)') }),
    async run(args = {}) {
      const mes = /^\d{4}-\d{2}$/.test(String(args.mes || '')) ? args.mes : monthKeySP(new Date());
      const { rows } = await q('SELECT * FROM orders');
      const entregues = rows.filter((o) => o.delivered_at && monthKeySP(o.delivered_at) === mes);
      const total = entregues.reduce((s, o) => s + parseValueBRL(o.value), 0);
      const aReceber = rows
        .filter((o) => !o.archived && o.payment_status !== 'pago')
        .reduce((s, o) => s + parseValueBRL(o.value), 0);
      const porProduto = {};
      for (const o of entregues) {
        const k = o.product || o.product_type || 'Sem produto';
        porProduto[k] = (porProduto[k] || 0) + parseValueBRL(o.value);
      }
      return {
        mes,
        pedidos_entregues: entregues.length,
        faturado: Number(total.toFixed(2)),
        ticket_medio: entregues.length ? Number((total / entregues.length).toFixed(2)) : 0,
        a_receber_em_aberto: Number(aReceber.toFixed(2)),
        por_produto: porProduto
      };
    }
  },
  {
    name: 'resumo_do_dia',
    description:
      'Panorama rápido de hoje: o que entrega hoje, o que está atrasado, o que está pronto esperando retirada e o que falta receber.',
    parameters: obj({}),
    async run() {
      const hoje = dayKeySP(new Date());
      const { rows } = await q('SELECT * FROM orders WHERE archived = 0');
      const simples = (o) => ({
        numero: formatOrderNumber(o.id),
        cliente: o.customer_name,
        produto: o.product || o.product_type,
        entrega: o.due_date,
        valor: o.value,
        codigo_retirada: o.pickup_code
      });
      const ativos = rows.filter((o) => o.status !== 'entregue');
      return {
        dia: hoje,
        entregar_hoje: ativos.filter((o) => o.due_date === hoje).map(simples),
        atrasados: ativos.filter((o) => o.due_date && o.due_date < hoje).map(simples),
        prontos_para_retirada: rows.filter((o) => o.status === 'pronto').map(simples),
        em_producao: rows.filter((o) => o.status === 'producao').length,
        novos: rows.filter((o) => o.status === 'novo').length,
        pagamento_pendente: rows.filter((o) => o.payment_status === 'pendente').map(simples)
      };
    }
  },
  {
    name: 'catalogo',
    description: 'Produtos que a Classul vende, com os tamanhos e cores disponíveis.',
    parameters: obj({}),
    async run() {
      const { rows } = await q('SELECT * FROM catalog_products WHERE active = 1 ORDER BY sort_order ASC, id ASC');
      const settings = await getSettings();
      return { produtos: rows, texto_para_o_cliente: settings.bot_products || '' };
    }
  },
  {
    name: 'mensagens_rapidas',
    description: 'As respostas prontas cadastradas no sistema (endereço, formas de pagamento, prazos...).',
    parameters: obj({}),
    async run() {
      const { rows } = await q('SELECT title, body FROM quick_messages WHERE active = 1 ORDER BY sort_order ASC, id ASC');
      return { mensagens: rows };
    }
  },
  {
    name: 'listar_funcionarios',
    description: 'Quem trabalha na Classul e está cadastrado no sistema.',
    parameters: obj({}),
    async run() {
      const { rows } = await q('SELECT id, name, color FROM employees WHERE active = 1 ORDER BY name ASC');
      return { funcionarios: rows };
    }
  },
  {
    name: 'listar_conversas',
    description: 'Conversas de pré-atendimento: quem está em andamento e quem já foi atendido.',
    parameters: obj({ limite: num('Máximo de conversas (padrão 30)') }),
    async run(args = {}) {
      const limit = clamp(args.limite, 1, 200, 30);
      const { rows } = await q('SELECT * FROM bot_conversations ORDER BY updated_at DESC, id DESC');
      return { total: rows.length, conversas: rows.slice(0, limit) };
    }
  },
  {
    name: 'historico_conversa',
    description: 'As mensagens trocadas com um número no pré-atendimento.',
    parameters: obj({ telefone: str('Telefone'), limite: num('Últimas N mensagens (padrão 40)') }, ['telefone']),
    async run(args = {}) {
      const phone = normalizePhone(args.telefone);
      if (!phone) throw new OrderError('Telefone inválido.');
      const limit = clamp(args.limite, 1, 200, 40);
      const { rows } = await q(
        'SELECT role, content, created_at FROM bot_messages WHERE phone = $1 ORDER BY id DESC LIMIT $2',
        [phone, limit]
      );
      return { telefone: phone, mensagens: rows.reverse() };
    }
  },
  {
    name: 'encerrar_conversa',
    description:
      'Marca a conversa como atendida — o pré-atendimento para de responder aquele número (é o que o Hermes faz quando já entendeu o pedido).',
    parameters: obj({ telefone: str('Telefone'), motivo: str('Por que encerrou') }, ['telefone']),
    async run(args = {}) {
      const phone = normalizePhone(args.telefone);
      if (!phone) throw new OrderError('Telefone inválido.');
      await q(
        `INSERT INTO bot_conversations (phone, status, handled_reason, handled_at)
         VALUES ($1, 'handled', $2, now())
         ON CONFLICT (phone) DO UPDATE SET status = 'handled', handled_reason = $2, handled_at = now(), updated_at = now()`,
        [phone, String(args.motivo || 'Hermes concluiu').slice(0, 120)]
      );
      return { telefone: phone, status: 'handled' };
    }
  },
  {
    name: 'reativar_conversa',
    description: 'Volta a atender um número que já tinha sido encerrado.',
    parameters: obj({ telefone: str('Telefone') }, ['telefone']),
    async run(args = {}) {
      const phone = normalizePhone(args.telefone);
      if (!phone) throw new OrderError('Telefone inválido.');
      await q(
        "UPDATE bot_conversations SET status = 'active', handled_reason = NULL, handled_at = NULL, updated_at = now() WHERE phone = $1",
        [phone]
      );
      return { telefone: phone, status: 'active' };
    }
  }
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Mesmo catálogo em outros formatos, para o Hermes colar direto no SDK que usar.
export function toolsFor(format) {
  const plain = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
  if (format === 'openai') {
    return plain.map((t) => ({ type: 'function', function: t }));
  }
  if (format === 'anthropic') {
    return plain.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters }));
  }
  return plain;
}

export async function runTool(name, args = {}) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    throw new OrderError(`Ferramenta desconhecida: ${name}. Veja as disponíveis em GET /api/hermes/tools.`, 400);
  }
  return tool.run(args || {});
}

// ---------------------------------------------- pré-atendimento pelo Hermes

// Mesmo extrator do bot interno: pega o texto de qualquer tipo de mensagem.
function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ''
  ).trim();
}

// Quando o pré-atendimento está no Hermes, o webhook da Evolution cai aqui:
// a mensagem é guardada no sistema (para a aba Bot continuar mostrando a conversa)
// e repassada para a VPS, que decide o que responder.
export async function forwardIncomingToHermes(body) {
  const data = body?.data || {};
  const key = data.key || {};
  const jid = key.remoteJid || '';
  if (!jid.endsWith('@s.whatsapp.net')) return { ignored: 'não é conversa individual' };

  const phone = jid.split('@')[0].replace(/\D/g, '');
  const fromMe = Boolean(key.fromMe);
  const texto = extractText(data.message);
  const payload = {
    telefone: phone,
    de_mim: fromMe,
    nome: data.pushName || null,
    texto,
    tipo: Object.keys(data.message || {})[0] || null,
    wa_message_id: key.id || null
  };

  if (!fromMe && texto) {
    await q(
      `INSERT INTO bot_conversations (phone, push_name) VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET
         push_name = COALESCE(EXCLUDED.push_name, bot_conversations.push_name),
         updated_at = now()`,
      [phone, data.pushName || null]
    );
    await q('INSERT INTO bot_messages (phone, role, content, wa_message_id) VALUES ($1, $2, $3, $4)', [
      phone,
      'user',
      texto,
      key.id || null
    ]);
  }

  const entrega = await notifyHermes('mensagem.recebida', payload);
  return { engine: 'hermes', encaminhado: Boolean(entrega?.sent), ...payload, entrega };
}
