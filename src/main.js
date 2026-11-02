import Phaser from 'phaser';
import './styles.css';
import {RoutePrototypeScene} from './game/scenes/RoutePrototypeScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a1222',
  width: 390,
  height: 844,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {pixelArt: false, antialias: true},
  // Phaser's smoothing clamps frames to 16.7 ms when unfocused/cooling down,
  // which made the route crawl at half speed and then lurch. The scene caps spikes itself.
  fps: {smoothStep: false},
  scene: [RoutePrototypeScene],
});

// Dev-only hook for automated playtest measurements; stripped from production builds.
if (import.meta.env.DEV) window.__cargoRunGame = game;
