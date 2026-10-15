const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const model = html.split("(()=>{'use strict';")[1].split('let mirrorFrame=0;')[0];
const createCamera = Function(model + 'return createCamera;')();
const navigation = html.slice(html.indexOf(" const scene=$('scene'),camera="), html.lastIndexOf('})();'));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function harness(scale = 1) {
  const listeners = {}, globalListeners = {}, captured = new Set(), classes = new Set();
  const node = () => ({attrs: {}, setAttribute(k, v) { this.attrs[k] = Number(v); }});
  const carHit = node(), observerHit = node();
  const scene = {
    view: [0, 0, 760, 600],
    classList: {add(...v) { v.forEach(x => classes.add(x)); }, remove(...v) { v.forEach(x => classes.delete(x)); }},
    querySelector: selector => selector.includes('car') ? carHit : observerHit,
    setAttribute(k, v) { if (k === 'viewBox') this.view = v.split(' ').map(Number); },
    addEventListener(type, fn) { listeners[type] = fn; },
    getBoundingClientRect: () => ({left: 10, top: 20, width: 760 * scale, height: 600 * scale}),
    getScreenCTM() {
      const [x, y, w, h] = this.view;
      return {a: 760 * scale / w, inverse: () => ({a: w / (760 * scale), d: h / (600 * scale), x, y})};
    },
    createSVGPoint() {
      return {x: 0, y: 0, matrixTransform(m) { return {x: m.x + (this.x - 10) * m.a, y: m.y + (this.y - 20) * m.d}; }};
    },
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
    releasePointerCapture(id) { captured.delete(id); listeners.lostpointercapture?.({pointerId: id}); }
  };
  const state = {car: 195, observer: 493};
  const context = {createCamera, state, $: () => scene, panel: {}, canvas: {}, render() {},
    ResizeObserver: class { observe() {} },
    window: {addEventListener(type, fn) { globalListeners[type] = fn; }},
    document: {hidden: false, addEventListener(type, fn) { globalListeners[type] = fn; }}};
  vm.runInNewContext(navigation + '\nthis.snapshot=()=>({x:camera.x,y:camera.y,zoom:camera.zoom,pointers:pointers.size,gesture:gesture?.type});', context);
  function send(type, props = {}) {
    const event = {pointerId: 1, pointerType: 'touch', button: 0, clientX: 390, clientY: 320,
      target: {getAttribute: () => null}, preventDefault() { this.prevented = true; }, ...props};
    listeners[type](event);
    return event;
  }
  function wheel(deltaY) { return send('wheel', {deltaX: 0, deltaY, deltaMode: 0}); }
  return {scene, state, classes, captured, context, carHit, observerHit, send, wheel,
    snapshot: context.snapshot, global: type => globalListeners[type]()};
}

test('zoom preserves the world point under the cursor and clamps at 1–5x', () => {
  const camera = createCamera();
  camera.zoomAt(2, .3, .4);
  near(camera.x + .3 * 760 / camera.zoom, .3 * 760);
  near(camera.y + .4 * 600 / camera.zoom, .4 * 600);
  camera.zoomAt(100, .5, .5); assert.equal(camera.zoom, 5);
  camera.zoomAt(.0001, .5, .5);
  assert.equal(camera.zoom, 1); assert.equal(camera.x, 0); assert.equal(camera.y, 0);
});

test('pan cannot expose empty space outside the original scene', () => {
  const camera = createCamera(); camera.zoomAt(2, .5, .5);
  camera.pan(1e5, 1e5); assert.equal(camera.x, 380); assert.equal(camera.y, 300);
  camera.pan(-1e5, -1e5); assert.equal(camera.x, 0); assert.equal(camera.y, 0);
});

test('wheel zoom and blank-space pan only change the SVG viewBox', () => {
  const h = harness(); assert.ok(h.wheel(-250).prevented);
  const before = h.scene.view.slice(); h.send('pointerdown');
  h.send('pointermove', {clientX: 420}); h.send('pointerup', {clientX: 420});
  assert.notEqual(h.scene.view[0], before[0]); assert.equal(h.scene.view[2], before[2]);
  assert.equal(h.state.car, 195); assert.equal(h.state.observer, 493);
  assert.equal(h.captured.size, 0); assert.equal(h.classes.size, 0);
});

