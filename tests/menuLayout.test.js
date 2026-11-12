import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceMenuScroll, managementLayout, measureMenuContent, MENU_SPACING, peekingCardMetrics, responsiveViewport, squareGridMetrics,
  upgradeTileContentMetrics, adaptiveCardMetrics,
} from '../src/game/core/menuLayout.js';

test('responsive viewport fills short portrait widths without shrinking the game to phone height', () => {
  const short = responsiveViewport(320, 568, 390);
  assert.equal(short.zoom, 320 / 390);
  assert.equal(short.worldWidth, 390);
  assert.ok(short.worldHeight > 680);

  const tall = responsiveViewport(430, 932, 390);
  assert.ok(Math.abs(tall.zoom - 430 / 390) < 1e-9);
  assert.equal(tall.worldWidth, 390);
});

test('management content bounds leave a fixed footer and useful short-screen scroll area', () => {
  const short = managementLayout(692, 0);
  assert.ok(short.contentBottom < short.footerY - short.footerHeight / 2);
  assert.ok(short.contentBottom - short.contentTop >= 350);
  assert.ok(short.footerY - short.footerHeight / 2 - short.contentBottom >= MENU_SPACING.padding);
  assert.ok(short.footerY + short.footerHeight / 2 <= short.height - 24 - 8);
  const safe = managementLayout(844, 24);
  assert.equal(safe.footerY, managementLayout(844).footerY - 24);
});

test('upgrade grid keeps three square columns with consistent gaps', () => {
  const grid = squareGridMetrics(390, {padding: 18, gap: 10, columns: 3});
  assert.equal(grid.columns, 3);
  assert.ok(Math.abs(grid.tileSize - 111.33333333333333) < 1e-9);
  assert.equal(grid.rowStride, grid.tileSize + 10);
});

test('scroll content measurement includes grouped tiles and direct labels', () => {
  const bottom = measureMenuContent([
    {menuScrollBounds: {top: 238, bottom: 348}},
    {y: 410, height: 28, displayOriginY: 0},
  ]);
  assert.equal(bottom, 438);
});

test('phone upgrade grid uses readable two-column cards without changing the general grid default', () => {
  const grid = squareGridMetrics(390, {padding: MENU_SPACING.edge, gap: MENU_SPACING.gap, columns: 2});
  assert.equal(grid.columns, 2);
  assert.equal(grid.tileSize, 157);
  assert.ok(grid.tileSize * 320 / 390 > 128);
  assert.equal(grid.padding, 32, 'cards are inset from the industrial frame');
});

test('upgrade tile content keeps padded, non-overlapping rows and adapts to tile dimensions', () => {
  for (const [width, height] of [[145, 180], [157, 194], [200, 240]]) {
    const tile = upgradeTileContentMetrics(width, height);
    const bounds = [
      [tile.titleY - tile.titleHeight / 2, tile.titleY + tile.titleHeight / 2],
      [tile.rankY - 6 * tile.scale, tile.rankY + 6 * tile.scale],
      [tile.iconY - tile.iconSize / 2, tile.iconY + tile.iconSize / 2],
      [tile.benefitY - tile.benefitHeight / 2, tile.benefitY + tile.benefitHeight / 2],
      [tile.noteY - tile.noteHeight / 2, tile.noteY + tile.noteHeight / 2],
      [tile.buttonY - tile.buttonHeight / 2, tile.buttonY + tile.buttonHeight / 2],
    ];
    assert.ok(bounds[0][0] >= 0);
    for (let index = 1; index < bounds.length; index++) {
      assert.ok(bounds[index][0] >= bounds[index - 1][1],
        `${width}x${height}: tile content rows ${index - 1} and ${index} overlap`);
    }
    assert.ok(bounds.at(-1)[1] <= height);
    assert.ok(tile.paddingX >= 8 && tile.paddingX <= 12);
    assert.ok(tile.buttonHeight >= 42);
  }
  assert.throws(() => upgradeTileContentMetrics(0, 180), /Invalid upgrade tile/);
});

test('menu momentum decays consistently across frame rates and stops at both ends', () => {
  const run = hz => {
    let state = {offset: -100, velocity: -700};
    for (let frame = 0; frame < hz / 4; frame++) {
      state = advanceMenuScroll(state.offset, state.velocity, 600, 1 / hz);
    }
    return state;
  };
  const slow = run(60), fast = run(120);
  assert.ok(slow.offset < -100 && slow.offset > -200);
  assert.ok(Math.abs(slow.velocity) < 700);
  assert.ok(Math.abs(slow.offset - fast.offset) < 1e-8);
  assert.ok(Math.abs(slow.velocity - fast.velocity) < 1e-8);
  assert.deepEqual(advanceMenuScroll(-5, 800, 600, 0.05), {offset: 0, velocity: 0});
  assert.deepEqual(advanceMenuScroll(-595, -800, 600, 0.05), {offset: -600, velocity: 0});
  assert.deepEqual(advanceMenuScroll(0, -800, 0, 0.05), {offset: 0, velocity: 0});
  assert.throws(() => advanceMenuScroll(0, NaN, 600, 0.05), /Invalid menu scroll state/);
});

test('mobile lists expose 35 percent of the next truck or upgrade row above the fixed footer', () => {
  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [420, 844]]) {
    const viewport = responsiveViewport(width, height, 390);
    const layout = managementLayout(viewport.worldHeight);
    for (const [top, rows] of [[142, 2], [262, 1]]) {
      const cards = peekingCardMetrics(top, layout.contentBottom, rows);
      const nextTop = top + rows * cards.stride;
      const fraction = (layout.contentBottom - nextTop) / cards.height;
      assert.ok(fraction >= 0.3 && fraction <= 0.4, `${width}x${height}/${rows}: ${fraction}`);
      assert.ok(Math.abs(fraction - 0.35) < 1e-9);
      assert.equal(cards.gap, 12);
      assert.ok(layout.contentBottom < layout.footerY - layout.footerHeight / 2);
    }
  }
  assert.throws(() => peekingCardMetrics(100, 100), /Invalid peeking-card/);
  assert.throws(() => peekingCardMetrics(100, 200, 1.5), /Invalid peeking-card/);
});

test('adaptive card metrics drop rows before shrinking cards below their readable minimum', () => {
  const tall = adaptiveCardMetrics(200, 800, 196);
  assert.equal(tall.rows, 2);
  assert.ok(tall.height >= 196);
  const short = adaptiveCardMetrics(200, 480, 196);
  assert.equal(short.rows, 1);
  assert.ok(short.height >= 196);
  assert.equal(short.stride, short.height + short.gap);
  assert.throws(() => adaptiveCardMetrics(0, 100, 0));
});