// Ferramentas do Hermes para o atendente novo: agentes (chats com o Lucas na aba
// Agentes), arquivos de arte, anexos de pedido, orçamento em PDF e rascunho de NF-e.
// A regra que não muda: o Hermes monta o rascunho da nota, mas não aprova nem emite.
import * as ag from './agentes.js';

const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const arr = (items, d) => ({ type: 'array', items, description: d });

const anexo = obj({ ref: str('Ref do arquivo (drive:..., nfe:..., placa:...)'), nome: str('Nome para mostrar'), tipo: str('Tipo, ex: image/jpeg') }, ['ref']);

export const AGENTES_TOOLS = [
  {
    name: 'agentes_listar',
    description:
      'Lista os agentes (chats com o Lucas na aba Agentes do sistema): Artes para aprovar, Notas fiscais, Dúvidas, Pendências, Orçamentos e os que você criou. Diz quantas mensagens esperam o Lucas e a fase: arte_automatica (arte vai direto ao cliente) e arte_pelo_mac (arte feita pelo Lucas no Mac: use ficha_placa em vez do seu Claude).',
    parameters: obj({}),
    run: () => ag.listarAgentes()
  },
  {
    name: 'agente_criar',
    description: 'Cria um agente novo (um chat novo na aba Agentes) para um assunto que não cabe nos que já existem. Se já existir um com o mesmo nome, devolve ele.',
    parameters: obj(
      {
        nome: str('Nome que aparece para o Lucas, ex: Entregas do dia'),
        slug: str('Apelido curto sem espaço (opcional; sai do nome)'),
        descricao: str('Para que serve este agente'),
        cor: str('Cor em hex, ex: #0ea5e9 (opcional)')
      },
      ['nome']
    ),
    run: (args = {}) => ag.criarAgente(args)
  },
  {
    name: 'agente_postar',
    description:
      'Manda uma mensagem ao Lucas no chat de um agente. tipo "info" só avisa; "aprovacao" mostra os botões Aprovar e Corrigir (use para arte e estojo colorido); "pergunta" espera uma resposta escrita (use para dúvida de cliente). As que esperam ganham um código (ex: ART12) e a decisão chega no evento agente.resposta. Para arte, suba os arquivos antes com subir_arquivo e passe as refs em anexos. Nota fiscal NÃO vai por aqui: use nf_rascunho.',
    parameters: obj(
      {
        agente: str('Slug do agente: artes, notas, duvidas, pendencias, orcamentos ou um que você criou'),
        texto: str('Texto da mensagem, claro e completo (cliente, telefone, o que é, valores)'),
        tipo: { type: 'string', enum: ['info', 'aprovacao', 'pergunta'], description: 'info, aprovacao ou pergunta' },
        anexos: arr(anexo, 'Arquivos para mostrar (refs de subir_arquivo, anexos de pedido etc.)'),
        referencia: str('Telefone do cliente ou número do pedido a que isto se refere')
      },
      ['agente', 'texto']
    ),
    run: (args = {}) => ag.postar({ ...args, autor: 'hermes' })
  },
  {
    name: 'ficha_placa',
    description:
      'Com arte_pelo_mac ligado (veja agentes_listar), a arte NÃO é feita pelo seu Claude: junte tudo do cliente e poste aqui a ficha da placa. Ela aparece no agente Artes com um código (ex.: ART21); o Lucas faz a arte no Mac e ela volta no agente Artes como aprovação. Quando ele aprovar, você recebe agente.resposta com os anexos (arte e foto) e manda ao cliente. Use etapa "ajuste" para correção pedida pelo cliente (com as palavras exatas dele e o código da arte anterior) e "vetor" quando o cliente aprovar e for para produção. Diga ao cliente que a arte está sendo preparada.',
    parameters: obj(
      {
        etapa: { type: 'string', enum: ['arte', 'ajuste', 'vetor'], description: 'arte (nova, padrão), ajuste ou vetor' },
        cliente: str('Nome do cliente ou da empresa'),
        telefone: str('Telefone do cliente no WhatsApp'),
        tamanho: str('Tamanho da chapa, altura x largura em cm, ex: 16x25'),
        estojo: str('Cor do estojo: preto, azul, vermelho, ou "sem estojo"'),
        material: str('Material se não for o padrão (aço, alumínio dourado, latão)'),
        quantidade: num('Quantas placas'),
        prazo: str('Para quando, ex: 28/11'),
        texto_placa: str('O texto EXATO da placa, como o cliente mandou, com as quebras de linha'),
        pedido_do_cliente: str('Em ajuste: o que o cliente pediu, com as palavras dele'),
        ajuste_de: str('Em ajuste ou vetor: código da arte anterior, ex: ART15'),
        pedido: str('Número do pedido no quadro, se já existir'),
        observacoes: str('Cores, moldura, referência que ele mandou, o que mais importar'),
        anexos: arr(anexo, 'Logo e referências do cliente (refs de arquivos_recebidos ou subir_arquivo)')
      },
      ['telefone']
    ),
    run: (args = {}) => ag.criarFicha(args)
  },
  {
    name: 'agente_mensagens',
    description: 'Lê o histórico de um agente (as mensagens suas, do sistema e do Lucas), da mais antiga para a mais nova.',
    parameters: obj({ agente: str('Slug do agente'), limite: num('Quantas mensagens (padrão 50)') }, ['agente']),
    async run(args = {}) {
      const r = await ag.mensagensDoAgente(args.agente, { limite: args.limite || 50, marcarLidas: false });
      return { agente: r.agente.slug, mensagens: r.mensagens };
    }
  },
  {
    name: 'agente_respostas',
    description:
      'O que o Lucas decidiu ou escreveu nos agentes e você ainda não recebeu (aprovações, correções, respostas de dúvida, notas emitidas). Cada item volta uma vez só. Use se o evento agente.resposta não chegou.',
    parameters: obj({}),
    run: () => ag.respostasNaoEntregues()
  },
  {
    name: 'subir_arquivo',
    description:
      'Guarda um arquivo no sistema (Drive, pasta Classul - Agentes) e devolve a ref drive:... para usar em agente_postar, anexar_arquivo_pedido e enviar_arquivo. Até 3 MB; mande a arte em JPG.',
    parameters: obj(
      { base64: str('Conteúdo do arquivo em base64'), nome: str('Nome do arquivo com extensão, ex: arte-maria-16x25.jpg'), tipo: str('Tipo MIME (opcional, sai da extensão)') },
      ['base64', 'nome']
    ),
    run: (args = {}) => ag.subirArquivo(args)
  },
  {
    name: 'anexar_arquivo_pedido',
    description:
      'Anexa um arquivo a um pedido do quadro (vai para a pasta do pedido no Drive e aparece no pedido). Use para a arte aprovada (categoria arte) e o vetor do Corel (categoria arte, nome com "vetor"). Mande a ref drive:... de subir_arquivo ou o base64.',
    parameters: obj(
      {
        pedido: str('Número do pedido, ex: 0042'),
        ref: str('Ref drive:... de um arquivo já no sistema'),
        base64: str('Ou o conteúdo em base64 (até 3 MB)'),
        nome: str('Nome do arquivo, ex: 0042 - vetor CMYK.pdf'),
        tipo: str('Tipo MIME (opcional)'),
        categoria: { type: 'string', enum: ['arte', 'arquivo', 'nota_fiscal', 'material'], description: 'arte (padrão), arquivo, nota_fiscal ou material' }
      },
      ['pedido']
    ),
    run: (args = {}) => ag.anexarAoPedido(args)
  },
  {
    name: 'gerar_orcamento',
    description:
      'Gera o orçamento em PDF da Classul (o mesmo da aba Orçamento), guarda no sistema e avisa no agente Orçamentos. Com enviar_para, manda o PDF ao cliente pelo WhatsApp.',
    parameters: obj(
      {
        destinatario: str('Para quem é (cliente ou instituição)'),
        aos_cuidados: str('Aos cuidados de (opcional)'),
        itens: arr(
          obj({ descricao: str('Descrição do item'), quantidade: num('Quantidade'), valor_unitario: num('Valor unitário em reais') }, ['descricao', 'quantidade', 'valor_unitario']),
          'Itens do orçamento'
        ),
        prazo_producao: str('Prazo, ex: 2 a 3 dias úteis após aprovar a arte (padrão do sistema se vazio)'),
        validade: str('Validade (padrão 30 DIAS)'),
        observacoes: str('Observações (opcional)'),
        enviar_para: str('Telefone do cliente para já mandar o PDF (opcional)'),
        legenda: str('Texto que vai junto do PDF no WhatsApp'),
        avisar_lucas: bool('Avisar no agente Orçamentos (padrão true)')
      },
      ['destinatario', 'itens']
    ),
    run: (args = {}) => ag.gerarOrcamento(args)
  },
  {
    name: 'nf_rascunho',
    privado: true,
    description:
      'Monta o RASCUNHO de uma NF-e e manda ao Lucas no agente Notas fiscais. Não emite: só o Lucas aprova, na tela, e aí o próprio sistema emite e te avisa com o evento nf.emitida (com a ref do PDF para mandar ao cliente). Os itens usam produto_id do cadastro das Notas (ferramenta nfe_produtos).',
    parameters: obj(
      {
        cliente: obj(
          {
            documento: str('CPF ou CNPJ, só números'),
            nome: str('Nome ou razão social'),
            ie: str('Inscrição estadual (empresa contribuinte)'),
            email: str('E-mail para a nota'),
            telefone: str('Telefone'),
            cep: str('CEP'),
            logradouro: str('Rua'),
            numero: str('Número'),
            complemento: str('Complemento'),
            bairro: str('Bairro'),
            municipio: str('Cidade'),
            cod_municipio: str('Código IBGE da cidade (opcional)'),
            uf: str('UF, ex: RS')
          },
          ['documento', 'nome', 'cep', 'logradouro', 'numero', 'bairro', 'municipio', 'uf']
        ),
        itens: arr(
          obj({ produto_id: num('Id do produto no cadastro das Notas'), quantidade: num('Quantidade'), valor_unitario: num('Valor unitário cobrado'), descricao: str('Descrição se for diferente da do cadastro') }, ['produto_id', 'quantidade', 'valor_unitario']),
          'Itens da nota'
        ),
        pedido: str('Número do pedido (opcional)'),
        telefone_cliente: str('Telefone do cliente, para você mandar o PDF depois'),
        forma_pagamento: str('Código tPag (17 = PIX, 01 = dinheiro, 03 = crédito...). Padrão: o das Notas')
      },
      ['cliente', 'itens']
    ),
    run: (args = {}) => ag.criarRascunhoNf(args)
  },
  {
    name: 'nf_rascunhos',
    privado: true,
    description: 'Lista os rascunhos de nota e em que pé estão: aguardando (o Lucas ainda não viu), emitindo, emitida (com ref_pdf), corrigir, recusado ou erro.',
    parameters: obj({ estado: str('Filtrar por estado (opcional)') }),
    run: (args = {}) => ag.listarRascunhosNf(args)
  }
];
