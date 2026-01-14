import { Team } from './types';

export interface MapConfig {
  name: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  imageUrl: string;
  imageUrls?: string[]; // For maps with multiple floors (e.g., Vertigo)
  rotationOffset?: number; // Rotation offset in degrees for view angle correction (default: 180)
  positionBasedRotation?: (normalizedX: number, normalizedY: number) => number; // Optional function to calculate position-based rotation adjustment
}

// Map boundaries derived from CS:GO/CS2 radar overview data
// Formula: Width = ImagePixelWidth * Scale
// MinX = pos_x
// MaxX = pos_x + (1024 * scale)
// MaxY = pos_y
// MinY = pos_y - (1024 * scale) (Since Y goes up in game, but image is top-down)
export const MAPS: Record<string, MapConfig> = {
  'de_mirage': {
    name: 'Mirage',
    minX: -3230,
    maxX: -3230 + (1024 * 5.0), // 1890
    maxY: 1713,
    minY: 1713 - (1024 * 5.0), // -3407
    imageUrl: '/maps/de_mirage.png',
    rotationOffset: 90, // Base rotation offset
    // Position-based rotation: different adjustments for each quadrant
    positionBasedRotation: (normalizedX: number, normalizedY: number) => {
      // normalizedX: 0 = left, 1 = right
      // normalizedY: 0 = bottom, 1 = top (inverted because Y increases upward in CS2)
      // Divide map into 4 quadrants:
      const isLeft = normalizedX < 0.5;
      const isTop = normalizedY < 0.5; // Top in normalized coordinates (which is actually bottom in world Y)
      
      if (isLeft && isTop) {
        // Top-left quadrant
        return 0;
      } else if (!isLeft && isTop) {
        // Top-right quadrant
        return 0; // Adjust as needed
      } else if (isLeft && !isTop) {
        // Bottom-left quadrant
        return -90; // Adjust as needed
      } else {
        // Bottom-right quadrant
        return -90; // Adjust as needed
      }
    }
  },
  'de_inferno': {
    name: 'Inferno',
    minX: -2087,
    maxX: -2087 + (1024 * 4.9),
    maxY: 3870,
    minY: 3870 - (1024 * 4.9),
    imageUrl: '/maps/de_inferno.png'
  },
  'de_dust2': {
    name: 'Dust II',
    minX: -2476,
    maxX: -2476 + (1024 * 4.4),
    maxY: 3239,
    minY: 3239 - (1024 * 4.4),
    imageUrl: '/maps/de_dust2.png'
  },
  'de_nuke': {
    name: 'Nuke',
    minX: -3453,
    maxX: -3453 + (1024 * 7.0),
    maxY: 2887,
    minY: 2887 - (1024 * 7.0),
    imageUrl: '/maps/de_nuke.png'
  },
  'de_overpass': {
    name: 'Overpass',
    minX: -4831,
    maxX: -4831 + (1024 * 5.2),
    maxY: 1781,
    minY: 1781 - (1024 * 5.2),
    imageUrl: '/maps/de_overpass.png'
  },
  'de_vertigo': {
    name: 'Vertigo',
    minX: -3168,
    maxX: -3168 + (1024 * 4.0),
    maxY: 1762,
    minY: 1762 - (1024 * 4.0),
    imageUrl: '/maps/de_vertigo.png',
    imageUrls: ['/maps/de_vertigo.png', '/maps/de_vertigo_lower.png'] // Upper and lower floors
  },
  'de_ancient': {
    name: 'Ancient',
    minX: -2953,
    maxX: -2953 + (1024 * 5.0),
    maxY: 2164,
    minY: 2164 - (1024 * 5.0),
    imageUrl: '/maps/de_ancient.png'
  },
  'de_anubis': {
    name: 'Anubis',
    minX: -2796,
    maxX: -2796 + (1024 * 5.22),
    maxY: 3328,
    minY: 3328 - (1024 * 5.22),
    imageUrl: '/maps/de_anubis.png',
    rotationOffset: -180 // Anubis needs -90° rotation
  },
  'de_cache': {
    name: 'Cache',
    minX: -2000,
    maxX: -2000 + (1024 * 5.0),
    maxY: 3250,
    minY: 3250 - (1024 * 5.0),
    imageUrl: '/maps/de_cache.png'
  },
  'de_cbble': {
    name: 'Cobblestone',
    minX: -3840,
    maxX: -3840 + (1024 * 5.0),
    maxY: 3072,
    minY: 3072 - (1024 * 5.0),
    imageUrl: '/maps/de_cbble.png'
  },
  'de_train': {
    name: 'Train',
    minX: -2477,
    maxX: -2477 + (1024 * 4.7),
    maxY: 2392,
    minY: 2392 - (1024 * 4.7),
    imageUrl: '/maps/de_train.png'
  }
};

// Fallback config
export const DEFAULT_MAP = MAPS['de_mirage'];

/**
 * Helper to get map config with fuzzy matching.
 * Handles "workshop/123/de_mirage" -> returns 'de_mirage' config.
 * If unknown, tries to construct a generic config pointing to /maps/{name}.jpg
 */
export const getMapConfig = (rawMapName: string): MapConfig => {
  if (!rawMapName) return DEFAULT_MAP;
  
  const lowerName = rawMapName.toLowerCase();

  // 1. Exact match
  if (MAPS[lowerName]) return MAPS[lowerName];

  // 2. Fuzzy match (longest match wins)
  const keys = Object.keys(MAPS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lowerName.includes(key)) {
      return MAPS[key];
    }
  }

  // 3. Fallback: Attempt to use the provided name to load a local image
  // We use Mirage boundaries as a best-guess default for scale
  // Try .png first, then .jpg as fallback
  const cleanMapName = lowerName.split('/').pop() || lowerName; // Handle workshop paths
  return {
    ...DEFAULT_MAP,
    name: rawMapName,
    imageUrl: `/maps/${cleanMapName}.png`,
    rotationOffset: 180 // Default rotation for unknown maps
  };
};

export const TEAM_COLORS = {
  [Team.CT]: '#5b7fa8', // CT - muted steel blue
  [Team.T]: '#a67c52',  // T - muted rust/amber
  [Team.SPECTATOR]: '#6b7280' // muted gray
};

export const MOCK_PLAYERS = [
  { name: 's1mple', team: Team.CT },
  { name: 'b1t', team: Team.CT },
  { name: 'electronic', team: Team.CT },
  { name: 'Perfecto', team: Team.CT },
  { name: 'Boombl4', team: Team.CT },
  { name: 'NiKo', team: Team.T },
  { name: 'huNter-', team: Team.T },
  { name: 'm0NESY', team: Team.T },
  { name: 'jks', team: Team.T },
  { name: 'HooXi', team: Team.T },
];
