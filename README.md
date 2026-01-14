# CSDA - CS2 Demo Analyzer

A client-side CS2 demo analysis tool built with React and TypeScript, using [demoparser2](https://github.com/LaihoE/demoparser) WASM for parsing. CSDA analyzes CS2 demo files to detect AFK players, team kills, team damage, and disconnects.

## Features

- 🎮 **Parse CS2 demo files** directly in the browser using WebAssembly
- ⏸️ **AFK Detection** - Identifies players who are AFK at round start with configurable threshold (5-30s)
  - 5-second grace period after freeze time
  - Tracks full AFK duration, not just threshold
  - Detects players who died while AFK
- 💀 **Team Kill Detection** - Finds friendly fire kills
  - Filters out world/environment kills
  - Filters out kills near server shutdown
- ⚡ **Team Damage Analysis** - Tracks friendly fire damage events
  - Groups sequential damage events (e.g., molotov ticks)
  - Shows initial HP → final HP with total damage
  - Weapon name mapping and capitalization
- 🔌 **Disconnect/Reconnect Tracking** - Monitors player connection issues
  - Tracks disconnection and reconnection times
  - Calculates rounds missed (accounts for death before disconnect, reconnect before freeze end)
  - Visual flags for special cases
- 🎯 **Player Filtering** - Filter analysis results by specific players
- 📊 **Sorting Options** - Sort results alphabetically or by round number
- 📋 **Console Commands** - Generate CS2 console commands for navigation and spectating

## Setup

### Install Dependencies

```bash
npm install
```

### Setup demoparser2 WASM Files (Required for Real Parsing)

The app requires demoparser2 WASM files to parse demo files. Place them in the `public/pkg/` directory.

#### Option 1: From npm package (Recommended)

1. **Install demoparser2:**
   ```bash
   npm install demoparser2
   ```

2. **Copy the WASM files to public folder:**
   ```bash
   # On Windows (PowerShell)
   Copy-Item node_modules/demoparser2/demoparser2.js public/pkg/
   Copy-Item node_modules/demoparser2/demoparser2_bg.wasm public/pkg/
   
   # On Linux/Mac
   cp node_modules/demoparser2/demoparser2.js public/pkg/
   cp node_modules/demoparser2/demoparser2_bg.wasm public/pkg/
   ```

#### Option 2: From the demo repository

1. **Clone the demoparser-wasm-demo repository:**
   ```bash
   git clone https://github.com/LaihoE/demoparser-wasm-demo.git
   cd demoparser-wasm-demo
   ```

2. **Copy the files:**
   ```bash
   # On Windows (PowerShell)
   Copy-Item pkg/demoparser2.js /path/to/cs2-web-replay/public/pkg/
   Copy-Item pkg/demoparser2_bg.wasm /path/to/cs2-web-replay/public/pkg/
   
   # On Linux/Mac
   cp pkg/demoparser2.js /path/to/cs2-web-replay/public/pkg/
   cp pkg/demoparser2_bg.wasm /path/to/cs2-web-replay/public/pkg/
   ```

**Required files structure:**
```
public/
  └── pkg/
      ├── demoparser2.js
      └── demoparser2_bg.wasm
```

The app will automatically detect and use `demoparser2` if available.

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Usage

1. Open the app in your browser
2. Click "Select .dem file" to upload a CS2 demo file (`.dem`)
3. Wait for parsing and analysis to complete (this may take a while for large demos)
4. Review the analysis results:
   - **AFK Detections**: Players who were AFK at round start (adjustable threshold slider)
   - **Team Kills**: Friendly fire kills with round, weapon, and headshot info
   - **Team Damage**: Friendly fire damage events with HP changes
   - **Disconnects**: Player disconnection/reconnection events with rounds missed
5. Use the player filter in the navbar to focus on specific players
6. Use sorting options to organize results (alphabetical or by round)
7. Click the copy button on any event to get console commands for navigation

## Analysis Details

### AFK Detection
- Detects players who don't move after the 5-second grace period following freeze time end
- Tracks full AFK duration until movement, death, or round end
- Configurable threshold (5-30 seconds) via slider
- Shows if player died while AFK

### Team Kills
- Filters out kills by "world" or environment
- Filters out kills near server shutdown (last 10 seconds)
- Shows attacker → victim, round, weapon, and headshot status

### Team Damage
- Groups sequential damage events (within 5 seconds or 64 ticks)
- Shows initial HP → final HP with total damage calculation
- Weapon names are mapped and capitalized (e.g., "inferno" → "Molotov/Incendiary")

### Disconnects
- Tracks disconnection and reconnection times
- Calculates rounds missed (excluding rounds where player died before disconnect or reconnected before freeze end)
- Visual flags for special cases:
  - 💀 Died before disconnect (round not counted as missed)
  - 🛡️ Reconnected before freeze end (round not counted as missed)

## Architecture

- **`services/demoParser.ts`**: Main demo parser that uses demoparser2 WASM
- **`services/demoAnalyzer.ts`**: Analysis engine for detecting AFK, team kills, team damage, and disconnects
- **`services/demoparser2Loader.ts`**: Service to load and initialize demoparser2 WASM
- **`components/AnalysisResults.tsx`**: UI component for displaying analysis results with filtering and sorting
- **`store/useDemoStore.ts`**: Zustand store for managing demo file state

## Notes

- The app requires CS2 (Source 2) demo files. CS:GO (Source 1) demos are not supported.
- Large demo files may take several minutes to parse and analyze.
- Memory usage can be significant (2GB+) for large demos. Memory is released when resetting/uploading a new demo.
- Console commands generated are compatible with CS2's demo viewer console.

## References

- [demoparser2](https://github.com/LaihoE/demoparser) - Rust-based WASM demo parser for CS2
- [demoparser-wasm-demo](https://github.com/LaihoE/demoparser-wasm-demo) - Example implementation
