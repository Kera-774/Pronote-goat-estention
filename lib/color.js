/* Pronote GOAT — outils couleur
 * Analyse, mélange et luminance de couleurs. Sert au moteur de thèmes (calcul
 * des nuances attendues par Pronote) et à l'aperçu du popup.
 */
(function (root) {
  'use strict';

  const PG = (root.PG = root.PG || {});

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const round = (n) => Math.round(n * 100) / 100;

  function parse(input) {
    if (!input) return null;
    if (typeof input === 'object' && 'r' in input) return input;
    const s = String(input).trim().toLowerCase();

    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }

    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      if (p.length < 3 || p.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
      return { r: p[0], g: p[1], b: p[2], a: Number.isFinite(p[3]) ? p[3] : 1 };
    }
    return null;
  }

  function toHex(c) {
    const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  // t = part de la seconde couleur (0 → a, 1 → b)
  function mix(a, b, t) {
    const x = parse(a);
    const y = parse(b);
    if (!x || !y) return a || b;
    return toHex({
      r: x.r + (y.r - x.r) * t,
      g: x.g + (y.g - x.g) * t,
      b: x.b + (y.b - x.b) * t
    });
  }

  function luminance(input) {
    const c = parse(input);
    if (!c) return 1;
    const ch = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const isDark = (c) => luminance(c) < 0.35;

  function triplet(input) {
    const c = parse(input) || { r: 0, g: 0, b: 0 };
    return round(c.r) + ', ' + round(c.g) + ', ' + round(c.b);
  }

  function rgba(input, alpha) {
    return 'rgba(' + triplet(input) + ', ' + clamp(alpha, 0, 1) + ')';
  }

  // Couleur de texte lisible sur un fond donné.
  const readableOn = (bg) => (luminance(bg) > 0.45 ? '#111111' : '#ffffff');

  // Nuances « scaleMoinsN / scalePlusN » que Pronote déclare pour chacune de
  // ses couleurs : Moins = vers le noir, Plus = vers le blanc.
  const SCALES_MOINS = [50, 40, 30, 20, 15, 10, 2];
  const SCALES_PLUS = [6, 10, 20, 60, 80];

  function scales(name, value) {
    const out = {};
    out[name] = value;
    out[name + '-rgb'] = triplet(value);
    for (const n of SCALES_MOINS) out[name + '-scaleMoins' + n] = mix(value, '#000000', n / 100);
    for (const n of SCALES_PLUS) out[name + '-scalePlus' + n] = mix(value, '#ffffff', n / 100);
    return out;
  }

  PG.color = { parse, toHex, mix, luminance, contrast, isDark, triplet, rgba, readableOn, scales };
})(typeof globalThis !== 'undefined' ? globalThis : self);
