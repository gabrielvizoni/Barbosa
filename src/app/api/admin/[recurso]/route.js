import { exigirSessao } from '@/lib/auth';
import { getDb, definirBarbeirosDoServico, listarBloqueios, listarServicos } from '@/lib/db';
import { primeiroErro, validar } from '@/lib/validacao';

export const dynamic = 'force-dynamic';

/**
 * Um único endereço serve os quatro cadastros do painel.
 * Cada recurso declara suas colunas — nada fora dessa lista chega ao banco.
 */
export const RECURSOS = {
  barbeiros: {
    tabela: 'barbeiros',
    colunas: ['nome', 'funcao', 'bio', 'foto', 'ativo', 'ordem'],
    numericas: ['ativo', 'ordem'],
    ordem: 'ordem, id',
  },
  servicos: {
    tabela: 'servicos',
    colunas: [
      'nome',
      'descricao',
      'categoria',
      'preco_centavos',
      'duracao_min',
      'imagem',
      'ativo',
      'ordem',
    ],
    numericas: ['preco_centavos', 'duracao_min', 'ativo', 'ordem'],
    ordem: 'ordem, id',
  },
  produtos: {
    tabela: 'produtos',
    colunas: ['nome', 'marca', 'preco_centavos', 'estoque', 'imagem', 'ativo'],
    numericas: ['preco_centavos', 'estoque', 'ativo'],
    ordem: 'id DESC',
  },
  bloqueios: {
    tabela: 'bloqueios',
    colunas: ['barbeiro_id', 'data', 'inicio', 'fim', 'motivo'],
    numericas: ['barbeiro_id'],
    ordem: 'data DESC, inicio',
  },
};

/**
 * Só devolve um recurso se `nome` for uma chave própria de RECURSOS — usar
 * `RECURSOS[nome]` direto aceitaria nomes herdados de Object.prototype
 * (`constructor`, `toString`, `hasOwnProperty`...), que são sempre "truthy"
 * e derrubariam a rota com 500 em vez de devolver 404.
 */
export function obterRecurso(nome) {
  return Object.hasOwn(RECURSOS, nome) ? RECURSOS[nome] : null;
}

/** Mantém só as colunas conhecidas e converte números. */
export function filtrarCampos(recurso, corpo) {
  const campos = {};
  for (const coluna of recurso.colunas) {
    if (!(coluna in corpo)) continue;
    let valor = corpo[coluna];
    if (recurso.numericas.includes(coluna)) {
      if (valor === null || valor === '') {
        valor = coluna === 'barbeiro_id' ? null : 0;
      } else if (typeof valor === 'boolean') {
        valor = valor ? 1 : 0;
      } else {
        valor = Number(valor);
        if (!Number.isFinite(valor)) valor = 0;
      }
    } else {
      valor = String(valor ?? '').trim();
    }
    campos[coluna] = valor;
  }
  return campos;
}

export async function GET(request, { params }) {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const recurso = obterRecurso(params.recurso);
  if (!recurso) return Response.json({ erro: 'Cadastro não encontrado.' }, { status: 404 });

  if (params.recurso === 'servicos') return Response.json({ itens: listarServicos() });
  if (params.recurso === 'bloqueios') return Response.json({ itens: listarBloqueios() });

  const itens = getDb()
    .prepare(`SELECT * FROM ${recurso.tabela} ORDER BY ${recurso.ordem}`)
    .all();
  return Response.json({ itens });
}

export async function POST(request, { params }) {
  const negado = exigirSessao(request);
  if (negado) return negado;

  const recurso = obterRecurso(params.recurso);
  if (!recurso) return Response.json({ erro: 'Cadastro não encontrado.' }, { status: 404 });

  const corpo = await request.json().catch(() => ({}));
  const campos = filtrarCampos(recurso, corpo);

  const { ok, erros } = validar(params.recurso, campos, { criando: true });
  if (!ok) {
    return Response.json({ erro: primeiroErro(erros), erros }, { status: 400 });
  }

  const colunas = Object.keys(campos);
  if (colunas.length === 0) {
    return Response.json({ erro: 'Nada para salvar.' }, { status: 400 });
  }

  const resultado = getDb()
    .prepare(
      `INSERT INTO ${recurso.tabela} (${colunas.join(', ')})
       VALUES (${colunas.map(() => '?').join(', ')})`
    )
    .run(...colunas.map((c) => campos[c]));

  const id = Number(resultado.lastInsertRowid);
  if (params.recurso === 'servicos' && Array.isArray(corpo.barbeiros)) {
    definirBarbeirosDoServico(id, corpo.barbeiros);
  }

  return Response.json({ id }, { status: 201 });
}
