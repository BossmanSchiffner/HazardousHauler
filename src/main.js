import Phaser from 'phaser';
import './styles.css';
import {RoutePrototypeScene} from './game/scenes/RoutePrototypeScene.js';
import {mountCabinet, CABINET_WIDTH, CABINET_HEIGHT} from './cabinet.js';

const cabinet = mountCabinet();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#05080f',
  width: cabinet.active ? CABINET_WIDTH : 390,
  height: 844,
  scale: {
    mode: cabinet.active ? Phaser.Scale.FIT : Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {pixelArt: false, antialias: true},
  // Phaser's smoothing clamps frames to 16.7 ms when unfocused/cooling down,
  // which made the route crawl at half speed and then lurch. The scene caps spikes itself.
  fps: {smoothStep: false},
  scene: [RoutePrototypeScene],
  callbacks: {
    preBoot: game => game.registry.set('cabinetMode', cabinet.active),
  },
});

cabinet.onChange(active => {
  game.registry.set('cabinetMode', active);
  game.scale.scaleMode = active ? Phaser.Scale.FIT : Phaser.Scale.RESIZE;
  game.scale.displaySize.setAspectMode(active ? Phaser.Scale.FIT : Phaser.Scale.NONE);
  const parent = document.querySelector('#game');
  game.scale.getParentBounds();
  game.scale.setGameSize(active ? CABINET_WIDTH : parent.clientWidth,
    active ? CABINET_HEIGHT : parent.clientHeight);
  game.scene.getScene('RoutePrototypeScene')?.syncCabinetUI();
});

// Dev-only hook for automated playtest measurements; stripped from production builds.
if (import.meta.env.DEV) window.__cargoRunGame = game;
