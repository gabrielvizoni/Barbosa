import { getDb, lerConfig } from "./db";

export const FUSO = process.env.TZ || "America/Sao_Paulo";

/** "HH:MM" -> minutos desde a meia-noite. */
export function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutos desde a meia-noite -> "HH:MM". */
export function paraHora(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Data/hora atual no fuso da barbearia, como { data: 'AAAA-MM-DD', minutos, diaSemana }. */
export function agora() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const partes = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const data = `${partes.year}-${partes.month}-${partes.day}`;
  const hora = partes.hour === "24" ? "00" : partes.hour;
  return {
    data,
    minutos: Number(hora) * 60 + Number(partes.minute),
    diaSemana: diaDaSemana(data),
  };
}

/** Dia da semana (0 = domingo) de uma data 'AAAA-MM-DD', sem sofrer com fuso. */
export function diaDaSemana(data) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Soma dias a uma data 'AAAA-MM-DD' e devolve outra data no mesmo formato. */
export function somarDias(data, dias) {
  const [a, m, d] = data.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

const DIAS_CURTOS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const DIAS_LONGOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MESES_CURTOS = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
];
const MESES_LONGOS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function rotuloDiaCurto(data) {
  return DIAS_CURTOS[diaDaSemana(data)];
}

export function rotuloDataLonga(data) {
  const [a, m, d] = data.split("-").map(Number);
  return `${DIAS_LONGOS[diaDaSemana(data)]}, ${d} de ${MESES_LONGOS[m - 1]} de ${a}`;
}

export function rotuloMesCurto(data) {
  return MESES_CURTOS[Number(data.split("-")[1]) - 1];
}

/**
 * Horários livres de um barbeiro em uma data, considerando:
 * o expediente daquele profissional no dia da semana, as folgas recorrentes
 * dele, a duração do serviço, os agendamentos já marcados, os bloqueios
 * (ausências pontuais) e a antecedência mínima configurada.
 */
export function horariosLivres({ barbeiroId, duracaoMin, data }) {
  const conn = getDb();
  const config = lerConfig();
  const passo = Math.max(5, Number(config.intervalo_min) || 30);
  const antecedencia = Math.max(0, Number(config.antecedencia_min) || 0);
  const duracao = Math.max(5, Number(duracaoMin) || 30);

  const diaSemana = diaDaSemana(data);

  const dia = conn
    .prepare(
      "SELECT aberto, abre, fecha FROM expediente_barbeiro WHERE barbeiro_id = ? AND dia = ?",
    )
    .get(barbeiroId, diaSemana);
  if (!dia || !dia.aberto) return [];

  const folga = conn
    .prepare(
      "SELECT 1 FROM folgas_recorrentes WHERE barbeiro_id = ? AND dia_semana = ?",
    )
    .get(barbeiroId, diaSemana);
  if (folga) return [];

  const abre = paraMinutos(dia.abre);
  const fecha = paraMinutos(dia.fecha);
  if (fecha <= abre) return [];

  const ocupados = conn
    .prepare(
      `SELECT inicio, fim FROM agendamentos
       WHERE data = ? AND barbeiro_id = ? AND status <> 'cancelado' AND excluido_em IS NULL`,
    )
    .all(data, barbeiroId)
    .map((a) => [paraMinutos(a.inicio), paraMinutos(a.fim)]);

  const bloqueios = conn
    .prepare(
      `SELECT inicio, fim FROM bloqueios
       WHERE data = ? AND (barbeiro_id IS NULL OR barbeiro_id = ?)`,
    )
    .all(data, barbeiroId)
    .map((b) => [paraMinutos(b.inicio), paraMinutos(b.fim)]);

  const intervalos = [...ocupados, ...bloqueios];
  const hoje = agora();
  const minimo = data === hoje.data ? hoje.minutos + antecedencia : -1;

  // Candidatos na grade fixa (a cada `passo` minutos) + o fim de cada
  // atendimento/bloqueio: sem isso, um atendimento que termina fora da
  // grade (ex.: 9h45, com passo de 30 min) esconde o tempo livre logo
  // depois dele até o próximo múltiplo do passo.
  const candidatos = new Set();
  for (let inicio = abre; inicio + duracao <= fecha; inicio += passo)
    candidatos.add(inicio);
  for (const [, f] of intervalos)
    if (f >= abre && f + duracao <= fecha) candidatos.add(f);

  const livres = [];
  for (const inicio of [...candidatos].sort((a, b) => a - b)) {
    if (inicio < minimo) continue;
    const fim = inicio + duracao;
    const conflita = intervalos.some(([i, f]) => inicio < f && fim > i);
    if (!conflita) livres.push(paraHora(inicio));
  }
  return livres;
}

/**
 * Datas dos próximos dias com atendimento — sempre tenta entregar
 * `quantidade` datas de verdade (pulando os dias fechados), até um teto de
 * segurança para não rodar para sempre se a semana inteira estiver fechada.
 *
 * Com `barbeiroId`, considera só o expediente e as folgas recorrentes
 * daquele profissional. Sem ele, devolve a união dos profissionais ativos:
 * um dia entra se ao menos um deles atende nele.
 */
export function diasDisponiveis(quantidade = 30, barbeiroId = null) {
  const conn = getDb();

  let abertoNoDia;
  if (barbeiroId) {
    const expediente = conn
      .prepare(
        "SELECT dia, aberto FROM expediente_barbeiro WHERE barbeiro_id = ?",
      )
      .all(barbeiroId);
    const folgas = new Set(
      conn
        .prepare(
          "SELECT dia_semana FROM folgas_recorrentes WHERE barbeiro_id = ?",
        )
        .all(barbeiroId)
        .map((f) => f.dia_semana),
    );
    abertoNoDia = new Map(
      expediente.map((e) => [e.dia, e.aberto && !folgas.has(e.dia) ? 1 : 0]),
    );
  } else {
    const uniao = conn
      .prepare(
        `SELECT eb.dia,
                MAX(CASE WHEN eb.aberto = 1 AND fr.dia_semana IS NULL THEN 1 ELSE 0 END) AS aberto
         FROM expediente_barbeiro eb
         JOIN barbeiros b ON b.id = eb.barbeiro_id AND b.ativo = 1
         LEFT JOIN folgas_recorrentes fr
           ON fr.barbeiro_id = eb.barbeiro_id AND fr.dia_semana = eb.dia
         GROUP BY eb.dia`,
      )
      .all();
    abertoNoDia = new Map(uniao.map((e) => [e.dia, e.aberto]));
  }

  const hoje = agora().data;
  const datas = [];
  const tetoDeDiasVarridos = Math.max(quantidade * 3, 180);
  for (let i = 0; datas.length < quantidade && i < tetoDeDiasVarridos; i += 1) {
    const data = somarDias(hoje, i);
    if (abertoNoDia.get(diaDaSemana(data))) datas.push(data);
  }
  return datas;
}
