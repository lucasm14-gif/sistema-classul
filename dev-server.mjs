// Roda localmente a mesma API serverless da Vercel + o build do frontend.
// Usa o banco do .env (Supabase). Uso: node dev-server.mjs
import fs from 'fs';
import path from 'path';

for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { default: app } = await import('./api/index.js');
const { default: express } = await import('express');

const dist = path.resolve('./web/dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));

const PORT = process.env.DEV_PORT || 3010;
app.listen(PORT, () => console.log(`Classul (dev) rodando em http://localhost:${PORT}`));
