import {
  criarSessao,
  senhaConfere,
  sessaoConfiguradaComSeguranca,
  usandoSenhaInicial,
} from '@/lib/auth';
import { limiteAtingido, limparTentativas, obterIp, registrarTentativa } from '@/lib/limitador';

export const dynamic = 'force-dynamic';

// Só protege contra tentativa-e-erro simples — não é um cofre. Passado o
// limite, a janela desliza sozinha: ninguém fica bloqueado para sempre.
const JANELA_MINUTOS = 15;
const MAXIMO_TENTATIVAS = 8;

export async function POST(request) {
  if (!sessaoConfiguradaComSeguranca()) {
    return Response.json(
      {
        erro:
          'O painel está indisponível: falta configurar SESSION_SECRET no servidor. Avise quem cuida da hospedagem.',
      },
      { status: 503 }
    );
  }

  const chave = `login:${obterIp(request)}`;
  if (limiteAtingido(chave, { janelaMinutos: JANELA_MINUTOS, maximo: MAXIMO_TENTATIVAS })) {
    return Response.json(
      { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
      { status: 429 }
    );
  }

  const { senha } = await request.json().catch(() => ({}));
  if (!senhaConfere(senha)) {
    registrarTentativa(chave);
    return Response.json({ erro: 'Senha incorreta.' }, { status: 401 });
  }

  limparTentativas(chave);
  criarSessao();
  return Response.json({ ok: true, senhaInicial: usandoSenhaInicial() });
}
