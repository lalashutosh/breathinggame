// Game selection panel: renders one card per registry entry.
import { drawThumb } from './thumbs.js';

export function renderGamePanel(listEl, games, { onPlay }) {
  listEl.innerHTML = '';
  for (const g of games) {
    const li = document.createElement('li');
    li.className = 'game-card' + (g.available ? '' : ' is-locked');
    li.dataset.game = g.id;
    li.innerHTML = `
      <canvas class="game-thumb" aria-hidden="true"></canvas>
      <div class="game-text">
        <h3 class="game-title">${g.title}</h3>
        <p class="game-desc">${g.description}</p>
        <span class="game-chip ${g.available ? 'chip-open' : 'chip-soon'}">${g.available ? 'Playable now' : 'Coming soon'}</span>
      </div>
      <button class="game-play" type="button" aria-label="${g.available ? `Play ${g.title}` : `${g.title} is coming soon`}" ${g.available ? '' : 'disabled'}></button>`;
    drawThumb(li.querySelector('.game-thumb'), g.thumb);
    if (g.available) {
      const open = () => onPlay(g);
      li.querySelector('.game-play').addEventListener('click', open);
      li.querySelector('.game-thumb').addEventListener('click', open);
      li.querySelector('.game-thumb').style.cursor = 'pointer';
    }
    listEl.appendChild(li);
  }
}
