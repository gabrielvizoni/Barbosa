'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/admin/base';
import VisaoGeral from '@/components/admin/VisaoGeral';
import AgendaVisual from '@/components/admin/AgendaVisual';
import Agendamentos from '@/components/admin/Agendamentos';
import Profissionais from '@/components/admin/Profissionais';
import Servicos from '@/components/admin/Servicos';
import Produtos from '@/components/admin/Produtos';
import Horarios from '@/components/admin/Horarios';
import Financeiro from '@/components/admin/Financeiro';
import Configuracoes from '@/components/admin/Configuracoes';
import {
  Caixa,
  Calendario,
  Casa,
  Dinheiro,
  Engrenagem,
  Equipe,
  Grafico,
  Pausa,
  Relogio,
  Sair,
  Tesoura,
} from '@/components/Icones';

const SECOES = [
  { id: 'visao', rotulo: 'Visão geral', Icone: Casa, Tela: VisaoGeral },
  { id: 'agenda', rotulo: 'Agenda do dia', Icone: Calendario, Tela: AgendaVisual },
  { id: 'agendamentos', rotulo: 'Agendamentos', Icone: Relogio, Tela: Agendamentos },
  { id: 'profissionais', rotulo: 'Profissionais', Icone: Equipe, Tela: Profissionais },
  { id: 'servicos', rotulo: 'Serviços', Icone: Tesoura, Tela: Servicos },
  { id: 'produtos', rotulo: 'Produtos', Icone: Caixa, Tela: Produtos },
  { id: 'horarios', rotulo: 'Horários e folgas', Icone: Pausa, Tela: Horarios },
  { id: 'financeiro', rotulo: 'Financeiro', Icone: Grafico, Tela: Financeiro },
  { id: 'config', rotulo: 'Configurações', Icone: Engrenagem, Tela: Configuracoes },
];

export default function PainelAdmin() {
  const [estado, setEstado] = useState('verificando'); // verificando | fora | dentro
  const [senha, setSenha] = useState('');
  const [erroLogin, setErroLogin] = useState('');
  const [entrando, setEntrando] = useState(false);

  const [secaoAtiva, setSecaoAtiva] = useState('visao');
  const [pendentes, setPendentes] = useState(0);
  const [recado, setRecado] = useState(null);

  useEffect(() => {
    fetch('/api/admin/sessao')
      .then((r) => r.json())
      .then((r) => setEstado(r.autenticado ? 'dentro' : 'fora'))
      .catch(() => setEstado('fora'));
  }, []);

  const avisar = useCallback((texto, tipo = 'ok') => {
    setRecado({ texto, tipo });
    setTimeout(() => setRecado(null), 3500);
  }, []);

  /** Um erro 401 significa sessão vencida: devolve para a tela de entrada. */
  const tratarErro = useCallback(
    (erro) => {
      if (erro?.status === 401) {
        setEstado('fora');
        avisar('Sua sessão expirou. Entre novamente.', 'erro');
      } else {
        avisar(erro?.message || 'Algo deu errado.', 'erro');
      }
    },
    [avisar]
  );

  const atualizarPendentes = useCallback(() => {
    api('resumo')
      .then((r) => setPendentes(r.pendentesTotal || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (estado === 'dentro') atualizarPendentes();
  }, [estado, secaoAtiva, atualizarPendentes]);

  async function entrar(evento) {
    evento.preventDefault();
    setErroLogin('');
    setEntrando(true);
    try {
      await api('login', { method: 'POST', body: { senha } });
      setSenha('');
      setEstado('dentro');
    } catch (erro) {
      setErroLogin(erro.message);
    } finally {
      setEntrando(false);
    }
  }

  async function sair() {
    await api('logout', { method: 'POST' }).catch(() => {});
    setEstado('fora');
  }

  if (estado === 'verificando') {
    return (
      <div className="portao">
        <p style={{ color: 'var(--creme)' }}>Carregando…</p>
      </div>
    );
  }

  if (estado === 'fora') {
    return (
      <div className="portao">
        <div className="portao-caixa">
          <div className="portao-topo">
            <span className="sobrenome">Painel administrativo</span>
            <h1>The Barbosa</h1>
          </div>
          <form className="portao-corpo" onSubmit={entrar}>
            {erroLogin ? <div className="aviso aviso-erro">{erroLogin}</div> : null}
            <label className="campo">
              <span>Senha</span>
              <input
                className="entrada"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
            </label>
            <button className="btn btn-verde btn-bloco" disabled={entrando}>
              {entrando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
        {recado ? (
          <div className={`recado ${recado.tipo === 'erro' ? 'erro' : ''}`}>{recado.texto}</div>
        ) : null}
      </div>
    );
  }

  const secao = SECOES.find((s) => s.id === secaoAtiva) || SECOES[0];
  const Tela = secao.Tela;

  return (
    <div className="admin">
      <nav className="lateral">
        <div className="lateral-topo">
          <span className="sobrenome">Painel</span>
          <strong>The Barbosa</strong>
        </div>

        <div className="lateral-menu">
          {SECOES.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              className={`item-menu ${id === secaoAtiva ? 'ativo' : ''}`}
              onClick={() => setSecaoAtiva(id)}
            >
              <Icone width={17} height={17} />
              {rotulo}
              {id === 'agendamentos' && pendentes > 0 ? (
                <span className="contador">{pendentes}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="lateral-base">
          <button className="item-menu" onClick={sair}>
            <Sair width={17} height={17} />
            Sair
          </button>
        </div>
      </nav>

      <main className="conteudo">
        <Tela avisar={avisar} tratarErro={tratarErro} aoMudar={atualizarPendentes} />
      </main>

      {recado ? (
        <div className={`recado ${recado.tipo === 'erro' ? 'erro' : ''}`}>{recado.texto}</div>
      ) : null}
    </div>
  );
}
