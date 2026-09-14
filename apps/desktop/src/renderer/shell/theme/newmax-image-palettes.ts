import type { ImageThemePalette } from './newmax-theme-engine.js';

/** Exact preset palettes from NewMax `PRESET_IMAGE_THEMES`. */
export const NEWMAX_IMAGE_THEME_PALETTES: Record<string, ImageThemePalette> = {
  'preset-lakewood': {
    background: '#eaebeb',
    foreground: '#313333',
    accent: '#042a18',
    accents: { neutral: '#d2d6d6', soft: '#042a18', rich: '#146b27' },
    luminance: 0.3032398132243664,
    mood: 'noir',
  },
  'preset-palm-shore': {
    background: '#91d1e8',
    foreground: '#273033',
    accent: '#6bbbda',
    accents: { neutral: '#d0edf2', soft: '#6bbbda', rich: '#34bfed' },
    luminance: 0.6206062241950653,
    mood: 'crisp',
  },
  'preset-ember-rock': {
    background: '#cc704d',
    foreground: '#2e2420',
    accent: '#d89568',
    accents: { neutral: '#b9a192', soft: '#d89568', rich: '#bb5335' },
    luminance: 0.3312231231289216,
    mood: 'crisp',
  },
  'preset-atoll-blue': {
    background: '#ced3d4',
    foreground: '#2e3030',
    accent: '#cfaa92',
    accents: { neutral: '#ebe7e8', soft: '#cfaa92', rich: '#e28754' },
    luminance: 0.5311629079875587,
    mood: 'crisp',
  },
  'preset-leaf-shadow': {
    background: '#c8cdd1',
    foreground: '#2d2f30',
    accent: '#bdc2c6',
    accents: { neutral: '#bfc2c4', soft: '#bdc2c6', rich: '#6dcbff' },
    luminance: 0.5826958814758844,
    mood: 'crisp',
  },
  'preset-alpenglow': {
    background: '#6bb3ae',
    foreground: '#222c2c',
    accent: '#58aba6',
    accents: { neutral: '#83a29f', soft: '#58aba6', rich: '#00b3ad' },
    luminance: 0.34979578153177787,
    mood: 'crisp',
  },
};
