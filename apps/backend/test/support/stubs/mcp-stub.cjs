// TEST-ONLY: servidor MCP mínimo (stdio, JSON-RPC por linha). Grava o ambiente recebido no arquivo do 1º argumento.
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify({ TOKEN_X: process.env.TOKEN_X ?? null, MODO: process.env.MODO ?? null }));
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const linha = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!linha.trim()) continue;
    const m = JSON.parse(linha);
    const responder = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
    if (m.method === 'initialize') responder({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'eco', version: '1' } });
    else if (m.method === 'tools/list') responder({ tools: [{ name: 'eco', description: 'Devolve o texto recebido', inputSchema: { type: 'object' } }] });
  }
});
