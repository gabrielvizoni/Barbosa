'use client';

import { useEffect } from 'react';
import { animate, createScope, onScroll, stagger, utils } from 'animejs';

/**
 * Dá vida ao site: entrada suave da capa, cartões que revelam ao rolar a
 * página, zoom leve nas fotos e uma resposta tátil ao clicar nos botões.
 * Não desenha nada — só liga as animações nos elementos já existentes.
 */
export default function Animacoes() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    // Usado nas animações "temporárias" (hover, clique) — depois que elas
    // terminam, tira o estilo inline que deixaram para trás, assim o :hover
    // em CSS (do card, do botão) volta a mandar.
    const aoTerminar = (self) => utils.cleanInlineStyles(self);

    // Usado nas animações de ENTRADA: o opacity:0 inicial delas é permanente
    // em CSS (ver início do arquivo), então o opacity:1 final tem que
    // continuar valendo pra sempre — cleanInlineStyles apagaria isso e o
    // conteúdo sumiria de novo. Só o transform é limpo, pra não travar o
    // :hover (ex.: o card de serviço sobe ao passar o mouse).
    function aoRevelar(elementos) {
      return () => {
        for (const el of elementos) el.style.transform = '';
      };
    }

    const escopo = createScope().add(() => {
      // Entrada da capa, uma vez, ao carregar a página.
      const entradas = document.querySelectorAll('.anim-entrada');
      animate(entradas, {
        opacity: [0, 1],
        translateY: [22, 0],
        delay: stagger(90, { start: 80 }),
        duration: 700,
        ease: 'outQuart',
        onComplete: aoRevelar(entradas),
      });

      // Título de cada seção revela ao chegar perto dele na rolagem.
      document.querySelectorAll('.secao-cabeca').forEach((cabeca) => {
        animate(cabeca, {
          opacity: [0, 1],
          translateY: [18, 0],
          duration: 600,
          ease: 'outQuart',
          onComplete: aoRevelar([cabeca]),
          autoplay: onScroll({ target: cabeca, once: true }),
        });
      });

      // Cartões de cada grade (serviços, equipe, produtos) entram pela
      // lateral, em cascata, assim que a grade aparece na tela.
      document.querySelectorAll('.grade, .grade-equipe').forEach((grade) => {
        const cartoes = Array.from(grade.children);
        if (!cartoes.length) return;
        animate(cartoes, {
          opacity: [0, 1],
          translateX: [-38, 0],
          delay: stagger(70),
          duration: 650,
          ease: 'outQuart',
          onComplete: aoRevelar(cartoes),
          autoplay: onScroll({ target: grade, once: true }),
        });
      });

      // Zoom suave na foto ao passar o mouse.
      document.querySelectorAll('.cartao-servico-imagem, .retrato').forEach((foto) => {
        foto.addEventListener('mouseenter', () => {
          animate(foto, { scale: 1.06, duration: 450, ease: 'outQuart' });
        });
        foto.addEventListener('mouseleave', () => {
          animate(foto, { scale: 1, duration: 450, ease: 'outQuart', onComplete: aoTerminar });
        });
      });
    });

    // Resposta ao clicar em qualquer botão: afunda e volta com uma leve
    // molinha. Fica em document (delegado) porque o Next troca de página
    // sem recarregar — por isso é removido manualmente no cleanup.
    function aoPressionar(evento) {
      const botao = evento.target.closest('.btn');
      if (!botao) return;
      animate(botao, { scale: 0.95, duration: 120, ease: 'outQuad' });
      const soltar = () =>
        animate(botao, { scale: 1, duration: 320, ease: 'outBack', onComplete: aoTerminar });
      window.addEventListener('pointerup', soltar, { once: true });
      window.addEventListener('pointercancel', soltar, { once: true });
    }
    document.addEventListener('pointerdown', aoPressionar);

    // Clique num link de âncora (Serviços, Equipe, Contato...): em vez do
    // pulo seco do navegador, rola suavemente até a seção — descontando a
    // altura do cabeçalho fixo, senão o título fica escondido atrás dele —
    // e dá um pequeno salto no próprio link, como resposta ao toque.
    function aoClicarLink(evento) {
      if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) {
        return;
      }
      const link = evento.target.closest('a[href^="#"]');
      if (!link) return;
      const id = link.getAttribute('href').slice(1);
      const alvo = id && document.getElementById(id);
      if (!alvo) return;

      evento.preventDefault();

      const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduzido) {
        animate(link, {
          keyframes: [{ translateY: -4 }, { translateY: 0 }],
          duration: 420,
          ease: 'outBack',
          onComplete: aoTerminar,
        });
      }

      const folga = (document.querySelector('.cabecalho')?.offsetHeight || 0) + 16;
      const destino = Math.max(0, alvo.getBoundingClientRect().top + window.scrollY - folga);

      if (reduzido) {
        window.scrollTo(0, destino);
        return;
      }

      const distancia = Math.abs(destino - window.scrollY);
      const posicao = { y: window.scrollY };
      animate(posicao, {
        y: destino,
        duration: Math.min(900, Math.max(380, distancia * 0.6)),
        ease: 'inOutQuad',
        onUpdate: () => window.scrollTo(0, posicao.y),
      });
    }
    document.addEventListener('click', aoClicarLink);

    return () => {
      document.removeEventListener('pointerdown', aoPressionar);
      document.removeEventListener('click', aoClicarLink);
      escopo.revert();
    };
  }, []);

  return null;
}
