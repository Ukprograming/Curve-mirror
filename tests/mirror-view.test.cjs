const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const model = html.split("(()=>{'use strict';")[1].split('let mirrorFrame=')[0];
const trace = Function(model + 'return traceMirror;')();
const {buildMirrorCar, mirrorCarHit} = Function(model + 'return {buildMirrorCar,mirrorCarHit};')();

function count(pixels, predicate) {
  let result = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] && predicate(pixels[i], pixels[i + 1], pixels[i + 2])) result++;
  }
  return result;
}
const blue = (r, g, b) => r < 20 && g > 140 && b > 220;
const red = (r, g, b) => r > 220 && g < 80 && b > 50 && b < 100;

test('the circular aperture clips the corners and retains an opaque center', () => {
  const pixels = trace(195, 493, true, 160);
  assert.equal(pixels.length, 160 * 160 * 4);
  for (const [x, y] of [[0, 0], [159, 0], [0, 159], [159, 159]]) {
    assert.equal(pixels[(y * 160 + x) * 4 + 3], 0);
  }
  assert.equal(pixels[(80 * 160 + 80) * 4 + 3], 255);
});

test('both headlights and walls remain visible throughout the movement range', () => {
  for (const car of [80, 195, 286]) for (const observer of [430, 493, 565]) {
    const pixels = trace(car, observer, true, 160);
    assert.ok(count(pixels, blue) > 0, `blue: car=${car}, observer=${observer}`);
    assert.ok(count(pixels, red) > 0, `red: car=${car}, observer=${observer}`);
    assert.ok(count(pixels, (r, g, b) => r > 150 && r > g && g > b) > 1000);
  }
});

test('disabling the second headlight removes its reflection while retaining the first', () => {
  const pixels = trace(195, 493, false, 160);
  assert.equal(count(pixels, red), 0);
  assert.ok(count(pixels, blue) > 0);
});

test('car movement and eye movement each change the reflected scene', () => {
  const initial = trace(195, 493, true, 160);
  assert.notDeepEqual(trace(260, 493, true, 160), initial);
  assert.notDeepEqual(trace(195, 550, true, 160), initial);
});

test('the reflected car has a sloping windshield, a white roof and separate wheel hubs', () => {
  const car = buildMirrorCar(true);
  const windshield = mirrorCarHit([100, 0, 24], [-1, 0, 0], car);
  assert.equal(windshield.material, 3);
  assert.ok(windshield.n[0] > 0 && windshield.n[2] > 0);
  assert.equal(mirrorCarHit([0, 0, 100], [0, 0, -1], car).material, 9);
  assert.equal(mirrorCarHit([-21.5, -100, 8], [0, 1, 0], car).material, 10);
});

test('front lights match the upper blue and lower red lights in the plan view', () => {
  const car = buildMirrorCar(true);
  assert.equal(mirrorCarHit([100, -15, 12], [-1, 0, 0], car).material, 4);
  assert.equal(mirrorCarHit([100, 15, 12], [-1, 0, 0], car).material, 5);
  assert.notEqual(mirrorCarHit([100, 15, 12], [-1, 0, 0], buildMirrorCar(false)).material, 5);
});
