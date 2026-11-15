// The look plan, in one place. Dusk over an industrial yard: cold slate and
// concrete, warm amber lamps and hazard paint, Vanguard steel-blue against
// Raider rust-orange. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0f1318', // sky / fog
  surface: '#1b2027', // concrete
  hairline: '#2e353e', // steel trim
  ink: '#e8e4d8', // bone white
  muted: '#8b949c', // grey-blue
  accent: '#f0a830', // amber lamps
  vanguard: '#4f8fd0', // player team
  raider: '#c65a3a', // enemy team
  hazard: '#d8b13a', // hazard stripes
};

export function shade(name) {
  return PALETTE[name];
}
