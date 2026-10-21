// Original vector art: Doña Rosa's portrait and the chancla icon. Built as
// SVG strings so they scale crisply and need no image downloads.

export type Mood = 'smirk' | 'happy' | 'sad';

function mouth(mood: Mood): string {
  if (mood === 'happy') return '<path d="M104 178 Q125 198 146 178 Q125 186 104 178 Z" fill="#b5122b"/><path d="M110 181 Q125 190 140 181" stroke="#fff" stroke-width="3" fill="none"/>';
  if (mood === 'sad') return '<path d="M106 188 Q125 174 144 188" stroke="#b5122b" stroke-width="7" fill="none" stroke-linecap="round"/>';
  return '<path d="M106 182 Q122 186 146 174 Q130 194 108 186 Z" fill="#b5122b"/>';
}

function brows(mood: Mood): string {
  if (mood === 'sad') return '<path d="M84 118 Q98 112 112 120" stroke="#2a1630" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M138 120 Q152 112 166 118" stroke="#2a1630" stroke-width="6" fill="none" stroke-linecap="round"/>';
  // One eyebrow raised: unimpressed.
  return '<path d="M82 112 Q98 96 114 110" stroke="#2a1630" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M138 118 Q152 114 168 118" stroke="#2a1630" stroke-width="6" fill="none" stroke-linecap="round"/>';
}

