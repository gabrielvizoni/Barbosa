// Validação central de faixa/formato para os cadastros do painel.
//
// filtrarCampos() em src/app/api/admin/[recurso]/route.js já faz whitelist
// de coluna e coerção de tipo, mas não valida faixa nem formato de nada.
// Consequência real: duracao_min = 0 era aceito, o agendamento nascia com
// fim === inicio, e a checagem de conflito (inicio < f && fim > i) nunca
// disparava — permitindo infinitos agendamentos no mesmo minuto.

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{2}:\d{2}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textoValido(valor, { max }) {
  const texto = String(valor ?? "");
  if (texto.length > max) return `não pode passar de ${max} caracteres.`;
  return null;
}

function inteiroEntre(min, max) {
  return (valor) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || !Number.isInteger(numero)) {
      return "precisa ser um número inteiro.";
    }
    if (numero < min || numero > max)
      return `precisa estar entre ${min} e ${max}.`;
    return null;
  };
}

/** "AAAA-MM-DD" com parse real — 2024-02-30 não é uma data válida, mesmo no formato certo. */
export function dataValida(valor) {
  const texto = String(valor ?? "");
  if (!RE_DATA.test(texto)) return "precisa estar no formato AAAA-MM-DD.";
  const [ano, mes, dia] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const valida =
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia;
  return valida ? null : "não é uma data válida.";
}

/** "HH:MM", com hora e minuto dentro da faixa (99:99 tem o formato certo, mas não é hora). */
export function horaValida(valor) {
  const texto = String(valor ?? "");
  if (!RE_HORA.test(texto)) return "precisa estar no formato HH:MM.";
  const [h, m] = texto.split(":").map(Number);
  return h <= 23 && m <= 59 ? null : "não é um horário válido.";
}

/** E-mail em formato razoável. Vazio é aceito — nem todo barbeiro tem e-mail cadastrado ainda. */
export function emailValido(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  if (texto.length > 160) return "não pode passar de 160 caracteres.";
  return RE_EMAIL.test(texto) ? null : "não é um e-mail válido.";
}

const ESQUEMAS = {
  barbeiros: {
    obrigatorios: ["nome"],
    campos: {
      nome: (v) => textoValido(v, { max: 80 }),
      funcao: (v) => textoValido(v, { max: 60 }),
      bio: (v) => textoValido(v, { max: 500 }),
      foto: (v) => textoValido(v, { max: 300 }),
      ordem: inteiroEntre(0, 9999),
      email: emailValido,
    },
  },
  servicos: {
    obrigatorios: ["nome"],
    campos: {
      nome: (v) => textoValido(v, { max: 80 }),
      descricao: (v) => textoValido(v, { max: 500 }),
      categoria: (v) => textoValido(v, { max: 60 }),
      preco_centavos: inteiroEntre(0, 10_000_000),
      duracao_min: inteiroEntre(5, 480),
      imagem: (v) => textoValido(v, { max: 300 }),
      ordem: inteiroEntre(0, 9999),
    },
  },
  produtos: {
    obrigatorios: ["nome"],
    campos: {
      nome: (v) => textoValido(v, { max: 80 }),
      marca: (v) => textoValido(v, { max: 60 }),
      preco_centavos: inteiroEntre(0, 10_000_000),
      estoque: inteiroEntre(0, 100_000),
      imagem: (v) => textoValido(v, { max: 300 }),
    },
  },
  bloqueios: {
    obrigatorios: ["data", "inicio", "fim"],
    campos: {
      data: dataValida,
      inicio: horaValida,
      fim: horaValida,
      motivo: (v) => textoValido(v, { max: 200 }),
    },
  },
  // Usado por src/lib/agendamentos.js — só o formato de data/hora; a regra de
  // conflito de horário (que depende de barbeiro/expediente) fica lá.
  agendamentos: {
    obrigatorios: ["data", "inicio"],
    campos: {
      data: dataValida,
      inicio: horaValida,
    },
  },
};

/**
 * Valida `campos` (já filtrados/coeridos por filtrarCampos()) contra o
 * esquema de `recurso`. `criando: true` (POST) também cobra a presença dos
 * campos obrigatórios; no PATCH cada campo só é validado se foi enviado.
 */
export function validar(recurso, campos, { criando = false } = {}) {
  const esquema = ESQUEMAS[recurso];
  if (!esquema) return { ok: true, erros: {} };

  const erros = {};

  if (criando) {
    for (const campo of esquema.obrigatorios || []) {
      if (!campos[campo]) erros[campo] = "é obrigatório.";
    }
  }

  for (const [campo, validador] of Object.entries(esquema.campos)) {
    if (erros[campo] || !(campo in campos)) continue;
    const mensagem = validador(campos[campo], campos);
    if (mensagem) erros[campo] = mensagem;
  }

  if (
    recurso === "bloqueios" &&
    !erros.inicio &&
    !erros.fim &&
    campos.fim <= campos.inicio
  ) {
    erros.fim = "precisa ser depois do início.";
  }

  return { ok: Object.keys(erros).length === 0, erros };
}

/** Primeira mensagem de erro, pronta para exibir — "campo: mensagem". */
export function primeiroErro(erros) {
  const [campo, mensagem] = Object.entries(erros)[0] || [];
  return campo ? `${campo}: ${mensagem}` : null;
}

/**
 * Confere fecha > abre em cada dia do expediente enviado — hoje o PUT de
 * /api/admin/config só checa o formato HH:MM; salvar 20:00→09:00 passava
 * batido e deixava a agenda daquele dia vazia sem nenhum erro visível.
 */
export function validarExpediente(dias) {
  const erros = dias
    .filter((d) => d.fecha <= d.abre)
    .map((d) => ({
      dia: d.dia,
      mensagem: "O fechamento precisa ser depois da abertura.",
    }));
  return { ok: erros.length === 0, erros };
}
