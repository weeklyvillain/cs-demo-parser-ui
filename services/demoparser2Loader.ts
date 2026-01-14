/**
 * Service to load and initialize demoparser2 WASM module from public folder
 * Based on: https://github.com/LaihoE/demoparser-wasm-demo
 * 
 * Files needed in public/pkg/:
 * - demoparser2.js
 * - demoparser2_bg.wasm
 */

interface IDemoParser2 {
  parseTicks: (buffer: ArrayBuffer | Uint8Array, fields: string[], wantedTicks?: Int32Array | null, wantedPlayers?: string[] | null, structOfArrays?: boolean | null) => any[];
  parseEvents: (buffer: ArrayBuffer | Uint8Array, eventNames?: string[]) => any[];
  parseHeader?: (buffer: ArrayBuffer | Uint8Array) => any;
  parseGrenades?: (buffer: ArrayBuffer | Uint8Array, extra?: string[] | null, grenades?: boolean | null) => any[];
  listUpdatedFields?: (buffer: ArrayBuffer | Uint8Array) => any;
  parseVoice?: (buffer: ArrayBuffer | Uint8Array) => any[];
}

declare global {
  interface Window {
    wasm_bindgen?: any;
    demoparser2?: IDemoParser2;
  }
}

let parserInstance: IDemoParser2 | null = null;
let isLoading = false;
let loadPromise: Promise<IDemoParser2 | null> | null = null;

/**
 * Loads demoparser2 from public/pkg/ folder
 * Files should be placed at: public/pkg/demoparser2.js and public/pkg/demoparser2_bg.wasm
 */
export async function loadDemoparser2(): Promise<IDemoParser2 | null> {
  if (parserInstance) {
    return parserInstance;
  }

  if (isLoading && loadPromise) {
    return loadPromise;
  }

  isLoading = true;
  loadPromise = (async () => {
    try {
      if (typeof window === 'undefined') {
        console.warn('Cannot load demoparser2: window is undefined');
        return null;
      }

      // Check if already loaded
      if (window.wasm_bindgen && typeof window.wasm_bindgen.parseTicks === 'function') {
        console.log('demoparser2 already loaded');
        parserInstance = {
          parseTicks: window.wasm_bindgen.parseTicks,
          parseEvents: window.wasm_bindgen.parseEvents,
          parseHeader: window.wasm_bindgen.parseHeader,
        };
        return parserInstance;
      }

      // Step 1: Load the JS file
      console.log('Loading demoparser2.js from /pkg/demoparser2.js...');
      
      // Patch document.currentScript before loading (demoparser2.js uses it)
      const fakeScript = document.createElement('script');
      fakeScript.src = '/pkg/demoparser2.js';
      
      // Override document.currentScript getter temporarily
      const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'currentScript');
      Object.defineProperty(document, 'currentScript', {
        get: () => fakeScript,
        configurable: true
      });
      
      try {
        // Fetch and execute the script content, then expose wasm_bindgen globally
        const response = await fetch('/pkg/demoparser2.js');
        if (!response.ok) {
          throw new Error(`Failed to fetch /pkg/demoparser2.js: ${response.status}`);
        }
        
        let code = await response.text();
        
        // Modify the code to expose wasm_bindgen to window
        // The file ends with: wasm_bindgen = Object.assign(__wbg_init, { initSync }, __exports);
        // We need to add: window.wasm_bindgen = wasm_bindgen; after that
        const pattern = /wasm_bindgen = Object\.assign\(__wbg_init, \{ initSync \}, __exports\);/;
        if (pattern.test(code)) {
          code = code.replace(
            pattern,
            'wasm_bindgen = Object.assign(__wbg_init, { initSync }, __exports);\nwindow.wasm_bindgen = wasm_bindgen;'
          );
        } else {
          // Fallback: just add the assignment at the end
          code += '\nwindow.wasm_bindgen = wasm_bindgen;';
        }
        
        // Execute the modified code
        eval(code);
        
        // Wait a moment for execution to complete
        await new Promise(resolve => setTimeout(resolve, 50));
        
        console.log('✓ demoparser2.js loaded and executed');
      } finally {
        // Restore document.currentScript
        if (originalDescriptor) {
          Object.defineProperty(document, 'currentScript', originalDescriptor);
        } else {
          delete (document as any).currentScript;
        }
      }

      if (!window.wasm_bindgen) {
        console.error('wasm_bindgen not available after loading script');
        return null;
      }

      // Step 2: Initialize WASM
      console.log('Initializing demoparser2 WASM from /pkg/demoparser2_bg.wasm...');
      
      try {
        // Initialize with the WASM file path (like the demo: await wasm_bindgen('./pkg/demoparser2_bg.wasm'))
        await window.wasm_bindgen('/pkg/demoparser2_bg.wasm');
        console.log('✓ demoparser2 WASM initialized');
      } catch (e: any) {
        console.error('Failed to initialize WASM:', e);
        return null;
      }

      // Step 3: Extract functions from wasm_bindgen
      if (typeof window.wasm_bindgen.parseTicks === 'function' && typeof window.wasm_bindgen.parseEvents === 'function') {
        parserInstance = {
          parseTicks: window.wasm_bindgen.parseTicks,
          parseEvents: window.wasm_bindgen.parseEvents,
          parseHeader: window.wasm_bindgen.parseHeader,
          parseGrenades: window.wasm_bindgen.parseGrenades,
          listUpdatedFields: window.wasm_bindgen.listUpdatedFields,
          parseVoice: window.wasm_bindgen.parseVoice || window.wasm_bindgen.parse_voice,
        };
        console.log('✓ demoparser2 ready to use');
        return parserInstance;
      }

      console.warn('demoparser2 initialized but parseTicks/parseEvents not found');
      return null;
    } catch (error: any) {
      console.warn('Failed to load demoparser2:', error.message || error);
      return null;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

/**
 * Checks if demoparser2 is available
 */
export function isParserAvailable(): boolean {
  return parserInstance !== null || (typeof window !== 'undefined' && 
    window.wasm_bindgen && 
    typeof window.wasm_bindgen.parseTicks === 'function');
}

/**
 * Gets the parser instance if available
 */
export function getParser(): IDemoParser2 | null {
  return parserInstance;
}

