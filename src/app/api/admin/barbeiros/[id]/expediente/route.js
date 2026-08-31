import { exigirSessao } from "@/lib/auth";
import {
  buscarBarbeiroPorId,
  definirFolgasRecorrentes,
  getDb,
  lerExpedienteBarbeiro,
  listarFolgasRecorrentes,
  salvarExpedienteBarbeiro,
} from "@/lib/db";
import { validarExpediente } from "@/lib/validacao";
import { lerCorpoJson } from "@/lib/requisicao";
import { comLog } from "@/lib/log";
import { registrarAuditoria } from "@/lib/auditoria";

export const dynamic = "force-dynamic";

const RE_HORA = /^\d{2}:\d{2}$/;

/** Devolve o profissional pelo id de rota, ou uma Response 404. */
function acharBarbeiro(params) {
  const id = Number(params.id);
  if (!id)
    return {
      erro: Response.json(
        { erro: "Profissional não encontrado." },
        { status: 404 },
      ),
    };
  const barbeiro = buscarBarbeiroPorId(id);
  if (!barbeiro) {
    return {
      erro: Response.json(
        { erro: "Profissional não encontrado." },
        { status: 404 },
      ),
    };
  }
  return { id, barbeiro };
}

export const GET = comLog(
  "GET /api/admin/barbeiros/[id]/expediente",
  async (request, { params }) => {
    const negado = exigirSessao(request);
    if (negado) return negado;

    const { id, erro } = acharBarbeiro(params);
    if (erro) return erro;

    return Response.json({
      expediente: lerExpedienteBarbeiro(id),
      folgas: listarFolgasRecorrentes(id),
    });
  },
);

export const PUT = comLog(
  "PUT /api/admin/barbeiros/[id]/expediente",
  async (request, { params }) => {
    const negado = exigirSessao(request);
    if (negado) return negado;

    const { id, erro } = acharBarbeiro(params);
    if (erro) return erro;

    const corpo = await lerCorpoJson(request);
    if (!corpo) {
      return Response.json({ erro: "JSON inválido." }, { status: 400 });
    }

    let dias = null;
    if (Array.isArray(corpo.expediente)) {
      dias = corpo.expediente
        .filter((d) => Number.isInteger(Number(d.dia)))
        .map((d) => ({
          dia: Number(d.dia),
          aberto: d.aberto ? 1 : 0,
          abre: RE_HORA.test(d.abre) ? d.abre : "09:00",
          fecha: RE_HORA.test(d.fecha) ? d.fecha : "20:00",
        }))
        .filter((d) => d.dia >= 0 && d.dia <= 6);

      const { ok, erros } = validarExpediente(dias);
      if (!ok) {
        return Response.json(
          {
            erro: `Expediente inválido: ${erros.map((e) => e.mensagem).join(" ")}`,
          },
          { status: 400 },
        );
      }
    }

    let folgas = null;
    if (Array.isArray(corpo.folgas)) {
      folgas = corpo.folgas
        .map(Number)
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    }

    if (!dias && !folgas) {
      return Response.json({ erro: "Nada para salvar." }, { status: 400 });
    }

    if (dias) salvarExpedienteBarbeiro(id, dias);
    if (folgas) definirFolgasRecorrentes(id, folgas);

    registrarAuditoria(getDb(), {
      acao: "salvar_expediente",
      tabela: "expediente_barbeiro",
      registroId: id,
      depois: {
        ...(dias ? { expediente: dias } : {}),
        ...(folgas ? { folgas } : {}),
      },
    });

    return Response.json({
      expediente: lerExpedienteBarbeiro(id),
      folgas: listarFolgasRecorrentes(id),
    });
  },
);
