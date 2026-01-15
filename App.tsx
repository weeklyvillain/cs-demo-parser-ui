import React, { useEffect, useRef, useState } from 'react';
import { DemoParser } from './services/demoParser';
import { DemoAnalyzer, AnalysisResults } from './services/demoAnalyzer';
import AnalysisResultsComponent from './components/AnalysisResults';
import ProgressDisplay from './components/ProgressDisplay';
import { loadDemoparser2, isParserAvailable } from './services/demoparser2Loader';
import { useDemoStore } from './store/useDemoStore';
import { Upload, AlertCircle, Info, Loader2, Filter, X } from 'lucide-react';

const App: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Zustand store
  const {
    demoFile,
    isParsing,
    parsingProgress,
    error,
    isParserLoaded,
    setDemoFile,
    setDemoParser,
    setIsParsing,
    setParsingProgress,
    setError,
    setIsParserLoaded,
    reset: resetStore,
  } = useDemoStore();

  // Preload demoparser2 on mount
  useEffect(() => {
    loadDemoparser2().then(() => {
      setIsParserLoaded(isParserAvailable());
    });
  }, [setIsParserLoaded]);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    setFileName(file.name);
    setIsParsing(true);
    setError(null);
    setParsingProgress({ percentage: 0, currentStep: 'Starting...', estimatedTimeRemaining: 0 });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parser = new DemoParser(arrayBuffer, (progress) => {
        setParsingProgress(progress);
      });
      setDemoParser(parser);

      const parsedDemo = await parser.parse();
      
      setDemoFile(parsedDemo);
      
      // Run analysis with progress tracking
      setIsAnalyzing(true);
      setParsingProgress({ percentage: 90, currentStep: 'Starting analysis...', estimatedTimeRemaining: 0 });
      try {
        const analyzer = new DemoAnalyzer(parsedDemo, {
          progressCallback: (progress) => {
            // Map analysis progress (0-100%) to overall progress (90-100%)
            const overallPercentage = 90 + (progress.percentage / 10);
            setParsingProgress({
              percentage: overallPercentage,
              currentStep: progress.currentStep,
              estimatedTimeRemaining: progress.estimatedTimeRemaining
            });
          }
        });
        const results = analyzer.analyze();
        setAnalysisResults(results);
        setParsingProgress({ percentage: 100, currentStep: 'Analysis complete!', estimatedTimeRemaining: 0 });
      } catch (err: any) {
        console.error('Analysis failed:', err);
        setError(err.message || 'Analysis failed');
      } finally {
        setIsAnalyzing(false);
        // Keep progress at 100% briefly before clearing
        setTimeout(() => {
          setParsingProgress(null);
        }, 500);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to parse demo file");
    } finally {
      setIsParsing(false);
      setParsingProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.dem')) {
        await handleFileUpload(file);
      } else {
        setError('Please drop a .dem file');
      }
    }
  };

  const handleReset = () => {
    // Clear local state first
    setAnalysisResults(null);
    setSelectedPlayers([]);
    setIsAnalyzing(false);
    setIsFilterOpen(false);
    setFileName(null);
    setIsDragging(false);
    
    // Clear parser explicitly before resetting store (parser may hold ArrayBuffer references)
    setDemoParser(null);
    
    // Clear Zustand store (this releases the demoFile which holds large data like frames array)
    resetStore();
    
    // Clear any remaining state
    setError(null);
    setIsParsing(false);
    setParsingProgress(null);
    
    // Force garbage collection hint
    if (window.gc) {
      window.gc();
    }
  };

  const isUsingRealParser = isParserLoaded;

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isFilterOpen && !target.closest('.filter-dropdown-container')) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFilterOpen]);

  if (!demoFile) {
    return (
      <div 
        style={{ 
          backgroundColor: isDragging ? '#0a0e1a' : 'var(--color-bg-primary)', 
          color: 'var(--color-text-primary)',
          border: isDragging ? '3px dashed var(--color-accent-primary)' : 'none'
        }}
        className="h-screen w-full flex flex-col items-center justify-center gap-6 relative transition-all"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center space-y-2">
          <h1 
            style={{ color: 'var(--color-text-primary)' }}
            className="text-4xl font-black tracking-tight"
          >
            CS2 <span style={{ color: 'var(--color-accent-primary)' }}>DEMO</span> ANALYZER
          </h1>
          <p style={{ color: 'var(--color-text-muted)' }}>Client-side demo parser & analysis tool</p>
        </div>
        
        {(isParsing || isAnalyzing) ? (
          <ProgressDisplay progress={parsingProgress} />
        ) : (
          <label 
            style={{
              border: `2px dashed ${isDragging ? 'var(--color-accent-primary)' : 'var(--color-border-subtle)'}`,
              backgroundColor: isDragging ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
              borderColor: isDragging ? 'var(--color-accent-primary)' : 'var(--color-border-subtle)'
            }}
            className="flex flex-col items-center gap-4 p-10 rounded-xl transition-all cursor-pointer group hover:opacity-90"
            onMouseEnter={(e) => {
              if (!isDragging) {
                e.currentTarget.style.borderColor = 'var(--color-accent-primary)';
                e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isDragging) {
                e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
                e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
              }
            }}
          >
            <div 
              style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
              className="p-4 rounded-full group-hover:scale-110 transition-transform"
            >
              <Upload size={32} style={{ color: 'var(--color-accent-primary)' }} />
            </div>
            <div className="text-center">
              <span style={{ color: 'var(--color-text-primary)' }} className="font-semibold">{isDragging ? 'Drop .dem file here' : 'Select or drag & drop .dem file'}</span>
              <p style={{ color: 'var(--color-text-muted)' }} className="text-sm">Supports CS2 (Source 2) Demos</p>
            </div>
            <input 
                ref={fileInputRef}
                type="file" 
                accept=".dem" 
                className="hidden" 
                onChange={handleFileInputChange} 
            />
          </label>
        )}

        {error && (
           <div 
             style={{
               color: 'var(--color-status-afk-died)',
               backgroundColor: 'rgba(217, 107, 43, 0.1)',
               borderColor: 'rgba(217, 107, 43, 0.3)'
             }}
             className="px-4 py-2 rounded border flex items-center gap-2"
           >
              <AlertCircle size={16} />
              {error}
           </div>
        )}
        
        <div 
          style={{ color: 'var(--color-text-muted)' }}
          className="absolute bottom-10 flex flex-col items-center gap-2 text-xs max-w-2xl text-center px-4"
        >
           {!isUsingRealParser && (
             <div 
               style={{
                 color: 'var(--color-accent-primary)',
                 backgroundColor: 'rgba(243, 156, 61, 0.1)',
                 borderColor: 'rgba(243, 156, 61, 0.3)'
               }}
               className="flex items-center gap-2 px-3 py-1 rounded border"
             >
                <Info size={12} />
                <span>demoparser2 not found. Falling back to simulation mode. Place 'demoparser2.js' and 'demoparser2_bg.wasm' in public/pkg/ to enable real parsing.</span>
             </div>
           )}
           <div 
             style={{
               color: 'var(--color-text-secondary)',
               backgroundColor: 'rgba(148, 163, 184, 0.1)',
               borderColor: 'rgba(148, 163, 184, 0.3)'
             }}
             className="flex items-start gap-2 px-4 py-3 rounded border"
           >
             <Info size={14} style={{ marginTop: '0.125rem', flexShrink: 0 }} />
             <div className="flex flex-col gap-1 text-left">
               <span className="font-medium">Important:</span>
               <span>This tool may miss certain events due to edge cases or demo parsing limitations. Always verify results by watching the demo to ensure accuracy.</span>
             </div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
      className="flex flex-col h-screen"
    >
      <input 
        ref={fileInputRef}
        type="file" 
        accept=".dem" 
        className="hidden" 
        onChange={handleFileUpload} 
      />

      {/* Header */}
      <header 
        style={{ 
          height: '3.5rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          backgroundColor: 'var(--color-bg-secondary)'
        }} 
        className="flex items-center justify-between px-6 shrink-0 z-30"
      >
        <div className="flex items-center gap-4">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div 
              style={{ 
                width: '0.5rem',
                height: '2rem',
                backgroundColor: 'var(--color-accent-primary)',
                borderRadius: '0.125rem'
              }}
            />
            <h1 
              style={{ color: 'var(--color-text-primary)' }}
              className="font-bold text-lg tracking-wide"
            >
              CS2 <span style={{ color: 'var(--color-text-muted)' }} className="font-light">DEMO ANALYZER</span>
            </h1>
          </button>
          
          {fileName && (
            <div 
              style={{ 
                color: 'var(--color-text-muted)',
                fontSize: '0.875rem',
                paddingLeft: '1rem',
                borderLeft: '1px solid var(--color-border-subtle)'
              }}
              className="font-mono truncate max-w-md"
              title={fileName}
            >
              {fileName}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
            {analysisResults && (() => {
              // Get all unique player names from analysis results
              const allPlayers = new Set<string>();
              analysisResults.afkDetections.forEach(afk => allPlayers.add(afk.playerName));
              analysisResults.teamKills.forEach(tk => {
                allPlayers.add(tk.attackerName);
                allPlayers.add(tk.victimName);
              });
              analysisResults.teamDamage.forEach(td => {
                allPlayers.add(td.attackerName);
                allPlayers.add(td.victimName);
              });
              analysisResults.disconnects.forEach(dc => allPlayers.add(dc.playerName));
              const playerList = Array.from(allPlayers).sort();
              
              return (
                <div className="relative filter-dropdown-container">
                  <button
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    style={{
                      backgroundColor: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '0.25rem',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      minWidth: '12rem'
                    }}
                    className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    <Filter size={14} style={{ color: 'var(--color-text-muted)' }} />
                    <span>
                      {selectedPlayers.length > 0 
                        ? `${selectedPlayers.length} player${selectedPlayers.length !== 1 ? 's' : ''} selected`
                        : 'Filter by player...'}
                    </span>
                  </button>
                  {isFilterOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '0.25rem',
                        backgroundColor: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border-subtle)',
                        borderRadius: '0.25rem',
                        padding: '0.5rem',
                        minWidth: '16rem',
                        maxHeight: '20rem',
                        overflowY: 'auto',
                        zIndex: 50,
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
                      }}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ color: 'var(--color-text-primary)', fontSize: '0.75rem', fontWeight: '500' }}>
                          Select players
                        </span>
                        {selectedPlayers.length > 0 && (
                          <button
                            onClick={() => setSelectedPlayers([])}
                            style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}
                            className="hover:opacity-70 transition-opacity"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                        {playerList.map(player => {
                          const isSelected = selectedPlayers.includes(player);
                          return (
                            <label
                              key={player}
                              style={{
                                color: 'var(--color-text-primary)',
                                fontSize: '0.75rem',
                                padding: '0.375rem 0.5rem',
                                borderRadius: '0.25rem',
                                cursor: 'pointer'
                              }}
                              className="flex items-center gap-2 hover:bg-[var(--color-bg-elevated)] transition-colors"
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setSelectedPlayers(selectedPlayers.filter(p => p !== player));
                                  } else {
                                    setSelectedPlayers([...selectedPlayers, player]);
                                  }
                                }}
                                style={{
                                  accentColor: 'var(--color-accent-primary)',
                                  cursor: 'pointer'
                                }}
                              />
                              <span>{player}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div 
              style={{ 
                borderLeft: '1px solid var(--color-border-subtle)',
                paddingLeft: '1rem'
              }}
              className="flex flex-col items-end text-xs font-mono"
            >
                <span style={{ color: 'var(--color-accent-primary)' }}>{demoFile.mapName}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{(demoFile.duration / 60).toFixed(1)} mins • {Math.round(demoFile.tickRate)} tick</span>
            </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {analysisResults ? (
          <AnalysisResultsComponent results={analysisResults} selectedPlayers={selectedPlayers} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 
                style={{ color: 'var(--color-accent-primary)' }}
                className="animate-spin mx-auto mb-4" 
                size={32} 
              />
              <p style={{ color: 'var(--color-text-secondary)' }}>Analyzing demo...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
