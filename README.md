# CS2 Web Replay

A client-side CS2 demo parser and 2D map visualizer built with React and TypeScript, using [demoparser2](https://github.com/LaihoE/demoparser) WASM for parsing.

## Features

- 🎮 Parse CS2 demo files directly in the browser using WebAssembly
- 🗺️ Interactive 2D map visualization with player movements
- 🎯 Real-time player tracking and positioning
- ⚡ Fast client-side processing
- 📊 Player statistics and event extraction

## Setup

### Install Dependencies

```bash
npm install
```

### Setup demoparser2 WASM Files (Required for Real Parsing)

The app will work with mock data, but for real demo parsing, you need to place the demoparser2 WASM files in the `public/pkg/` directory.

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

The app will automatically detect and use `demoparser2` if available, otherwise it falls back to mock data.

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
2. Click "Select .dem file" or use the "Open File" button
3. Upload a CS2 demo file (`.dem`)
4. The demo will be parsed and displayed on a 2D map
5. Use the controls to play/pause and seek through the replay

## Map Images

Map images are stored in the `maps/` directory. Supported maps:
- de_mirage
- de_inferno
- de_dust2
- de_nuke
- de_overpass
- de_vertigo
- de_ancient
- de_anubis

You can also upload custom map images by clicking the image icon on the map visualization.

## Architecture

- **`services/demoParser.ts`**: Main demo parser that uses demoparser2 WASM or falls back to hybrid parser
- **`services/demoparser2Loader.ts`**: Service to load and initialize demoparser2 WASM from public folder
- **`components/MapVisualization.tsx`**: 2D map rendering with player positions
- **`components/PlayerList.tsx`**: Player list sidebar
- **`components/Controls.tsx`**: Playback controls

## Notes

- The app requires CS2 (Source 2) demo files. CS:GO (Source 1) demos are not supported.
- For best performance, use `demoparser2` WASM for real demo parsing.
- Map boundaries are configured in `constants.ts` based on CS2 radar data.
- If `demoparser2` files are not found, the app will use a hybrid parser with simulated position data.

## References

- [demoparser2](https://github.com/LaihoE/demoparser) - Rust-based WASM demo parser for CS2
- [demoparser-wasm-demo](https://github.com/LaihoE/demoparser-wasm-demo) - Example implementation
