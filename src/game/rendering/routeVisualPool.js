/** Scene-owned display objects only. Generator descriptors and physics never enter these groups. */
export class RouteVisualPool {
  constructor(scene) {
    this.scene = scene;
    this.images = scene.add.group();
    this.containers = scene.add.group();
    this.tiles = scene.add.group();
    this.owners = new WeakMap();
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
    const node = this.images.get(x, y, key, frame);
    node.setTexture(key, frame);
    if (!node.displayList && !node.parentContainer) this.scene.sys.displayList.add(node);
    return this.reset(node, this.images, x, y);
  }

  container(x, y, children) {
    const node = this.containers.getFirstDead()
      ? this.containers.get(x, y) : this.scene.add.container(x, y);
    if (!this.containers.contains(node)) this.containers.add(node);
    this.reset(node, this.containers, x, y);
    node.add(children);
    return node;
  }

  tile(x, y, width, height, key) {
    const node = this.tiles.getFirstDead()
      ? this.tiles.get(x, y) : this.scene.add.tileSprite(x, y, width, height, key);
    if (!this.tiles.contains(node)) this.tiles.add(node);
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
  return scene.routeVisualPool
    ? scene.routeVisualPool.image(x, y, key, frame) : scene.add.image(x, y, key, frame);
}

export function routeContainer(scene, x, y, children) {
  return scene.routeVisualPool
    ? scene.routeVisualPool.container(x, y, children) : scene.add.container(x, y, children);
}

export function routeTile(scene, x, y, width, height, key) {
  return scene.routeVisualPool
    ? scene.routeVisualPool.tile(x, y, width, height, key) : scene.add.tileSprite(x, y, width, height, key);
}

export function releaseRouteVisual(scene, node) {
  if (!node) return;
  if (scene.routeVisualPool) scene.routeVisualPool.release(node);
  else node.destroy();
}
