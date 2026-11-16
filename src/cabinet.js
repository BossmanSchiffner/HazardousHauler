import frameUrl from './game/assets/sprites/cabinet_overlay.svg?url';
import logoUrl from '@art-direction/GameLogo.svg?url';

export const CABINET_QUERY = '(min-width: 1024px) and (min-aspect-ratio: 4/3) and (pointer: fine)';
export const CABINET_WIDTH = 640;
export const CABINET_HEIGHT = 844;

export function mountCabinet() {
  const app = document.querySelector('#app');
  const media = window.matchMedia(CABINET_QUERY);
  const chrome = document.createElement('div');
  chrome.className = 'cabinet-chrome';
  chrome.innerHTML = `
    <img class="cabinet-frame" src="${frameUrl}" alt="" aria-hidden="true">
    <header class="cabinet-marquee"><img src="${logoUrl}" alt="Hazardous Haul"></header>
    <aside class="cabinet-panel cabinet-loadout" aria-label="Loadout and records">
      <h1>LOADOUT &amp; RECORDS</h1>
      <section class="cabinet-truck">
        <h2 id="cabinet-truck-name">STANDARD HAULER</h2>
        <label>CARGO <span id="cabinet-cargo-value"></span>
          <meter id="cabinet-cargo" min="0" max="1" value="0"></meter>
        </label>
        <label>STEERING <span id="cabinet-steering-value"></span>
          <meter id="cabinet-steering" min="0" max="1" value="0"></meter>
        </label>
      </section>
      <section class="cabinet-upgrades">
        <h2>UPGRADE MODULES</h2>
        <div class="cabinet-sockets" id="cabinet-sockets"></div>
      </section>
      <p class="cabinet-record">ENDLESS BEST: <strong id="cabinet-best">0 m</strong></p>
      <section class="cabinet-controls">
        <h2>CONTROLS</h2>
        <p>Mouse / A-D / Arrows <span>to steer</span></p>
        <p>Space / Esc / P <span>to pause</span></p>
      </section>
    </aside>
    <aside class="cabinet-panel cabinet-leaderboard" aria-label="Leaderboard coming soon">
      <h1>LEADERBOARD</h1>
      <span class="cabinet-badge">COMING SOON</span>
      <ol>${Array.from({length: 8}, (_, i) =>
        `<li><span>RANK ${i + 1}</span><span aria-label="No score yet">---</span></li>`).join('')}</ol>
    </aside>`;
  app.append(chrome);
  const find = id => chrome.querySelector(`#cabinet-${id}`);
  const sockets = Array.from({length: 6}, () => {
    const socket = document.createElement('div');
    socket.className = 'cabinet-socket';
    find('sockets').append(socket);
    return socket;
  });
  let lastState;
  window.updateCabinetUI = state => {
    if (!media.matches || chrome.hidden) return;
    // Profile/menu events, not frame updates, drive this bridge.
    const signature = JSON.stringify(state);
    if (signature === lastState) return;
    lastState = signature;
    find('truck-name').textContent = state.truckName.toUpperCase();
    find('cargo').max = state.maxCapacity;
    find('cargo').value = state.capacity;
    find('cargo-value').textContent = `${state.capacity}`;
    find('steering').max = state.maxSteering;
    find('steering').value = state.steering;
    find('steering-value').textContent = `${Math.round(state.steering * 100)}%`;
    find('best').textContent = `${Math.floor(state.endlessBest).toLocaleString('en-US')} m`;
    sockets.forEach((socket, index) => {
      const module = state.sockets[index];
      socket.replaceChildren();
      socket.classList.toggle('is-locked', module.locked);
      socket.title = module.name;
      if (module.url) {
        const image = document.createElement('img');
        image.src = module.url;
        image.alt = module.name;
        socket.append(image);
      } else {
        const lock = document.createElement('span');
        lock.className = 'cabinet-lock';
        lock.setAttribute('role', 'img');
        lock.setAttribute('aria-label', module.name);
        socket.append(lock);
      }
    });
  };
  const setVisible = () => {
    app.classList.toggle('cabinet-mode', media.matches);
    chrome.hidden = !media.matches;
  };
  setVisible();
  return {
    get active() { return media.matches; },
    onChange(callback) {
      media.addEventListener('change', () => {
        setVisible();
        callback(media.matches);
      });
    },
  };
}
