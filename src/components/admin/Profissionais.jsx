"use client";

import { useCallback, useEffect, useState } from "react";
import { api, CampoImagem, Modal, ModalConfirmacao, Vazio } from "./base";
import { iniciais } from "@/lib/format";
import { Lapis, Lixeira, Mais } from "@/components/Icones";

const VAZIO = { nome: "", funcao: "", bio: "", foto: "", ativo: 1, ordem: 0 };

export default function Profissionais({ avisar, tratarErro }) {
  const [itens, setItens] = useState([]);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(null);

  const carregar = useCallback(() => {
    api("barbeiros")
      .then((r) => setItens(r.itens))
      .catch(tratarErro);
  }, [tratarErro]);

  useEffect(carregar, [carregar]);

  async function salvar() {
    if (!editando.nome.trim())
      return avisar("Escreva o nome do profissional.", "erro");
    setSalvando(true);
    try {
      if (editando.id) {
        await api(`barbeiros/${editando.id}`, {
          method: "PATCH",
          body: editando,
        });
      } else {
        await api("barbeiros", {
          method: "POST",
          body: { ...editando, ordem: itens.length + 1 },
        });
      }
      setEditando(null);
      carregar();
      avisar("Profissional salvo.");
    } catch (erro) {
      tratarErro(erro);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(item) {
    try {
      await api(`barbeiros/${item.id}`, {
        method: "PATCH",
        body: { ativo: item.ativo ? 0 : 1 },
      });
      carregar();
      avisar(
        item.ativo
          ? `${item.nome} não aparece mais no site.`
          : `${item.nome} voltou ao site.`,
      );
    } catch (erro) {
      tratarErro(erro);
    }
  }

  async function confirmarExcluir() {
    const item = excluindo;
    try {
      const r = await api(`barbeiros/${item.id}`, { method: "DELETE" });
      setExcluindo(null);
      carregar();
      avisar(r.mensagem || "Profissional excluído.");
    } catch (erro) {
      tratarErro(erro);
    }
  }

  return (
    <>
      <div className="conteudo-topo">
        <div>
          <h1>Profissionais</h1>
          <p>Quem aparece no site e pode receber agendamentos.</p>
        </div>
        <button
          className="btn btn-ouro"
          onClick={() => setEditando({ ...VAZIO })}
        >
          <Mais /> Novo profissional
        </button>
      </div>

      {itens.length === 0 ? (
        <Vazio titulo="Nenhum profissional cadastrado">
          Cadastre a equipe para que os clientes possam escolher com quem se
          atender.
        </Vazio>
      ) : (
        <div
          className="cartoes"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(300px,1fr))",
          }}
        >
          {itens.map((b) => (
            <article className="cartao" key={b.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 12,
                }}
              >
                {b.foto ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="avatar-mini"
                    src={b.foto}
                    alt=""
                    width={42}
                    height={42}
                    loading="lazy"
                  />
                ) : (
                  <span className="avatar-mini">{iniciais(b.nome)}</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 17 }}>{b.nome}</strong>
                  <div style={{ fontSize: 13, color: "var(--tinta-suave)" }}>
                    {b.funcao}
                  </div>
                </div>
                <span
                  className={`etiqueta ${b.ativo ? "etiqueta-confirmado" : "etiqueta-neutra"}`}
                >
                  {b.ativo ? "No ar" : "Fora"}
                </span>
              </div>

              {b.bio ? (
                <p
                  style={{
                    margin: "0 0 14px",
                    fontSize: 14,
                    color: "var(--tinta-suave)",
                  }}
                >
                  {b.bio}
                </p>
              ) : null}

              <div className="acoes-linha">
                <button
                  className="btn btn-contorno btn-mini"
                  onClick={() => setEditando(b)}
                >
                  <Lapis width={14} height={14} /> Editar
                </button>
                <button
                  className="btn btn-contorno btn-mini"
                  onClick={() => alternarAtivo(b)}
                >
                  {b.ativo ? "Tirar do site" : "Voltar ao site"}
                </button>
                <button
                  className="icone-btn perigo"
                  onClick={() => setExcluindo(b)}
                  title="Excluir"
                >
                  <Lixeira width={15} height={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {excluindo ? (
        <ModalConfirmacao
          titulo="Excluir profissional"
          mensagem={
            <>
              Excluir <strong>{excluindo.nome}</strong>?
            </>
          }
          confirmarLabel="Excluir"
          perigo
          aoConfirmar={confirmarExcluir}
          aoFechar={() => setExcluindo(null)}
        />
      ) : null}

      {editando ? (
        <Modal
          titulo={editando.id ? "Editar profissional" : "Novo profissional"}
          aoFechar={() => setEditando(null)}
          rodape={
            <>
              <button
                className="btn btn-contorno"
                onClick={() => setEditando(null)}
              >
                Cancelar
              </button>
              <button
                className="btn btn-ouro"
                onClick={salvar}
                disabled={salvando}
              >
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </>
          }
        >
          <label className="campo">
            <span>Nome</span>
            <input
              className="entrada"
              value={editando.nome}
              onChange={(e) =>
                setEditando({ ...editando, nome: e.target.value })
              }
              autoFocus
            />
          </label>

          <label className="campo">
            <span>Função</span>
            <input
              className="entrada"
              value={editando.funcao}
              onChange={(e) =>
                setEditando({ ...editando, funcao: e.target.value })
              }
              placeholder="Ex: Barbeiro sênior"
            />
          </label>

          <label className="campo">
            <span>Descrição curta</span>
            <textarea
              className="entrada"
              value={editando.bio}
              onChange={(e) =>
                setEditando({ ...editando, bio: e.target.value })
              }
              placeholder="Aparece no site, embaixo do nome."
            />
          </label>

          <CampoImagem
            label="Foto (opcional)"
            valor={editando.foto}
            aoMudar={(url) => setEditando({ ...editando, foto: url })}
            pasta="barbeiros"
            avisar={avisar}
          />

          <label className="caixa">
            <input
              type="checkbox"
              checked={!!editando.ativo}
              onChange={(e) =>
                setEditando({ ...editando, ativo: e.target.checked ? 1 : 0 })
              }
            />
            Aparecer no site e receber agendamentos
          </label>
        </Modal>
      ) : null}
    </>
  );
}
