import {
  autenticacaoConfiguradaComSeguranca,
  criarSessao,
  senhaConfere,
  usandoSenhaInicial,
} from '@/lib/auth';
import {
  limiteAtingido,
  limiteGlobalAtingido,
  limparTentativas,
  obterIp,
  registrarTentativa,
} from '@/lib/limitador';

export const dynamic = 'force-dynamic';

// Só protege contra tentativa-e-erro simples — não é um cofre. Passado o
// limite, a janela desliza sozinha: ninguém fica bloqueado para sempre.
const JANELA_MINUTOS = 15;
const MAXIMO_TENTATIVAS = 8;

// Rede de segurança contra rotação de IP: 50 falhas em 15 min bloqueiam todo
// mundo por 60s, mesmo cada IP estando abaixo do próprio limite.
const CHAVE_GLOBAL = 'login:global';
const JANELA_GLOBAL_MINUTOS = 15;
const MAXIMO_GLOBAL = 50;
const BLOQUEIO_GLOBAL_SEGUNDOS = 60;

export async function POST(request) {
  if (!autenticacaoConfiguradaComSeguranca()) {
    return Response.json(
      {
        erro:
          'O painel está indisponível: falta configurar o servidor com segurança (SESSION_SECRET/ADMIN_PASSWORD). Avise quem cuida da hospedagem.',
      },
      { status: 503 }
    );
  }

  const chave = `login:${obterIp(request)}`;
  const bloqueado =
    limiteAtingido(chave, { janelaMinutos: JANELA_MINUTOS, maximo: MAXIMO_TENTATIVAS }) ||
    limiteGlobalAtingido(CHAVE_GLOBAL, {
      janelaMinutos: JANELA_GLOBAL_MINUTOS,
      maximo: MAXIMO_GLOBAL,
      bloqueioSegundos: BLOQUEIO_GLOBAL_SEGUNDOS,
    });
  if (bloqueado) {
    return Response.json(
      { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
      { status: 429 }
    );
  }

  const { senha } = await request.json().catch(() => ({}));
  if (!(await senhaConfere(senha))) {
    registrarTentativa(chave);
    registrarTentativa(CHAVE_GLOBAL);
    return Response.json({ erro: 'Senha incorreta.' }, { status: 401 });
  }

  limparTentativas(chave);
  criarSessao();
  return Response.json({ ok: true, senhaInicial: usandoSenhaInicial() });
}