export function chanclaSVG(rotate = -20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><g transform="rotate(${rotate} 60 40)">
<path d="M14 40 C14 22 34 14 60 16 C92 18 108 26 108 40 C108 54 92 62 60 64 C34 66 14 58 14 40 Z" fill="#4b2a6b"/>
<path d="M20 40 C20 26 36 21 60 22 C88 23 101 29 101 40 C101 51 88 57 60 58 C36 59 20 54 20 40 Z" fill="#4fb3a9"/>
<path d="M58 18 C74 18 80 30 80 40 C80 50 74 62 58 62 C66 54 68 47 68 40 C68 33 66 26 58 18 Z" fill="#c8553d"/>
<path d="M66 20 C72 26 74 33 74 40 C74 47 72 54 66 60" stroke="#f4e6c8" stroke-width="4" fill="none"/>
<g transform="translate(74 40)"><circle r="6" fill="#f2a33a"/><circle cx="7" r="5" fill="#f2a33a"/><circle cx="-7" r="5" fill="#f2a33a"/><circle cy="7" r="5" fill="#f2a33a"/><circle cy="-7" r="5" fill="#f2a33a"/><circle r="3.5" fill="#e8871e"/></g>
</g></svg>`;
}

export function rosaSVG(mood: Mood = 'smirk', crop: 'full' | 'face' = 'full'): string {
  const vb = crop === 'face' ? '50 40 150 170' : '0 0 250 300';
  const bg = crop === 'face'
    ? '<rect x="0" y="0" width="250" height="300" fill="#4fb3a9"/>'
    : `<rect width="250" height="300" fill="#4fb3a9"/>
<circle cx="125" cy="140" r="118" fill="#f2a33a" opacity="0.9"/>
<g fill="#f4e6c8" opacity="0.35">${Array.from({ length: 12 }, (_, i) => `<path d="M125 140 L${125 + Math.cos((i / 12) * Math.PI * 2) * 200} ${140 + Math.sin((i / 12) * Math.PI * 2) * 200} L${125 + Math.cos(((i + 0.4) / 12) * Math.PI * 2) * 200} ${140 + Math.sin(((i + 0.4) / 12) * Math.PI * 2) * 200} Z"/>`).join('')}</g>
<g>${['#e86a8d', '#f4e6c8', '#c8553d', '#4b2a6b', '#e86a8d', '#f4e6c8'].map((c, i) => `<path d="M${i * 44 - 4} 0 h40 v26 l-6 6 l-6 -6 l-6 6 l-6 -6 l-6 6 l-4 -6 Z" fill="${c}"/>`).join('')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid slice">
${bg}
<!-- dress -->
<path d="M40 300 C44 248 78 226 125 224 C172 226 206 248 210 300 Z" fill="#4b2a6b"/>
<g fill="#f4e6c8">${[[70, 262], [100, 248], [150, 248], [180, 262], [90, 284], [125, 270], [160, 284], [60, 292], [195, 292]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('')}</g>
<path d="M98 226 L125 252 L152 226" fill="none" stroke="#f4e6c8" stroke-width="7" stroke-linejoin="round"/>
<rect x="110" y="196" width="30" height="34" rx="10" fill="#b57a50"/>
<!-- hair back -->
<ellipse cx="125" cy="128" rx="70" ry="72" fill="#2a1630"/>
<circle cx="125" cy="56" r="44" fill="#2a1630"/>
<circle cx="104" cy="44" r="16" fill="#3b2244"/>
<!-- face -->
<ellipse cx="125" cy="146" rx="54" ry="62" fill="#c68a5e"/>
<ellipse cx="72" cy="152" rx="10" ry="14" fill="#b57a50"/>
<ellipse cx="178" cy="152" rx="10" ry="14" fill="#b57a50"/>
<circle cx="70" cy="178" r="13" fill="none" stroke="#f5c542" stroke-width="5"/>
<circle cx="180" cy="178" r="13" fill="none" stroke="#f5c542" stroke-width="5"/>
<!-- hair front -->
<path d="M72 120 C76 84 104 70 128 72 C156 72 178 90 178 122 C164 100 146 92 124 94 C104 96 86 104 72 120 Z" fill="#2a1630"/>
<path d="M118 76 C128 84 136 96 136 110" stroke="#3b2244" stroke-width="5" fill="none"/>
<!-- flower -->
<g transform="translate(166 78)">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="11" ry="7" transform="rotate(${a}) translate(10 0)" fill="#f2a33a"/>`).join('')}<circle r="6" fill="#c8553d"/></g>
${brows(mood)}
<!-- cat-eye sunglasses, lowered a touch so the stare comes over the top -->
<path d="M78 128 Q76 120 86 120 L114 122 Q120 124 118 132 Q114 146 98 146 Q82 146 78 128 Z" fill="#241626"/>
<path d="M132 132 Q130 124 136 122 L164 120 Q174 120 172 128 Q168 146 152 146 Q136 146 132 132 Z" fill="#241626"/>
<path d="M72 118 L86 120 M164 120 L178 116" stroke="#4fb3a9" stroke-width="6" stroke-linecap="round"/>
<path d="M118 128 Q125 124 132 128" stroke="#4fb3a9" stroke-width="5" fill="none"/>
<path d="M86 126 L98 124" stroke="#ffffff" stroke-width="3" opacity="0.6" stroke-linecap="round"/>
<path d="M140 126 L152 124" stroke="#ffffff" stroke-width="3" opacity="0.6" stroke-linecap="round"/>
<!-- nose, mole, cheeks -->
<path d="M124 148 Q120 162 128 164" stroke="#9b6740" stroke-width="4" fill="none" stroke-linecap="round"/>
<circle cx="150" cy="170" r="2.6" fill="#2a1630"/>
<ellipse cx="92" cy="164" rx="10" ry="6" fill="#e86a8d" opacity="0.35"/>
<ellipse cx="158" cy="164" rx="10" ry="6" fill="#e86a8d" opacity="0.35"/>
${mouth(mood)}
${crop === 'full' ? `<!-- raised hand with chancla -->
<g transform="translate(196 196) rotate(-12)">
<rect x="-12" y="-10" width="26" height="70" rx="12" fill="#4b2a6b"/>
<rect x="-10" y="-6" width="22" height="10" rx="4" fill="#f5c542"/>
<ellipse cx="1" cy="-24" rx="16" ry="18" fill="#c68a5e"/>
<g transform="translate(2 -50) rotate(-70) scale(0.55)">${chanclaSVG(0).replace(/<\/?svg[^>]*>/g, '')}</g>
</g>` : ''}
</svg>`;
}

export function svgUrl(svg: string): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
