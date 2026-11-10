// Acesso do Hermes às áreas que na tela pedem PIN (Finanças e Notas fiscais) e aos
// arquivos do sistema. Decisão do Lucas: o Hermes entra só com a chave dele, sem PIN.
//
// Todo arquivo é apontado por uma "ref" curta, que as ferramentas de listagem devolvem:
//   nfe:<id>:pdf | nfe:<id>:xml        DANFE e XML autorizado de uma nota
//   drive:<fileId>                     anexo de pedido, arquivo recebido, foto
//   placa:<id>:jpg|svg|foto|arte|logo|logo2   arquivos de uma placa montada no site
// Com a ref o Hermes manda por WhatsApp (enviar_arquivo), pega em base64
// (baixar_arquivo) ou baixa o binário em GET /api/hermes/arquivo?ref=...
import { q } from './db.js';
import { OrderError, dayKeySP } from './orders.js';
import { normalizePhone, sendDocument } from './whatsapp.js';
import { downloadFile, getFileMeta } from './google.js';
import { pluggyAuth, buildFinanceSummary } from './pluggy.js';
import { getPlateById, listPlates } from './plates.js';
import * as nfe from './nfe/service.js';
import { gerarDanfe } from './nfe/danfe.js';

const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const clamp = (n, min, max, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback;
};

// Resposta JSON da Vercel não passa de ~4,5 MB; em base64 o arquivo cresce 1/3.
const LIMITE_BASE64 = 3 * 1024 * 1024;

const caminho = (ref) => `/api/hermes/arquivo?ref=${encodeURIComponent(ref)}`;
const arquivo = (ref, nome, extra = {}) => ({ ref, nome, baixar: caminho(ref), ...extra });

const nomeNota = (n) => `NFe-${String(n.numero).padStart(6, '0')}-serie${n.serie}`;

const PLACA_ARQUIVOS = {
  jpg: ['jpg_file_id', () => 'image/jpeg', 'jpg', ''],
  svg: ['svg_file_id', () => 'image/svg+xml', 'svg', ''],
  foto: ['foto_file_id', () => 'image/jpeg', 'jpg', '-foto'],
  arte: ['arte_file_id', () => 'image/png', 'png', '-arte'],
  logo: ['logo_file_id', (p) => p.logo_mime, null, '-logo1'],
  logo2: ['logo2_file_id', (p) => p.logo2_mime, null, '-logo2']
};
const extDoMime = (mime) => (String(mime || '').split('/')[1] || 'bin').replace('+xml', '').replace('jpeg', 'jpg');

// Transforma uma ref no arquivo de verdade: { buffer, nome, mime }.
export async function resolverArquivo(refBruta) {
  const ref = String(refBruta || '').trim();
  const [tipo, id, parte] = ref.split(':');

  if (tipo === 'nfe') {
    await nfe.ensureNfeSchema();
    const n = await nfe.getNota(Number(id));
    if (parte === 'xml') {
      if (!n.xml_proc) throw new OrderError('Esta nota não tem XML autorizado.', 404);
      return { buffer: Buffer.from(n.xml_proc, 'utf8'), nome: `${n.chave}-procNFe.xml`, mime: 'application/xml' };
    }
    const xml = n.xml_proc || n.xml;
    if (!xml) throw new OrderError('Nota sem XML.', 404);
    const pdf = await gerarDanfe(xml, { cancelada: n.situacao === 'cancelada', logo: await nfe.getLogo() });
    return { buffer: pdf, nome: `${nomeNota(n)}.pdf`, mime: 'application/pdf' };
  }

  if (tipo === 'placa') {
    const plate = await getPlateById(id);
    const def = PLACA_ARQUIVOS[parte || 'jpg'];
    const fileId = plate && def ? plate[def[0]] : null;
    if (!fileId) throw new OrderError('Arquivo da placa não encontrado.', 404);
    const mime = def[1](plate) || 'application/octet-stream';
    const nome = `placa-${String(plate.id).padStart(4, '0')}${def[3]}.${def[2] || extDoMime(mime)}`;
    return { buffer: await downloadFile(fileId), nome, mime };
  }

  if (tipo === 'drive' && id) {
    const meta = await getFileMeta(id);
    return {
      buffer: await downloadFile(id),
      nome: meta?.name || `arquivo-${id}`,
      mime: meta?.mimeType || 'application/octet-stream'
    };
  }

  throw new OrderError('Ref de arquivo inválida. Use a "ref" devolvida pelas ferramentas de listagem.', 400);
}

