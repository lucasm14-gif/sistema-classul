// Certificado digital A1 (arquivo .pfx) da empresa.
//
// O .pfx e a senha ficam no banco CRIPTOGRAFADOS (AES-256-GCM) com uma chave derivada
// do segredo do servidor (APP_SECRET/API_TOKEN, que nunca vai para o banco). Quem tiver
// só o banco não consegue usar o certificado.
//
// O node-forge abre o .pfx porque os certificados ICP-Brasil costumam vir com
// criptografia antiga (RC2-40) que o OpenSSL 3 do Node recusa.
import crypto from 'crypto';
import forge from 'node-forge';

const secret = () => process.env.APP_SECRET || process.env.API_TOKEN || 'classul';
const keyFor = () => crypto.createHash('sha256').update(`${secret()}:nfe-cert`).digest();

export class CertError extends Error {}

export function encryptCert(pfxBase64, password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ pfx: pfxBase64, password }), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptCert(blob) {
  const [iv, tag, data] = String(blob || '').split('.').map((s) => Buffer.from(s, 'base64'));
  if (!iv || !tag || !data) throw new CertError('Certificado não configurado.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  } catch {
    throw new CertError('Não foi possível abrir o certificado guardado. Envie o arquivo .pfx de novo.');
  }
}

// Abre o .pfx e devolve chave e certificado em PEM + dados para mostrar na tela.
export function openPfx(pfxBase64, password) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.decode64(pfxBase64));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    if (/password|mac|Invalid/i.test(String(err?.message))) throw new CertError('Senha do certificado incorreta.');
    throw new CertError('Arquivo de certificado inválido. Envie o .pfx do certificado A1.');
  }
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  if (!keyBag?.key) throw new CertError('O arquivo não tem a chave privada (exporte "com a chave privada").');
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert);
  // O certificado da empresa é o que casa com a chave privada (o arquivo pode trazer a cadeia junto).
  const pub = forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e);
  const pubPem = forge.pki.publicKeyToPem(pub);
  const cert = certs.find((c) => forge.pki.publicKeyToPem(c.publicKey) === pubPem) || certs[0];
  if (!cert) throw new CertError('O arquivo não tem o certificado.');

  const certPem = forge.pki.certificateToPem(cert);
  const certB64 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const cn = cert.subject.getField('CN')?.value || '';
  const cnpj = (cn.match(/:(\d{14})$/) || [])[1] || '';
  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem,
    certB64,
    // Cadeia intermediária, se veio no arquivo (vai junto no TLS).
    chainPem: certs.filter((c) => c !== cert).map((c) => forge.pki.certificateToPem(c)).join(''),
    info: {
      nome: cn.replace(/:\d{14}$/, ''),
      cnpj,
      emissor: cert.issuer.getField('CN')?.value || '',
      valido_de: cert.validity.notBefore.toISOString(),
      valido_ate: cert.validity.notAfter.toISOString()
    }
  };
}

// Cache por instância da função: abrir o .pfx custa ~100ms.
let cached = { blob: null, opened: null };
export function certFromBlob(blob) {
  if (cached.blob === blob && cached.opened) return cached.opened;
  const { pfx, password } = decryptCert(blob);
  const opened = openPfx(pfx, password);
  cached = { blob, opened };
  return opened;
}
