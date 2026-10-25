// Design tokens for generated study sites (master prompt, Appendix A). Light and dark themes are both
// derived here, and every text pair is checked against WCAG AA before the CSS is written.

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const hsl = (h, s, l) => rgbToHex(hslToRgb([h, s, l]));

function luminance(hex) {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex(ra.map((v, i) => v + (rb[i] - v) * t));
}

/** Moves a colour's lightness until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg, bg, min = 4.5, dir = 'auto') {
  let [h, s, l] = rgbToHsl(hexToRgb(fg));
  const goDark = dir === 'auto' ? luminance(bg) > 0.4 : dir === 'darker';
  for (let i = 0; i < 60 && contrast(hsl(h, s, l), bg) < min; i++) l = clamp(l + (goDark ? -0.015 : 0.015), 0, 1);
  return hsl(h, s, l);
}

const onColor = (bg) => (contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111');

const PRESETS = {
  'calm-pastel': {
    label: 'Calm pastel',
    bg: '#F8F6F1', surface: '#FFFFFF', surface2: '#F2EFE8', line: '#E6E1D6', ink: '#27312F', ink2: '#56625F', ink3: '#6F7A77',
    accent: '#356B5A', radius: 18, radiusSm: 12, display: 'serif',
    shadow: '0 1px 2px rgba(39,49,47,.04), 0 10px 30px rgba(39,49,47,.06)', shadowSm: '0 1px 2px rgba(39,49,47,.05)',
    tones: [['sage', '#7FA896', '#356B5A', '#E4EFE9'], ['sky', '#A9C8E0', '#3A6786', '#E5EFF7'], ['blush', '#E8BEB5', '#9A524A', '#F9E8E4'], ['sand', '#E3D3B5', '#7F6330', '#F6EEDD'], ['lilac', '#C8BEE0', '#5F5290', '#EEEAF7']],
  },
  'bold-editorial': {
    label: 'Bold editorial',
    bg: '#F5F5F7', surface: '#FFFFFF', surface2: '#ECECF0', line: '#DEDEE4', ink: '#111114', ink2: '#45454C', ink3: '#62626B',
    accent: '#2F3CFF', radius: 20, radiusSm: 12, display: 'sans',
    shadow: '0 1px 2px rgba(17,17,20,.05), 0 12px 32px rgba(17,17,20,.08)', shadowSm: '0 1px 2px rgba(17,17,20,.06)',
    toneBases: [['green', '#0F9F5A'], ['amber', '#C97A00'], ['violet', '#7B3CFF'], ['vermilion', '#F0441F'], ['blue', '#2F3CFF']],
  },
  'clean-academic': {
    label: 'Clean academic',
    bg: '#ECEFF3', surface: '#FFFFFF', surface2: '#E3E7ED', line: '#D5DAE2', ink: '#18202E', ink2: '#566173', ink3: '#6B7689',
    accent: '#24325F', radius: 10, radiusSm: 6, display: 'serif',
    shadow: '0 1px 2px rgba(24,32,46,.06), 0 6px 18px rgba(24,32,46,.06)', shadowSm: '0 1px 2px rgba(24,32,46,.06)',
    derived: true,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

function toneList(preset, accent) {
  if (preset.tones) return preset.tones;
  const bases = preset.toneBases
    || ['sage', 'sky', 'rose', 'sand', 'lilac', 'teal'].map((name, i) => {
      const [h] = rgbToHsl(hexToRgb(accent));
      const offsets = [0, 45, -45, 90, -90, 150];
      return [name, hsl(h + offsets[i], 0.38, 0.58)];
    });
  return bases.map(([name, base]) => {
    const wash = mix(base, '#ffffff', 0.88);
    return [name, base, ensureContrast(mix(base, '#000000', 0.25), wash, 4.5, 'darker'), wash];
  });
}

function lightTheme(preset, accent) {
  const acc = ensureContrast(accent, '#ffffff', 4.5, 'darker');
  const soft = mix(acc, '#ffffff', 0.9);
  return {
    bg: preset.bg, surface: preset.surface, surface2: preset.surface2, line: preset.line, line2: mix(preset.line, preset.surface, 0.5),
    ink: ensureContrast(preset.ink, preset.bg, 7), ink2: ensureContrast(preset.ink2, preset.surface2, 4.6), ink3: ensureContrast(preset.ink3, preset.surface2, 4.5),
    accent: acc, accentInk: onColor(acc), accentSoft: soft, accentSoftInk: ensureContrast(acc, soft, 4.5, 'darker'), accentHover: mix(acc, '#000000', 0.12),
    ok: '#2F7A4F', okSoft: '#E3F1E8', bad: '#A2382F', badSoft: '#FBE8E5', warn: '#8A5A00', warnSoft: '#FBF0D8',
  };
}

function darkTheme(preset, accent) {
  const [h] = rgbToHsl(hexToRgb(accent));
  const bg = hsl(h, 0.16, 0.08);
  const surface = hsl(h, 0.14, 0.115);
  const surface2 = hsl(h, 0.13, 0.155);
  const acc = ensureContrast(mix(accent, '#ffffff', 0.25), surface, 4.8, 'lighter');
  const soft = mix(acc, surface, 0.84);
  return {
    bg, surface, surface2, line: hsl(h, 0.1, 0.22), line2: hsl(h, 0.1, 0.17),
    ink: hsl(h, 0.1, 0.93), ink2: hsl(h, 0.08, 0.74), ink3: hsl(h, 0.06, 0.62),
    accent: acc, accentInk: onColor(acc), accentSoft: soft, accentSoftInk: ensureContrast(acc, soft, 4.5, 'lighter'), accentHover: mix(acc, '#ffffff', 0.12),
    ok: '#6FCB93', okSoft: mix('#6FCB93', surface, 0.84), bad: '#F08A80', badSoft: mix('#F08A80', surface, 0.84), warn: '#E5B655', warnSoft: mix('#E5B655', surface, 0.84),
  };
}

const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/([a-z])(\d)/g, '$1-$2');
const vars = (t) => Object.entries(t).map(([k, v]) => `--${kebab(k)}:${v}`).join(';');

export function buildTokens({ preset: presetName = 'calm-pastel', accent: custom = null } = {}) {
  const preset = PRESETS[presetName] || PRESETS['calm-pastel'];
  const accent = custom || preset.accent;
  const light = lightTheme(preset, accent);
  const dark = darkTheme(preset, accent);
  light.muted = light.ink2; // alias used by SVG figures
  dark.muted = dark.ink2;
  const tones = toneList(preset, accent);
  const darkSurface = dark.surface;

  const toneLight = tones.map(([n, base, text, wash]) => `.tone-${n}{--t:${base};--t-d:${text};--t-l:${wash}}`).join('\n');
  const toneDark = tones.map(([n, base, text]) => {
    const wash = mix(base, darkSurface, 0.84);
    return `.tone-${n}{--t:${base};--t-d:${ensureContrast(mix(base, '#ffffff', 0.3), wash, 4.5, 'lighter')};--t-l:${wash}}`;
  }).join('\n');

  const shape = `--radius:${preset.radius}px;--radius-sm:${preset.radiusSm}px;--shadow:${preset.shadow};--shadow-sm:${preset.shadowSm};--display-weight:${preset.display === 'sans' ? 800 : 600};--display-tracking:${preset.display === 'sans' ? '-0.02em' : '0'};--font-display:var(${preset.display === 'sans' ? '--font-sans' : '--font-serif'})`;
  const css = `/* Generated by Folio. Preset: ${preset.label}. Edit freely: every colour, radius and shadow of the site comes from these variables. */
:root{${vars(light)};${shape};color-scheme:light}
:root[data-theme="dark"]{${vars(dark)};color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${vars(dark)};color-scheme:dark}}
${toneLight}
:root[data-theme="dark"] ${toneDark.split('\n').join('\n:root[data-theme="dark"] ')}
@media (prefers-color-scheme:dark){
${toneDark.split('\n').map((l) => `:root:not([data-theme="light"]) ${l}`).join('\n')}
}
`;
  return { css, themeColor: light.bg, themeColorDark: dark.bg, toneNames: tones.map((t) => t[0]), accent: light.accent, preset: presetName };
}
