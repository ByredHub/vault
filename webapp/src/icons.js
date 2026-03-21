/**
 * Category definitions with REAL brand icons.
 * Uses Simple Icons CDN (cdn.simpleicons.org) for official logos
 * and Bootstrap Icons as fallback.
 */

export const CATEGORIES = [
  { slug: 'steam',      name: 'Steam',          simpleIcon: 'steam',       brandColor: '66c0f4', gradient: 'linear-gradient(135deg, #1b2838, #2a475e)' },
  { slug: 'fortnite',   name: 'Fortnite',       simpleIcon: 'fortnite',    brandColor: '00b4ff', gradient: 'linear-gradient(135deg, #0d1b2a, #1565c0)' },
  { slug: 'mihoyo',     name: 'Genshin Impact', simpleIcon: 'mihoyo',      brandColor: 'd4a843', gradient: 'linear-gradient(135deg, #1a1520, #4a3728)' },
  { slug: 'riot',       name: 'Valorant / LoL', simpleIcon: 'riotgames',   brandColor: 'ff4655', gradient: 'linear-gradient(135deg, #111, #8b0000)' },
  { slug: 'telegram',   name: 'Telegram',       simpleIcon: 'telegram',    brandColor: '26a5e4', gradient: 'linear-gradient(135deg, #0a2040, #0088cc)' },
  { slug: 'discord',    name: 'Discord',        simpleIcon: 'discord',     brandColor: '5865f2', gradient: 'linear-gradient(135deg, #1a1c2e, #5865f2)' },
  { slug: 'supercell',  name: 'Supercell',      simpleIcon: 'supercell',   brandColor: 'f05a23', gradient: 'linear-gradient(135deg, #141414, #3d3d00)' },
  { slug: 'origin',     name: 'EA / Origin',    simpleIcon: 'ea',          brandColor: 'ff4747', gradient: 'linear-gradient(135deg, #1a1008, #a04000)' },
  { slug: 'epicgames',  name: 'Epic Games',     simpleIcon: 'epicgames',   brandColor: 'ffffff', gradient: '#1a1a1a' },
  { slug: 'vpn',        name: 'VPN',            simpleIcon: null, bi: 'bi-shield-lock-fill', brandColor: '4caf50', gradient: 'linear-gradient(135deg, #0a1a15, #047857)' },
  { slug: 'tiktok',     name: 'TikTok',         simpleIcon: 'tiktok',      brandColor: 'ff004f', gradient: '#0a0a0a' },
  { slug: 'instagram',  name: 'Instagram',      simpleIcon: 'instagram',   brandColor: 'e4405f', gradient: 'linear-gradient(135deg, #1a0a20, #831843)' },
  { slug: 'spotify',    name: 'Spotify',        simpleIcon: 'spotify',     brandColor: '1db954', gradient: 'linear-gradient(135deg, #0a1a0d, #15803d)' },
];

/**
 * Render an <img> tag using Simple Icons CDN.
 * URL format: https://cdn.simpleicons.org/{slug}/{hexcolor}
 */
function siImg(slug, color, size = 18) {
  return `<img src="https://cdn.simpleicons.org/${slug}/${color}" width="${size}" height="${size}" alt="" loading="lazy" style="display:block" />`;
}

/**
 * Render a category icon as HTML
 */
export function getCategoryIcon(slug, size = 18) {
  const cat = CATEGORIES.find(c => c.slug === slug);
  if (!cat) return `<i class="bi bi-box" style="font-size:${size}px;color:#666"></i>`;

  if (cat.simpleIcon) {
    return siImg(cat.simpleIcon, cat.brandColor, size);
  }
  // Bootstrap Icon fallback
  if (cat.bi) {
    return `<i class="bi ${cat.bi}" style="font-size:${size}px;color:#${cat.brandColor}"></i>`;
  }
  return `<i class="bi bi-box" style="font-size:${size}px;color:#${cat.brandColor}"></i>`;
}

/**
 * Render a category chip icon — the brand icon at chip size
 */
export function getCategoryChipIcon(slug) {
  return getCategoryIcon(slug, 16);
}
