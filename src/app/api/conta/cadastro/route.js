import { cadastrarCliente, criarSessaoCliente } from "@/lib/cliente-auth";
import { limiteAtingido, obterIp, registrarTentativa } from "@/lib/limitador";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog, registrarAviso, registrarInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

const ROTA = "POST /api/conta/cadastro";
const JANELA_MINUTOS = 60;
const MAXIMO = 5;

export const POST = comLog(ROTA, async (request) => {
  const chave = `conta-cadastro:${obterIp(request)}`;
  if (
    limiteAtingido(chave, { janelaMinutos: JANELA_MINUTOS, maximo: MAXIMO })
  ) {
    registrarAviso(ROTA, "bloqueado por limite de tentativas");
    return Response.json(
      { erro: "Muitos cadastros em pouco tempo. Aguarde e tente de novo." },
      { status: 429 },
    );
  }
  registrarTentativa(chave);

  const corpo = await lerCorpoJson(request);
  if (!corpo) {
    return Response.json({ erro: "JSON inválido." }, { status: 400 });
  }

  const resultado = await cadastrarCliente({
    nome: corpo.nome,
    telefone: corpo.telefone,
    email: corpo.email,
    senha: corpo.senha,
  });
  if (!resultado.ok) {
    return Response.json({ erro: resultado.erro }, { status: 400 });
  }

  criarSessaoCliente(resultado.clienteId);
  registrarInfo(ROTA, "conta de cliente criada");
  return Response.json({ ok: true });
});