test('object drag uses world coordinates after zoom and does not pan the camera', () => {
  const h = harness(); h.wheel(-Math.log(2) / .0025);
  const before = h.scene.view.slice();
  h.send('pointerdown', {clientX: 200, target: {getAttribute: () => 'car'}});
  h.send('pointermove', {clientX: 240}); h.send('pointerup', {clientX: 240});
  near(h.state.car, 215); assert.deepEqual(h.scene.view, before);
});

test('observer drag remains vertical after zoom and clamps to the road range', () => {
  const h = harness(); h.wheel(-Math.log(2) / .0025);
  h.send('pointerdown', {target: {getAttribute: () => 'observer'}});
  h.send('pointermove', {clientX: 500, clientY: 360});
  near(h.state.observer, 513); assert.equal(h.state.car, 195);
  h.send('pointermove', {clientY: 1000}); assert.equal(h.state.observer, 565);
});

test('shift-wheel pans while trackpad ctrl-wheel zooms', () => {
  const h = harness(); h.wheel(-Math.log(2) / .0025);
  const initial = h.snapshot();
  h.send('wheel', {shiftKey: true, deltaX: 0, deltaY: 40, deltaMode: 0});
  near(h.snapshot().x, initial.x + 20); near(h.snapshot().zoom, initial.zoom);
  h.send('wheel', {ctrlKey: true, deltaX: -100, deltaY: -40, deltaMode: 0});
  assert.ok(h.snapshot().zoom > initial.zoom);
});

test('two-finger pinch preserves the world point under the moving midpoint', () => {
  const h = harness(); h.wheel(-Math.log(2) / .0025);
  h.send('pointerdown', {pointerId: 1, clientX: 310, clientY: 270});
  h.send('pointerdown', {pointerId: 2, clientX: 470, clientY: 370});
  h.send('pointermove', {pointerId: 1, clientX: 270, clientY: 250});
  const [x, y, w, height] = h.scene.view;
  near(x + (370 - 10) / 760 * w, 380); near(y + (310 - 20) / 600 * height, 300);
  assert.ok(h.snapshot().zoom > 2); assert.equal(h.state.car, 195);
});

test('two-finger translation pans without changing scale once both fingers move', () => {
  const h = harness(); h.wheel(-Math.log(2) / .0025);
  const initial = h.snapshot();
  h.send('pointerdown', {pointerId: 1, clientX: 310, clientY: 270});
  h.send('pointerdown', {pointerId: 2, clientX: 470, clientY: 370});
  h.send('pointermove', {pointerId: 1, clientX: 340, clientY: 290});
  h.send('pointermove', {pointerId: 2, clientX: 500, clientY: 390});
  near(h.snapshot().zoom, initial.zoom); near(h.snapshot().x, initial.x - 15); near(h.snapshot().y, initial.y - 10);
});

test('adding a second finger switches an object drag to pinch without moving the object', () => {
  const h = harness();
  h.send('pointerdown', {clientX: 205, clientY: 333, target: {getAttribute: () => 'car'}});
  h.send('pointermove', {clientX: 225, clientY: 333}); assert.equal(h.state.car, 215);
  h.send('pointerdown', {pointerId: 2, clientX: 405, clientY: 333});
  h.send('pointermove', {pointerId: 2, clientX: 445, clientY: 333});
  assert.equal(h.snapshot().gesture, 'pinch'); assert.equal(h.state.car, 215);
  h.send('pointerup', {pointerId: 2});
  h.send('pointermove', {clientX: 245, clientY: 333});
  assert.equal(h.snapshot().gesture, 'pan'); assert.equal(h.state.car, 215);
});

for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'visibilitychange']) {
  test(`${reason} clears all touch and capture state`, () => {
    const h = harness(); h.send('pointerdown'); h.send('pointerdown', {pointerId: 2, clientX: 490});
    if (reason === 'blur') h.global(reason);
    else if (reason === 'visibilitychange') { h.context.document.hidden = true; h.global(reason); }
    else h.send(reason);
    assert.equal(h.snapshot().pointers, 0); assert.equal(h.snapshot().gesture, undefined);
    assert.equal(h.captured.size, 0); assert.equal(h.classes.size, 0);
    h.send('pointerdown'); assert.equal(h.snapshot().gesture, 'pan');
  });
}

test('touch targets remain at least 44 CSS pixels at small display scales', () => {
  const h = harness(.4);
  assert.ok(h.carHit.attrs.width * .4 >= 44); assert.ok(h.carHit.attrs.height * .4 >= 44);
  assert.ok(h.observerHit.attrs.r * 2 * .4 >= 44);
});
