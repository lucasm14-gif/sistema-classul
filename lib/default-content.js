// Conteúdo padrão usado para semear o banco na primeira execução.
// A partir daí, a fonte da verdade é a tabela `quick_messages`, editável
// pela aba Extensão do sistema.

export const DEFAULT_QUICK_MESSAGES = [
{
        id: 1,
        title: 'Saudação Inicial',
        text: 'Olá! Tudo bem? Como posso ajudar você hoje?'
    },
    {
        id: 2,
        title: 'Endereço',
        text: 'Rua Carlos Von Koseritiz, 63 - Bairro São João - Conj 1 -  90540-031'
    },
    {
        id: 3,
        title: 'Avaliação Google',
        text: 'Queremos saber como foi a sua experiência com a Classul! Sua opinião é muito importante para nós.\n\nSe puder, deixe uma avaliação no Google. Isso nos ajuda a continuar oferecendo um atendimento de qualidade! 🙌\n\nÉ só clicar no link abaixo e compartilhar seu feedback:\n🔗 https://g.page/r/CdrHqDugZPp5EBE/review\n\nAgradecemos muito pelo seu tempo e confiança!'
    },
    {
        id: 4,
        title: 'Horário de Atendimento',
        text: 'Nosso horário de atendimento é de segunda a sexta, das 9h às 12h / 13h30 até 18h.\nFinais de semana e feriados não atendemos.'
    },
    {
        id: 5,
        title: 'Dados Cadastrais',
        text: `📋 DADOS CADASTRAIS

Razão Social: CLASSUL IND. E COM. DE PLACAS E BRINDES LTDA - ME
Nome Fantasia: BRINDIDÉIAS
CNPJ: 18.605.962/0001-30

Insc. Estadual: 096/3547283
Insc. Municipal: 559.644.2.7

Endereço: Rua Carlos Von Koseritiz, Nº 63
Complemento: Apt 1
Cidade: PORTO ALEGRE - RS
CEP: 90540-031

Fones: (51) 3062.3965 - 3225.3965 - 3013.3965
WebSite: WWW.CLASSUL.COM.BR
E-mails: CLASSUL@CLASSUL.COM.BR - CLASSULRS@GMAIL.COM
WhatsApp: (51) 98927.4761

💰 DADOS BANCÁRIOS

PIX / CHAVE Bco Itaú: CNPJ ➜ 18.605.962/0001-30

BANCO: 341 - ITAÚ
AGÊNCIA: 6201
CONTA: 50305-6

BANCO: 041 - BANRISUL
AGÊNCIA: 0062
CONTA: 06061233.0-8`
    },
    {
        id: 6,
        title: 'PIX CNPJ',
        text: 'Pix CNPJ: 18605962000130'
    },
    {
        id: 7,
        title: 'Código de Coleta',
        text: 'Ao solicitar a coleta, informe o código: CL-'
    }
];

// Catálogo inicial de produtos. `has_size` liga a tabela de medidas de placa;
// `is_case` marca o estojo vendido sozinho (sem placa).
export const DEFAULT_CATALOG = [
  { name: 'Placa de Homenagem', short_label: 'Homenagem', has_size: 1, is_case: 0 },
  { name: 'Plaqueta Militar (EB)', short_label: 'Militar', has_size: 0, is_case: 0 },
  { name: 'Placa de Inauguração', short_label: 'Inauguração', has_size: 1, is_case: 0 },
  { name: 'Placa Quadro Parede', short_label: 'Quadro', has_size: 1, is_case: 0 },
  { name: 'Placa para Jazigo', short_label: 'Jazigo', has_size: 1, is_case: 0 },
  { name: 'Placa Inox Escovado', short_label: 'Inox', has_size: 1, is_case: 0 },
  { name: 'Troféu', short_label: 'Troféu', has_size: 0, is_case: 0 },
  { name: 'Medalhas', short_label: 'Medalhas', has_size: 0, is_case: 0 },
  { name: 'Pins e Botons', short_label: 'Pins', has_size: 0, is_case: 0 },
  { name: 'Estojo avulso', short_label: 'Estojo', has_size: 1, is_case: 1 },
  { name: 'Outro', short_label: 'Outro', has_size: 0, is_case: 0 }
];

// Opções estáveis servidas junto do catálogo, para o sistema e a extensão
// lerem do mesmo lugar.
export const CASE_COLORS = ['Preto', 'Azul', 'Vermelho'];

// Medidas em cm da PLACA. No estojo avulso, é a placa que cabe dentro dele.
export const PLATE_SIZES = ['9x14', '12x17', '14x20', '16x25', '20x30'];

// Como a peça é produzida (não confundir com o produto).
export const PRODUCT_TYPES = ['Maquina', 'Jota', 'Sublimação'];
