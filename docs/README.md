# Documentação — The Barbosa

Esta pasta reúne a documentação de produto e de engenharia do sistema de
agendamento da The Barbosa. Ela descreve **o produto por inteiro** — o que já
está construído e o que ainda é plano — e cada item carrega uma marca de
situação para que a leitura nunca dê a entender que algo existe antes de
existir.

O código é a fonte de verdade sobre o comportamento atual. Quando um documento
divergir do código, o código está certo e o documento está desatualizado —
abra uma correção.

---

## Legenda de situação

Toda funcionalidade, regra, entidade e rota nos documentos leva uma destas
tags:

| Tag              | Significado                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `[IMPLEMENTADO]` | Existe no código hoje e, quando faz sentido, tem teste automatizado cobrindo.                 |
| `[PARCIAL]`      | Existe em parte — o núcleo funciona, mas falta comportamento descrito no documento.           |
| `[PLANEJADO]`    | Ainda não existe. Está aqui porque faz parte da visão do produto e orienta a próxima entrega. |

O objetivo é que, à medida que o sistema evolui, a manutenção seja só trocar a
tag de `[PLANEJADO]` para `[PARCIAL]` ou `[IMPLEMENTADO]` e ajustar o texto do
item, sem reescrever o documento.

---

## Índice

| #   | Documento                                              | Conteúdo                                                                          | Situação |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------- | -------- |
| 01  | [Requisitos funcionais](01-requisitos-funcionais.md)   | RF numerados por módulo (ator, prioridade, situação) e requisitos não-funcionais. | redigido |
| 02  | [Regras de negócio](02-regras-de-negocio.md)           | RN numeradas — enunciado, origem e situação.                                      | redigido |
| 03  | [Casos de uso](03-casos-de-uso.md)                     | Atores e diagrama de casos de uso.                                                | redigido |
| 04  | [Fluxos principais](04-fluxos-principais.md)           | Fluxo feliz, alternativo e de erro de cada processo.                              | redigido |
| 05  | [Arquitetura](05-arquitetura.md)                       | Diagrama de componentes e decisões de arquitetura.                                | redigido |
| 06  | [Modelo de dados](06-modelo-de-dados.md)               | DER e dicionário de dados, derivados das migrations.                              | redigido |
| 07  | [Navegação](07-navegacao.md)                           | Mapa de telas do site público e do painel.                                        | redigido |
| 08  | [Diagramas de sequência](08-diagramas-de-sequencia.md) | Agendar, login/bootstrap, recuperação de senha, comanda para o caixa.             | redigido |
| 09  | [Máquina de estados](09-maquina-de-estados.md)         | Ciclo de vida do agendamento — situação atual e situação alvo.                    | redigido |
| 10  | [Contrato da API](10-contrato-da-api.md)               | Endpoints, corpo, respostas e códigos de erro.                                    | redigido |
| 11  | [Estratégia de testes](11-estrategia-de-testes.md)     | Níveis de teste, escopo, lacunas e como executar.                                 | redigido |

Enquanto a migração completa não acontece, o diretório [`../auditoria/`](../auditoria)
guarda a auditoria de back-end que serviu de base para vários destes
documentos — em especial `auditoria/01` (mapa do schema), `auditoria/03`
(algoritmo de disponibilidade), `auditoria/04` (autenticação) e `auditoria/08`
(contrato da API).

---

## Convenções

- **Idioma:** português do Brasil, para acompanhar o cliente e o histórico de
  commits.
- **Diagramas:** [Mermaid](https://mermaid.js.org) embutido no Markdown, que o
  GitHub renderiza sem ferramenta externa.
- **Datas e horas nos exemplos:** `AAAA-MM-DD` e `HH:MM`, no fuso da barbearia
  (`America/Sao_Paulo`), como no resto do sistema.
- **Identificadores:** requisitos funcionais são `RF-NN`, regras de negócio são
  `RN-NN`, requisitos não-funcionais são `RNF-NN`, casos de uso são `UC-NN`.

---

## Como manter atualizado

| Quando você...                                     | Atualize...                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| adiciona ou muda uma migration                     | [06-modelo-de-dados.md](06-modelo-de-dados.md) (DER e dicionário)                           |
| cria, remove ou muda o contrato de uma rota da API | [10-contrato-da-api.md](10-contrato-da-api.md)                                              |
| muda uma transição de status do agendamento        | [09-maquina-de-estados.md](09-maquina-de-estados.md) e a RN afetada                         |
| entrega algo marcado como `[PLANEJADO]`            | a tag do item nos documentos 01 e 02, e o fluxo em 04                                       |
| adiciona ou remove uma tela                        | [07-navegacao.md](07-navegacao.md)                                                          |
| muda a forma de rodar, instalar ou testar          | o [README](../README.md) da raiz e [11-estrategia-de-testes.md](11-estrategia-de-testes.md) |
