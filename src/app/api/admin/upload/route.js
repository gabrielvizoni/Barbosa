import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exigirSessao } from '@/lib/auth';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB

// Uma pasta por tipo de imagem, só para organizar public/uploads.
const PASTAS_VALIDAS = new Set(['logo', 'barbeiros', 'servicos', 'produtos']);

/**
 * Descobre o tipo real do arquivo pelos primeiros bytes (assinatura/"magic
 * number"), em vez de confiar no Content-Type que o cliente declarou — assim
 * um arquivo renomeado/disfarçado não passa por imagem. Só os 4 formatos
 * abaixo são aceitos; qualquer outra coisa é rejeitada.
 */
function detectarExtensao(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export const POST = comLog('POST /api/admin/upload', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const form = await request.formData().catch(() => null);
  const arquivo = form?.get('arquivo');
  const pastaEnviada = form?.get('pasta');
  const pasta = typeof pastaEnviada === 'string' && PASTAS_VALIDAS.has(pastaEnviada) ? pastaEnviada : 'geral';

  if (!(arquivo instanceof File)) {
    return Response.json({ erro: 'Selecione uma imagem.' }, { status: 400 });
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    return Response.json({ erro: 'A imagem precisa ter até 5 MB.' }, { status: 400 });
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const extensao = detectarExtensao(bytes);
  if (!extensao) {
    return Response.json({ erro: 'Envie uma imagem JPG, PNG, WEBP ou GIF.' }, { status: 400 });
  }

  const nomeArquivo = `${crypto.randomUUID()}.${extensao}`;
  const dir = path.join(process.cwd(), 'public', 'uploads', pasta);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nomeArquivo), bytes);

  return Response.json({ url: `/uploads/${pasta}/${nomeArquivo}` }, { status: 201 });
});
