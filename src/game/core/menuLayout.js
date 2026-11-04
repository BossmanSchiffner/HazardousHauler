const finitePositive = value => Number.isFinite(value) && value > 0;

export const MENU_SPACING = Object.freeze({edge: 32, padding: 16, gap: 12});

export function responsiveViewport(width, height, logicalWidth, maximumZoom = 1.12) {
  if (![width, height, logicalWidth, maximumZoom].every(finitePositive)) {
    throw new Error('Invalid responsive viewport dimensions');
  }
  const zoom = Math.min(width / logicalWidth, maximumZoom);
  return Object.freeze({
    zoom,
    worldWidth: width / zoom,
    worldHeight: height / zoom,
  });
}

export function managementLayout(height, safeBottom = 0) {
  if (!finitePositive(height) || !Number.isFinite(safeBottom) || safeBottom < 0) {
    throw new Error('Invalid management layout dimensions');
  }
  const footerHeight = 54;
  const footerY = height - safeBottom - 60;
  const contentTop = 238;
  const contentBottom = footerY - footerHeight / 2 - MENU_SPACING.padding;
  if (contentBottom <= contentTop) throw new Error('Viewport is too short for management navigation');
  return Object.freeze({height, contentTop, contentBottom, footerY, footerHeight});
}

export function squareGridMetrics(width, {padding = 18, gap = 10, columns = 3} = {}) {
  if (![width, padding, gap, columns].every(Number.isFinite) ||
      width <= 0 || padding < 0 || gap < 0 || columns < 1) {
    throw new Error('Invalid square-grid dimensions');
  }
  const tileSize = (width - padding * 2 - gap * (columns - 1)) / columns;
  if (tileSize <= 0) throw new Error('Square-grid tiles do not fit the available width');
  return Object.freeze({
    columns,
    gap,
    padding,
    tileSize,
    rowStride: tileSize + gap,
  });
}

export function peekingCardMetrics(top, bottom, visibleRows = 2, peek = 0.35) {
  if (![top, bottom, visibleRows, peek].every(Number.isFinite) ||
      top < 0 || bottom <= top || !Number.isInteger(visibleRows) || visibleRows < 1 || peek < 0.3 || peek > 0.4) {
    throw new Error('Invalid peeking-card viewport');
  }
  const gap = MENU_SPACING.gap;
  const height = (bottom - top - gap * visibleRows) / (visibleRows + peek);
  if (height <= 0) throw new Error('Peeking cards do not fit the viewport');
  return Object.freeze({height, gap, stride: height + gap, peek});
}

export function measureMenuContent(children) {
  let bottom = 0;
  for (const child of children) {
    if (child.menuScrollBounds) {
      bottom = Math.max(bottom, child.menuScrollBounds.bottom);
      continue;
    }

    const height = child.displayHeight ?? child.height ?? 0;
    const origin = child.displayOriginY ?? height * (child.originY ?? 0.5);
    bottom = Math.max(bottom, child.y - origin + height);
  }
  return bottom;
}

export function advanceMenuScroll(offset, velocity, maximum, seconds) {
  if (![offset, velocity, maximum, seconds].every(Number.isFinite) || maximum < 0 || seconds < 0) {
    throw new Error('Invalid menu scroll state');
  }
  const decay = Math.exp(-8 * seconds);
  const next = Math.max(-maximum, Math.min(0, offset + velocity * (1 - decay) / 8));
  const stopped = next === 0 || next === -maximum || Math.abs(velocity * decay) < 12;
  return {offset: next === 0 ? 0 : next, velocity: stopped ? 0 : velocity * decay};
}
