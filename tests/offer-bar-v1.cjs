/* Moving offer bar and featured menu items (owner request, October 17, 2026). Source checks only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const header = fs.readFileSync(path.join(root, 'components/store/header.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/storefront-v36.css'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
// The 10-pack figure comes from the same live setting as the homepage pack cards, never a hard-coded number.
assert.match(header, /<OfferBar packDiscount=\{store\.config\?\.packDiscounts\?\.\['10'\]\}/);
assert.match(header, /packDiscount \? `Save \$\{packDiscount\}% with a 10-pack` : 'Build a 10-pack'/);
assert(!/Save \d+%/.test(header), 'No hard-coded discount');
// The shipping line appears only when a free-shipping threshold is configured.
assert.match(header, /shipping=\{terms\.freeThreshold === null \? null : terms\.banner\}/);
// The loop copy is hidden from assistive technology and the keyboard.
assert.match(header, /aria-hidden=\{hidden \|\| undefined\}/);
assert.match(header, /tabIndex=\{hidden \? -1 : undefined\}/);
// Pauses on hover or focus; still for reduced motion; the menu glint also stops.
assert.match(css, /\.offer-bar:hover \.offer-track,\.offer-bar:focus-within \.offer-track\{animation-play-state:paused\}/);
assert.match(css, /prefers-reduced-motion:reduce\)\{\.offer-track\{animation:none/);
assert.match(css, /prefers-reduced-motion:reduce\)\{\.main-nav a\.nav-feature,\.menu-sheet nav a\.nav-feature\{animation:none\}/);
// The featured items wiggle briefly while the glint passes; mild (3 degrees at most) and still for reduced motion.
assert.match(css, /animation:nav-feature-glint 3\.6s ease-in-out infinite,nav-feature-shake 3\.6s ease-in-out infinite/);
assert.match(css, /@keyframes nav-feature-shake\{0%,58%\{transform:none\}/);
const shake = css.match(/@keyframes nav-feature-shake\{.*?\}\}/)[0];
assert([...shake.matchAll(/rotate\((-?[\d.]+)deg\)/g)].every(m => Math.abs(Number(m[1])) <= 3), 'shake stays at 3 degrees or less');
// Softgels and Sprays are the featured menu items, in both menus.
assert.match(header, /featuredNav = new Set\(\['\/softgels', '\/shop\?category=spray-products', '\/locations'\]\)/);
assert.equal((header.match(/className=\{navClass\(p\)\}/g) || []).length, 2);
assert.match(layout, /import "\.\/storefront-v36\.css";/);
console.log('PASS: offer bar reads the live 10-pack discount and shipping threshold, pauses and respects reduced motion; Softgels, Sprays and Locations featured in both menus');
