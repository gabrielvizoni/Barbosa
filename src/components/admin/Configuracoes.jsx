'use client';

import { useEffect, useState } from 'react';
import { api } from './base';
import { mascararTelefone, somenteDigitos } from '@/lib/format';

export default function Configuracoes({ avisar, tratarErro }) {
  const [config, setConfig] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api('config')
      .then((r) => setConfig(r.config))
      .catch(tratarErro);
  }, [tratarErro]);

  if (!config) return <p>Carregando…</p>;

  function mudar(chave, valor) {
    setConfig({ ...config, [chave]: valor });
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api('config', {
        method: 'PUT',
        body: { config: { ...config, whatsapp: somenteDigitos(config.whatsapp) } },
      });
      avisar('Configurações salvas.');
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Configurações</h1>
          <p>Dados da barbearia e as regras que o agendamento segue.</p>
        </div>
      </div>

      <section className="bloco">
        <h2>Identificação</h2>

        <label className="campo">
          <span>Nome da barbearia</span>
          <input
            className="entrada"
            value={config.nome_barbearia}
            onChange={(e) => mudar('nome_barbearia', e.target.value)}
          />
        </label>

        <label className="campo">
          <span>Frase de apresentação</span>
          <textarea
            className="entrada"
            value={config.slogan}
            onChange={(e) => mudar('slogan', e.target.value)}
          />
        </label>

        <div className="linha-campos">
          <label className="campo">
            <span>WhatsApp da barbearia</span>
            <input
              className="entrada mono"
              value={mascararTelefone(config.whatsapp)}
              onChange={(e) => mudar('whatsapp', e.target.value)}
              placeholder="(44) 99999-0000"
            />
          </label>
          <label className="campo">
            <span>Endereço</span>
            <input
              className="entrada"
              value={config.endereco}
              onChange={(e) => mudar('endereco', e.target.value)}
            />
          </label>
        </div>

        <div className="aviso">
          Sem esse número, o botão de confirmação no WhatsApp não aparece para o cliente no fim do
          agendamento.
        </div>
      </section>

      <section className="bloco">
        <h2>Regras do agendamento</h2>

        <div className="linha-campos">
          <label className="campo">
            <span>De quanto em quanto tempo</span>
            <select
              className="entrada"
              value={config.intervalo_min}
              onChange={(e) => mudar('intervalo_min', e.target.value)}
            >
              <option value="15">15 minutos</option>
              <option value="20">20 minutos</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
            </select>
          </label>

          <label className="campo">
            <span>Antecedência mínima</span>
            <select
              className="entrada"
              value={config.antecedencia_min}
              onChange={(e) => mudar('antecedencia_min', e.target.value)}
            >
              <option value="0">Sem antecedência</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
              <option value="120">2 horas</option>
              <option value="1440">1 dia</option>
            </select>
          </label>

          <label className="campo">
            <span>Quantos dias à frente</span>
            <select
              className="entrada"
              value={config.dias_futuros}
              onChange={(e) => mudar('dias_futuros', e.target.value)}
            >
              <option value="7">7 dias</option>
              <option value="15">15 dias</option>
              <option value="30">30 dias</option>
              <option value="60">60 dias</option>
            </select>
          </label>
        </div>

        <label className="caixa">
          <input
            type="checkbox"
            checked={config.confirmacao_automatica === '1'}
            onChange={(e) => mudar('confirmacao_automatica', e.target.checked ? '1' : '0')}
          />
          Marcar como confirmado assim que o cliente agenda
        </label>

        <p style={{ fontSize: 13.5, color: 'var(--tinta-suave)', marginTop: 10 }}>
          Desmarcado, todo agendamento entra como pendente e espera você confirmar na tela de
          Agendamentos.
        </p>
      </section>

      <button className="btn btn-ouro" onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar configurações'}
      </button>

      <section className="bloco" style={{ marginTop: 24 }}>
        <h2>Senha do painel</h2>
        <p style={{ margin: 0, color: 'var(--tinta-suave)', fontSize: 14.5 }}>
          A senha fica no arquivo <code className="mono">.env</code> do servidor, na variável{' '}
          <code className="mono">ADMIN_PASSWORD</code>. Para trocar, edite o arquivo e reinicie a
          aplicação.
        </p>
      </section>
    </>
  );
}
