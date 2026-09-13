#!/usr/bin/env node
//
// Enviador de artes da Classul.
//
// Fica de olho numa pasta do seu computador. Quando você salva um arquivo lá
// (o .cdr do CorelDRAW, por exemplo), ele sobe sozinho para o sistema.
//
// Se o nome começar com o número do pedido ("0042 - dona marta.cdr"), o
// arquivo já entra anexado naquele pedido. Senão, cai na aba Recebidos para
// você escolher o pedido com um clique.
//
// Não usa nenhuma biblioteca externa: só o Node.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(AQUI, 'config.json');
const ESTADO_PATH = path.join(AQUI, '.enviados.json');

// Só sobe o arquivo depois que ele parar de mudar por este tempo — o CorelDRAW
// grava várias vezes enquanto você trabalha, e não queremos subir pela metade.
const SEGUNDOS_PARADO_PADRAO = 8;
const INTERVALO_MS_PADRAO = 4000;
// Arquivos temporários que programas de arte deixam para trás.
const IGNORAR = [/^~/, /^\./, /\.tmp$/i, /\.bak$/i, /\.crdownload$/i, /\.part$/i];

function log(msg) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${hora}] ${msg}`);
}

function lerJSON(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return padrao;
  }
}

function carregarConfig() {
  const config = lerJSON(CONFIG_PATH, null);
  if (!config) {
    const exemplo = {
      apiUrl: 'https://sistema-classul.vercel.app',
      apiToken: 'a senha do sistema (a mesma que você usa para entrar)',
      pasta: os.platform() === 'win32' ? 'C:\\\\Classul\\\\Artes' : path.join(os.homedir(), 'Classul', 'Artes')
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(exemplo, null, 2));
    console.log(
      `\nCriei o arquivo de configuração:\n  ${CONFIG_PATH}\n\n` +
        'Abra ele, preencha a senha do sistema e confirme a pasta. Depois rode de novo.\n'
    );
    process.exit(1);
  }
  if (!config.apiToken || config.apiToken.startsWith('a senha')) {
    console.log(`\nFalta preencher a senha do sistema em:\n  ${CONFIG_PATH}\n`);
    process.exit(1);
  }
  config.apiUrl = String(config.apiUrl || '').replace(/\/+$/, '');
  config.segundosParado = Number(config.segundosParado ?? SEGUNDOS_PARADO_PADRAO);
  config.intervaloMs = Number(config.intervaloMs ?? INTERVALO_MS_PADRAO);
  return config;
}

async function api(config, caminho, opcoes = {}) {
  const res = await fetch(`${config.apiUrl}${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiToken}`,
      ...(opcoes.headers || {})
    }
  });
  const dados = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Senha do sistema incorreta — confira o config.json.');
  if (!res.ok) throw new Error(dados.error || `Erro ${res.status} no sistema.`);
  return dados;
}

const TIPOS = {
  '.cdr': 'application/x-coreldraw',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ai': 'application/postscript',
  '.eps': 'application/postscript',
  '.svg': 'image/svg+xml',
  '.psd': 'image/vnd.adobe.photoshop'
};

async function enviar(config, arquivo) {
  const nome = path.basename(arquivo);
  const tamanho = fs.statSync(arquivo).size;
  const mimeType = TIPOS[path.extname(nome).toLowerCase()] || 'application/octet-stream';

  // 1. pede a URL de upload (o sistema decide se vai para um pedido ou para Recebidos)
  const sessao = await api(config, '/api/uploads/session', {
    method: 'POST',
    body: JSON.stringify({ name: nome, mimeType, size: tamanho })
  });

  // 2. manda o arquivo DIRETO para o Google (não passa pelo servidor: sem limite de tamanho)
  const envio = await fetch(sessao.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(tamanho) },
    body: fs.readFileSync(arquivo)
  });
  if (!envio.ok) throw new Error(`O Google recusou o arquivo (${envio.status}).`);
  const enviado = await envio.json();

  // 3. registra no sistema
  const registro = await api(config, '/api/uploads/register', {
    method: 'POST',
    body: JSON.stringify({ file_id: enviado.id, order_id: sessao.order_id, source: os.hostname() })
  });

  return { destino: sessao.target, substituiu: registro.replaced || 0 };
}

function deveIgnorar(nome) {
  return IGNORAR.some((re) => re.test(nome));
}

async function main() {
  const config = carregarConfig();

  if (!fs.existsSync(config.pasta)) {
    fs.mkdirSync(config.pasta, { recursive: true });
    log(`Criei a pasta ${config.pasta}`);
  }

  const enviados = lerJSON(ESTADO_PATH, {});
  const vistos = new Map(); // arquivo -> { tamanho, desde }

  log('Enviador de artes da Classul no ar.');
  log(`Vigiando: ${config.pasta}`);
  log('Salve o .cdr aqui. Comece o nome com o número do pedido para anexar direto (ex: "0042 - dona marta.cdr").');
  log('Para parar, feche esta janela.');

  const varrer = async () => {
    let arquivos;
    try {
      arquivos = fs.readdirSync(config.pasta, { withFileTypes: true });
    } catch (err) {
      log(`Não consegui ler a pasta: ${err.message}`);
      return;
    }

    for (const item of arquivos) {
      if (!item.isFile() || deveIgnorar(item.name)) continue;
      const caminho = path.join(config.pasta, item.name);

      let stat;
      try {
        stat = fs.statSync(caminho);
      } catch {
        continue;
      }

      const assinatura = `${stat.size}-${Math.round(stat.mtimeMs)}`;
      if (enviados[item.name] === assinatura) continue; // já subiu esta versão

      const anterior = vistos.get(caminho);
      if (!anterior || anterior.assinatura !== assinatura) {
        // mudou (ou apareceu agora): espera estabilizar
        vistos.set(caminho, { assinatura, desde: Date.now() });
        continue;
      }
      if (Date.now() - anterior.desde < config.segundosParado * 1000) continue;

      try {
        log(`Enviando "${item.name}"…`);
        const { destino, substituiu } = await enviar(config, caminho);
        enviados[item.name] = assinatura;
        fs.writeFileSync(ESTADO_PATH, JSON.stringify(enviados, null, 2));
        vistos.delete(caminho);
        log(`✓ "${item.name}" → ${destino}${substituiu ? ' (substituiu a versão anterior)' : ''}`);
      } catch (err) {
        log(`✗ "${item.name}": ${err.message}`);
        // tenta de novo na próxima volta
        vistos.set(caminho, { assinatura, desde: Date.now() });
      }
    }
  };

  await varrer();
  setInterval(varrer, config.intervaloMs);
}

main().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