async function acharNota(args = {}) {
  await nfe.ensureNfeSchema();
  if (args.id) return nfe.getNota(Number(args.id));
  const numero = Number(String(args.numero ?? '').replace(/\D/g, ''));
  if (!numero) throw new OrderError('Informe o id ou o número da nota.', 400);
  const cfg = await nfe.getConfig();
  const params = [numero, Number(args.ambiente) || cfg.ambiente];
  let sql = 'SELECT id FROM nfe_notas WHERE numero = $1 AND ambiente = $2';
  if (args.serie) {
    params.push(Number(args.serie));
    sql += ' AND serie = $3';
  }
  const { rows } = await q(`${sql} ORDER BY dh_emissao DESC NULLS LAST, id DESC LIMIT 5`, params);
  if (!rows.length) throw new OrderError(`Nota nº ${numero} não encontrada.`, 404);
  if (rows.length > 1 && !args.serie) {
    throw new OrderError(`Há mais de uma nota nº ${numero} (séries diferentes). Informe a série.`, 409);
  }
  return nfe.getNota(rows[0].id);
}

const arquivosDaNota = (n) => ({
  ...(n.xml_proc || n.xml ? { pdf: arquivo(`nfe:${n.id}:pdf`, `${nomeNota(n)}.pdf`) } : {}),
  ...(n.xml_proc ? { xml: arquivo(`nfe:${n.id}:xml`, `${n.chave}-procNFe.xml`) } : {})
});

const doDrive = (r) =>
  arquivo(`drive:${r.drive_file_id}`, r.name, {
    tipo: r.mime_type || null,
    tamanho: r.size == null ? null : Number(r.size),
    link_drive: r.web_view_link || null
  });

