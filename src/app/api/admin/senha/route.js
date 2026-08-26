import { exigirSessao, senhaConfere, trocarSenha } from '@/lib/auth';
import { lerCorpoJson } from '@/lib/requisicao';
import { comLog } from '@/lib/log';

export const dynamic = 'force-dynamic';

const MINIMO = 6;

export const POST = comLog('POST /api/admin/senha', async (request) => {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
  const { senhaAtual, novaSenha, confirmacao } = corpo;

  if (!(await senhaConfere(senhaAtual))) {
    return Response.json({ erro: 'A senha atual está incorreta.' }, { status: 400 });
  }

  const nova = String(novaSenha ?? '');
  if (nova.length < MINIMO) {
    return Response.json(
      { erro: `A senha nova precisa ter pelo menos ${MINIMO} caracteres.` },
      { status: 400 }
    );
  }
  if (nova !== String(confirmacao ?? '')) {
    return Response.json({ erro: 'A confirmação não bate com a senha nova.' }, { status: 400 });
  }
  if (await senhaConfere(nova)) {
    return Response.json({ erro: 'A senha nova é igual à atual.' }, { status: 400 });
  }

  await trocarSenha(nova);
  return Response.json({ ok: true });
});
