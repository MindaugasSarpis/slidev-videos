// StagePhoto resolves its photo and depth map against the deck's base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl } from '../components/video-dust/bus.js';

test('a root path goes under a non-root base (GitHub Pages)', () => {
  const base = '/cern_outreach_talks/2026_10_00_Innoday/';
  assert.equal(assetUrl('/figures/hero_pet.jpg', base), '/cern_outreach_talks/2026_10_00_Innoday/figures/hero_pet.jpg');
  assert.equal(assetUrl('/figures/hero_pet.depth.png', base.slice(0, -1)), '/cern_outreach_talks/2026_10_00_Innoday/figures/hero_pet.depth.png');
});

test('base / and paths that need nothing are left alone', () => {
  const base = '/talks/x/';
  assert.equal(assetUrl('/figures/a.jpg', '/'), '/figures/a.jpg');
  assert.equal(assetUrl('/figures/a.jpg'), '/figures/a.jpg');            // no Vite env: base /
  assert.equal(assetUrl('/talks/x/figures/a.jpg', base), '/talks/x/figures/a.jpg');
  assert.equal(assetUrl('figures/a.jpg', base), 'figures/a.jpg');
  assert.equal(assetUrl('https://example.org/a.jpg', base), 'https://example.org/a.jpg');
  assert.equal(assetUrl('//cdn.example.org/a.jpg', base), '//cdn.example.org/a.jpg');
  assert.equal(assetUrl('data:image/png;base64,AA', base), 'data:image/png;base64,AA');
});