export const ACESSO_TOOLS = [
  // ------------------------------------------------------------- Finanças
  {
    name: 'financas_resumo',
    privado: true,
    description:
      'Finanças (Open Finance, a aba com PIN): saldos das contas, cartões, investimentos, gastos e entradas do mês, categorias, últimos lançamentos e contas a pagar. O Hermes entra sem o PIN.',
    parameters: obj({
      dias: num('Janela dos lançamentos, de 7 a 90 dias (padrão 30)'),
      por_banco: bool('true para trazer também os números separados por banco')
    }),
    async run(args = {}) {
      const { rows } = await q(
        "SELECT key, value FROM settings WHERE key IN ('pluggy_client_id', 'pluggy_client_secret')"
      );
      const cred = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (!cred.pluggy_client_id || !cred.pluggy_client_secret) {
        throw new OrderError('As credenciais da Pluggy ainda não foram configuradas na aba Finanças.');
      }
      const { rows: items } = await q(
        'SELECT item_id, connector_name, connector_image, label FROM finance_items ORDER BY created_at ASC'
      );
      if (!items.length) return { vazio: true, aviso: 'Nenhum banco conectado na aba Finanças.' };
      const apiKey = await pluggyAuth(cred.pluggy_client_id, cred.pluggy_client_secret);
      const s = await buildFinanceSummary(apiKey, items, { days: clamp(args.dias, 7, 90, 30) });
      const { by_connector: porBanco, ...resto } = s;
      return args.por_banco ? { ...resto, by_connector: porBanco } : resto;
    }
  },

  // -------------------------------------------------------- Notas fiscais
  {
    name: 'notas_listar',
    privado: true,
    description:
      'Lista as notas fiscais (NF-e) emitidas. Busca por nome do cliente, número, CPF/CNPJ ou chave. Cada nota vem com as refs do PDF e do XML para enviar ou baixar.',
    parameters: obj({
      busca: str('Nome do cliente, número da nota, CPF/CNPJ ou chave de acesso'),
      mes: str('Mês AAAA-MM'),
      situacao: str('autorizada, cancelada, rejeitada, pendente ou rascunho'),
      ambiente: num('1 = produção, 2 = homologação (padrão: o ambiente configurado na aba)'),
      limite: num('Quantas trazer, até 200 (padrão 30)')
    }),
    async run(args = {}) {
      await nfe.ensureNfeSchema();
      const cfg = await nfe.getConfig();
      const notas = await nfe.listarNotas({
        busca: args.busca,
        mes: String(args.mes || ''),
        situacao: String(args.situacao || ''),
        ambiente: Number(args.ambiente) || cfg.ambiente,
        limit: clamp(args.limite, 1, 200, 30)
      });
      return {
        total: notas.length,
        notas: notas.map((n) => ({
          ...n,
          arquivos: ['autorizada', 'cancelada'].includes(n.situacao)
            ? {
                pdf: arquivo(`nfe:${n.id}:pdf`, `${nomeNota(n)}.pdf`),
                xml: arquivo(`nfe:${n.id}:xml`, `${n.chave}-procNFe.xml`)
              }
            : {}
        }))
      };
    }
  },
  {
    name: 'nota_detalhe',
    privado: true,
    description:
      'Abre uma nota fiscal: cliente, itens, pagamento, protocolo, eventos (cancelamento, carta de correção) e as refs do PDF e do XML.',
    parameters: obj({
      id: num('Id da nota (vem do notas_listar)'),
      numero: str('Ou o número da nota'),
      serie: num('Série, se o número existir em mais de uma'),
      ambiente: num('1 = produção, 2 = homologação (padrão: o configurado)')
    }),
    async run(args = {}) {
      const n = await acharNota(args);
      const itens = await nfe.itensDaNota(n).catch(() => []);
      const { xml, xml_proc: xmlProc, ...resto } = n;
      return { ...resto, itens, arquivos: arquivosDaNota(n) };
    }
  },
  {
    name: 'nfe_situacao',
    privado: true,
    description:
      'Como está a emissão de notas: ambiente, série, próximo número, validade do certificado, se a SEFAZ está no ar e o total faturado por mês.',
    parameters: obj({ consultar_sefaz: bool('false para não consultar a SEFAZ agora (padrão: consulta)') }),
    async run(args = {}) {
      await nfe.ensureNfeSchema();
      const cfg = await nfe.getConfig();
      let sefaz = null;
      if (args.consultar_sefaz !== false) {
        sefaz = await nfe.sefazStatus().catch((err) => ({ online: false, erro: err.message }));
      }
      return {
        ambiente: cfg.ambiente === 1 ? 'produção' : 'homologação',
        serie: cfg.serie,
        proximo_numero: cfg.proximo_numero,
        certificado: cfg.cert,
        tem_certificado: cfg.has_cert,
        sefaz,
        resumo: await nfe.resumo(cfg.ambiente)
      };
    }
  },
  {
    name: 'nfe_clientes',
    privado: true,
    description: 'Cadastro fiscal de clientes da aba Notas (CPF/CNPJ, IE, endereço, telefone).',
    parameters: obj({ busca: str('Nome ou CPF/CNPJ'), limite: num('Até 200 (padrão 30)') }),
    async run(args = {}) {
      await nfe.ensureNfeSchema();
      return nfe.listarClientes(String(args.busca || ''), clamp(args.limite, 1, 200, 30));
    }
  },
  {
    name: 'nfe_produtos',
    privado: true,
    description: 'Cadastro de produtos da aba Notas (código, descrição, NCM, preço).',
    parameters: obj({ busca: str('Trecho da descrição ou código (opcional)') }),
    async run(args = {}) {
      await nfe.ensureNfeSchema();
      const todos = await nfe.listarProdutos();
      const b = String(args.busca || '').trim().toLowerCase();
      return b ? todos.filter((p) => JSON.stringify([p.codigo, p.descricao]).toLowerCase().includes(b)) : todos;
    }
  },

  // -------------------------------------------------------------- Arquivos
  {
    name: 'arquivos_do_pedido',
    description: 'Lista os anexos de um pedido (artes, fotos, comprovantes guardados no Drive), com a ref de cada um.',
    parameters: obj({ id: num('Id do pedido'), numero: str('Ou o número do pedido') }),
    async run(args = {}) {
      const id = Number(args.id) || Number(String(args.numero ?? '').replace(/\D/g, ''));
      if (!id) throw new OrderError('Informe o id ou o número do pedido.', 400);
      const { rows } = await q('SELECT * FROM attachments WHERE order_id = $1 ORDER BY created_at ASC, id ASC', [id]);
      return { pedido: id, total: rows.length, arquivos: rows.map(doDrive) };
    }
  },
  {
    name: 'arquivos_recebidos',
    description:
      'Arquivos que os clientes mandaram nas conversas acompanhadas (aba Recebidos), com a ref de cada um. Pode filtrar por telefone.',
    parameters: obj({
      telefone: str('Só os arquivos deste telefone (opcional)'),
      incluir_anexados: bool('true para incluir os que já viraram anexo de pedido'),
      limite: num('Até 200 (padrão 40)')
    }),
    async run(args = {}) {
      const where = [];
      const params = [];
      const phone = normalizePhone(args.telefone);
      if (phone) {
        params.push(phone);
        where.push(`phone = $${params.length}`);
      }
      if (!args.incluir_anexados) where.push('attached_order_id IS NULL');
      params.push(clamp(args.limite, 1, 200, 40));
      const { rows } = await q(
        `SELECT * FROM chat_files ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
        params
      );
      return {
        total: rows.length,
        arquivos: rows.map((r) => ({
          ...doDrive(r),
          telefone: r.phone,
          conversa: r.chat_name || null,
          pedido: r.attached_order_id || null,
          recebido_em: r.created_at
        }))
      };
    }
  },
  {
    name: 'placas_do_site',
    description:
      'Placas que os clientes montaram no site, com os textos, o telefone de quem montou e as refs da imagem (jpg), do vetor (svg) e da foto realista.',
    parameters: obj({ limite: num('Até 100 (padrão 20)') }),
    async run(args = {}) {
      const placas = await listPlates(clamp(args.limite, 1, 100, 20));
      return placas.map((p) => {
        const nome = `placa-${String(p.id).padStart(4, '0')}`;
        const arquivos = {
          jpg: arquivo(`placa:${p.id}:jpg`, `${nome}.jpg`),
          svg: arquivo(`placa:${p.id}:svg`, `${nome}.svg`)
        };
        if (p.has_foto) arquivos.foto = arquivo(`placa:${p.id}:foto`, `${nome}-foto.jpg`);
        if (p.has_arte) arquivos.arte = arquivo(`placa:${p.id}:arte`, `${nome}-arte.png`);
        if (p.has_logo) arquivos.logo = arquivo(`placa:${p.id}:logo`, `${nome}-logo1`);
        if (p.has_logo2) arquivos.logo2 = arquivo(`placa:${p.id}:logo2`, `${nome}-logo2`);
        return {
          id: p.id,
          dados: p.data,
          telefone: p.phone || null,
          nome: p.push_name || null,
          origem: p.utm_source || null,
          campanha: p.utm_campaign || null,
          imagem_enviada_em: p.image_sent_at || null,
          criada_em: p.created_at,
          arquivos
        };
      });
    }
  },
  {
    name: 'leads_do_site',
    description: 'Cliques nos botões de WhatsApp do site: quantos por dia, de quais páginas e de quais campanhas.',
    parameters: obj({ dias: num('Quantos dias para trás, até 90 (padrão 7)') }),
    async run(args = {}) {
      const dias = clamp(args.dias, 1, 90, 7);
      const { rows } = await q(
        'SELECT page, label, utm_source, utm_campaign, created_at FROM leads WHERE created_at >= $1 ORDER BY created_at DESC',
        [new Date(Date.now() - dias * 864e5).toISOString()]
      );
      const conta = (campo) => {
        const m = {};
        for (const r of rows) m[campo(r) || '(sem)'] = (m[campo(r) || '(sem)'] || 0) + 1;
        return m;
      };
      return {
        dias,
        total: rows.length,
        por_dia: conta((r) => dayKeySP(new Date(r.created_at))),
        por_pagina: conta((r) => r.page),
        por_origem: conta((r) => r.utm_source),
        por_campanha: conta((r) => r.utm_campaign),
        ultimos: rows.slice(0, 20)
      };
    }
  },
  {
    name: 'enviar_arquivo',
    description:
      'Manda um arquivo do sistema por WhatsApp como documento: nota fiscal (PDF ou XML), anexo de pedido, arquivo recebido ou placa do site. Use a "ref" que as ferramentas de listagem devolvem.',
    parameters: obj(
      {
        telefone: str('Telefone de destino com DDI e DDD, ex: 5551999999999'),
        ref: str('Ref do arquivo, ex: nfe:12:pdf, drive:1AbC..., placa:7:jpg'),
        legenda: str('Texto que acompanha o arquivo (opcional)'),
        nome: str('Nome do arquivo para quem recebe (opcional)')
      },
      ['telefone', 'ref']
    ),
    async run(args = {}) {
      const phone = normalizePhone(args.telefone);
      if (!phone) throw new OrderError('Telefone inválido.');
      const f = await resolverArquivo(args.ref);
      const nome = String(args.nome || '').trim() || f.nome;
      await sendDocument(phone, f.buffer.toString('base64'), nome, f.mime, String(args.legenda || ''));
      return { enviado: true, telefone: phone, arquivo: nome, tipo: f.mime, tamanho: f.buffer.length };
    }
  },
  {
    name: 'baixar_arquivo',
    privado: true,
    description:
      'Devolve o conteúdo de um arquivo do sistema em base64 (até 3 MB). Para arquivo maior, baixe o binário em GET /api/hermes/arquivo?ref=... com a mesma chave.',
    parameters: obj({ ref: str('Ref do arquivo') }, ['ref']),
    async run(args = {}) {
      const f = await resolverArquivo(args.ref);
      if (f.buffer.length > LIMITE_BASE64) {
        throw new OrderError(
          `Arquivo de ${(f.buffer.length / 1048576).toFixed(1)} MB: grande demais para base64. Baixe em GET ${caminho(String(args.ref))} ou mande direto com enviar_arquivo.`,
          413
        );
      }
      return { nome: f.nome, tipo: f.mime, tamanho: f.buffer.length, base64: f.buffer.toString('base64') };
    }
  }
];
