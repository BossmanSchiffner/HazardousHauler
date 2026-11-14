import {GAME_BALANCE, MAX_TRACK_SPEED} from '../data/gameBalance.js';
import {HAZARDS, guardrailLayout, guardrailMinimumLength} from '../core/hazards.js';
import {rowSpacingAtSpeed} from '../core/trackGenerator.js';
import {SPAWN_Y} from '../data/route.js';

const {routes} = GAME_BALANCE;
const minimumSpeed = Math.min(...['level1', 'level2', 'level3', 'level4'].flatMap(id =>
  routes[id].speed.sectorStartsPxPerSecond), routes.continuous.startSpeedPxPerSecond);
const minimumSpacing = Math.min(rowSpacingAtSpeed(minimumSpeed), rowSpacingAtSpeed(MAX_TRACK_SPEED));
const maximumGap = rowSpacingAtSpeed(MAX_TRACK_SPEED) +
  MAX_TRACK_SPEED * routes.movingHazards.reactionMarginSeconds + routes.sideObstacles.chicaneTransitionExtraPx;
const guardrails = Object.keys(HAZARDS).filter(kind => HAZARDS[kind].elongated);
const maximumTail = (routes.sideObstacles.maximumSpanRows - 1) * maximumGap;
const maximumLength = maximumTail + Math.max(...guardrails.map(guardrailMinimumLength));
const maximumParts = Math.max(...guardrails.map(kind =>
  guardrailLayout({kind, lane: 0, lengthPx: maximumLength}).midCount + 2));
const travel = routes.geometry.logicalHeightPx + 60 - SPAWN_Y;
const maximumHeight = Math.max(...Object.values(HAZARDS).map(hazard => hazard.height));
// Include whole offscreen structures, delayed Beta slots, slower Sweepers and the next spawn before removal.
const residentRows = Math.ceil(Math.max(
  travel + maximumTail / 2 + maximumLength / 2,
  travel + maximumGap * Math.max(...routes.track.betaSlots) + maximumHeight / 2,
  (travel + maximumHeight / 2) / (1 - routes.movingHazards.sweeperForwardSpeedRatio),
) / minimumSpacing) + 1;
// Beta slots budget a vent's sprite, shadow, two air puffs, beacon and Neon halo.
const imagesPerRow = routes.track.lanes.length * Math.max(6, maximumParts * 2 + 1) +
  routes.track.betaSlots.length * 6 + routes.track.lanes.length * 2 + 2;

/** Conservative descriptor bounds, independent of route seed, quotas and visual theme. */
export const ROUTE_VISUAL_CAPACITY = Object.freeze({
  // Includes 16 orb and 16 glow slots plus 4 decorative Neon shoulder signs.
  images: residentRows * imagesPerRow + 5 + 4 + 4 + 32 + 4,
  containers: residentRows * routes.track.lanes.length + 2,
  tiles: 8,
});

/** Scene-owned display objects only. Generator descriptors and physics never enter these groups. */
export class RouteVisualPool {
  constructor(scene, capacity = ROUTE_VISUAL_CAPACITY) {
    if (['running', 'docking', 'depot', 'crashing', 'finishing'].includes(scene.phase)) {
      throw new Error('Route visual groups must be preallocated on scene load');
    }
    this.scene = scene;
    this.images = scene.add.group({maxSize: capacity.images});
    this.containers = scene.add.group({maxSize: capacity.containers});
    this.tiles = scene.add.group({maxSize: capacity.tiles});
    this.owners = new WeakMap();
    for (const [group, count, create] of [
      [this.images, capacity.images, () => scene.add.image(0, 0, '__WHITE')],
      [this.containers, capacity.containers, () => scene.add.container(0, 0)],
      [this.tiles, capacity.tiles, () => scene.add.tileSprite(0, 0,
        routes.geometry.logicalWidthPx, routes.geometry.logicalHeightPx, 'industrial_road')],
    ]) {
      for (let index = 0; index < count; index++) {
        const node = create();
        group.add(node);
        this.owners.set(node, group);
        group.killAndHide(node);
      }
    }
  }

  acquire(group, x, y, kind) {
    if (this.destroyed || !group.scene || !group.getFirstDead()) {
      throw new Error(`Route visual ${kind} pool exhausted or unavailable; runtime allocation is forbidden`);
    }
    return group.get(x, y);
  }

  reset(node, group, x, y) {
    this.owners.set(node, group);
    this.scene.tweens.killTweensOf(node);
    node.setActive(true).setVisible(true).setPosition(x, y)
      .setAlpha(1).setScale(1).setRotation(0).setDepth(0);
    if (group !== this.containers) {
      node.setOrigin(0.5).setFlip(false, false).clearTint().setBlendMode('NORMAL');
    }
    return node;
  }

  image(x, y, key, frame) {
    const node = this.acquire(this.images, x, y, 'image');
    node.setTexture(key, frame);
    if (!node.displayList && !node.parentContainer) this.scene.sys.displayList.add(node);
    return this.reset(node, this.images, x, y);
  }

  container(x, y, children) {
    const node = this.acquire(this.containers, x, y, 'container');
    this.reset(node, this.containers, x, y);
    node.add(children);
    return node;
  }

  tile(x, y, width, height, key) {
    const node = this.acquire(this.tiles, x, y, 'tile');
    node.setTexture(key).setSize(width, height);
    node.tilePositionX = node.tilePositionY = 0;
    return this.reset(node, this.tiles, x, y);
  }

  release(node) {
    const group = this.owners.get(node);
    if (!group) {
      node.destroy();
      return;
    }
    if (!group.scene) return;
    if (!node.active) return;
    this.scene.tweens.killTweensOf(node);
    if (group === this.containers) {
      const children = [...node.list];
      node.removeAll(false);
      children.forEach(child => this.release(child));
      node.guardrailParts = null;
      node.guardrailBeacon = null;
    }
    group.killAndHide(node);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    // Detach pooled children first; containers must not destroy images a second time.
    if (this.containers.scene) {
      for (const node of this.containers.getChildren()) {
        if (node.active) this.release(node);
      }
    }
    // Phaser's UpdateList may already have destroyed these groups on scene shutdown.
    for (const group of [this.containers, this.images, this.tiles]) {
      if (group.scene) group.destroy(true, true);
    }
  }
}

export function routeImage(scene, x, y, key, frame) {
  requireGameplayPool(scene);
  return scene.routeVisualPool
    ? scene.routeVisualPool.image(x, y, key, frame) : scene.add.image(x, y, key, frame);
}

export function routeContainer(scene, x, y, children) {
  requireGameplayPool(scene);
  return scene.routeVisualPool
    ? scene.routeVisualPool.container(x, y, children) : scene.add.container(x, y, children);
}

export function routeTile(scene, x, y, width, height, key) {
  requireGameplayPool(scene);
  return scene.routeVisualPool
    ? scene.routeVisualPool.tile(x, y, width, height, key) : scene.add.tileSprite(x, y, width, height, key);
}

export function releaseRouteVisual(scene, node) {
  if (!node) return;
  if (scene.routeVisualPool) scene.routeVisualPool.release(node);
  else node.destroy();
}

function requireGameplayPool(scene) {
  if (!scene.routeVisualPool && ['running', 'docking', 'depot', 'crashing', 'finishing'].includes(scene.phase)) {
    throw new Error('Route visual pool must be preallocated before gameplay');
  }
}
