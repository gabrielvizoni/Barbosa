import { autenticarCliente, criarSessaoCliente } from "@/lib/cliente-auth";
import {
  limiteAtingido,
  limiteGlobalAtingido,
  limparTentativas,
  obterIp,
  registrarTentativa,
} from "@/lib/limitador";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog, registrarAviso, registrarInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/conta/login";

const JANELA_MINUTOS = 15;
const MAXIMO_TENTATIVAS = 10;

// Rede de segurança contra rotação de IP, como no login do painel.
const CHAVE_GLOBAL = "conta-login:global";
const JANELA_GLOBAL_MINUTOS = 15;
const MAXIMO_GLOBAL = 100;
const BLOQUEIO_GLOBAL_SEGUNDOS = 60;

export const POST = comLog(ROTA, async (request) => {
  const chave = `conta-login:${obterIp(request)}`;
  const bloqueado =
    limiteAtingido(chave, {
      janelaMinutos: JANELA_MINUTOS,
      maximo: MAXIMO_TENTATIVAS,
    }) ||
    limiteGlobalAtingido(CHAVE_GLOBAL, {
      janelaMinutos: JANELA_GLOBAL_MINUTOS,
      maximo: MAXIMO_GLOBAL,
      bloqueioSegundos: BLOQUEIO_GLOBAL_SEGUNDOS,
    });
  if (bloqueado) {
    registrarAviso(ROTA, "bloqueado por limite de tentativas");
    return Response.json(
      { erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
      { status: 429 },
    );
  }

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  const resultado = await autenticarCliente(corpo.email, corpo.senha);
  if (!resultado.ok) {
    registrarTentativa(chave);
    registrarTentativa(CHAVE_GLOBAL);
    registrarAviso(ROTA, "login de cliente falho");
    return Response.json(
      { erro: "E-mail ou senha incorretos." },
      { status: 401 },
    );
  }

  limparTentativas(chave);
  criarSessaoCliente(resultado.cliente.id);
  registrarInfo(ROTA, "login de cliente bem-sucedido");
  return Response.json({ ok: true });
});
