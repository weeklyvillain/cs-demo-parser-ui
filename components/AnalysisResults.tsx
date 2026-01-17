import React, { useState, useRef, useEffect } from 'react';
import { AnalysisResults as AnalysisResultsType, AFKDetection, TeamKill, TeamDamage, DisconnectReconnect, TeamFlash, MidRoundInactivity, BodyBlocking, ObjectiveSabotage, EconomyGriefing } from '../services/demoAnalyzer';
import { Team, DemoFile } from '../types';
import { Skull, Zap, Clock, Users, WifiOff, Copy, Check, ChevronDown, ChevronUp, Info, Shield, ArrowUpDown, Target, Heart, Timer, Award, AlertCircle, Activity, Move, Flag, Ban, Bomb, DollarSign, X } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';
import { FlashbangIcon, MolotovIcon, HEIcon, HeadshotIcon, DamageIcon } from './CustomIcons';

interface AnalysisResultsProps {
  results: AnalysisResultsType;
  selectedPlayers?: string[];
}

const AnalysisResults: React.FC<AnalysisResultsProps> = ({ results, selectedPlayers = [] }) => {
  const { demoFile } = useDemoStore();
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [afkThreshold, setAfkThreshold] = useState<number>(8); // Default 8 seconds
  const [flashDurationThreshold, setFlashDurationThreshold] = useState<number>(4); // Default 4 seconds
  const [teamDamageThreshold, setTeamDamageThreshold] = useState<number>(25); // Default 25 damage
  const thresholdsInitializedRef = useRef(false);
  const [economyTimelineModal, setEconomyTimelineModal] = useState<{ playerId: number; playerName: string } | null>(null);
  
  // Set default thresholds to show at least one event (only if no items are visible)
  useEffect(() => {
    if (thresholdsInitializedRef.current) return;
    
    // AFK: Check if any items are visible, if not, adjust threshold
    if (results.afkDetections.length > 0) {
      const visibleCount = results.afkDetections.filter(afk => afk.afkDuration >= afkThreshold).length;
      if (visibleCount === 0) {
        const sorted = [...results.afkDetections].sort((a, b) => b.afkDuration - a.afkDuration);
        const maxDuration = sorted[0].afkDuration;
        setAfkThreshold(Math.max(5, Math.floor(maxDuration) - 1)); // At least 5 seconds minimum
      }
    }
    
    // Team Damage: Check if any items are visible, if not, adjust threshold
    if (results.teamDamage.length > 0) {
      const visibleCount = results.teamDamage.filter(td => td.damage >= teamDamageThreshold).length;
      if (visibleCount === 0) {
        const sorted = [...results.teamDamage].sort((a, b) => b.damage - a.damage);
        const maxDamage = sorted[0].damage;
        setTeamDamageThreshold(Math.max(1, Math.floor(maxDamage) - 1)); // At least 1 damage minimum
      }
    }
    
    // Team Flashes: Check if any items are visible, if not, adjust threshold
    if (results.teamFlashes && results.teamFlashes.length > 0) {
      const visibleCount = results.teamFlashes.filter(tf => tf.flashDuration >= flashDurationThreshold).length;
      if (visibleCount === 0) {
        const sorted = [...results.teamFlashes].sort((a, b) => b.flashDuration - a.flashDuration);
        const maxDuration = sorted[0].flashDuration;
        setFlashDurationThreshold(Math.max(1, Math.floor((maxDuration - 0.1) * 10) / 10)); // At least 1 second minimum
      }
    }
    
    thresholdsInitializedRef.current = true;
  }, [results, afkThreshold, teamDamageThreshold, flashDurationThreshold]);
  
  // Reset initialization when results change significantly
  useEffect(() => {
    thresholdsInitializedRef.current = false;
  }, [results.afkDetections.length, results.teamDamage.length, results.teamFlashes?.length]);
  
  const [expandedSections, setExpandedSections] = useState({
    afk: true,
    teamKills: true,
    teamDamage: true,
    disconnects: true,
    teamFlashes: true,
    midRoundInactivity: true,
    bodyBlocking: true,
    objectiveSabotage: true,
    economyGriefing: true,
    cleanPlayers: false
  });
  const [sortBy, setSortBy] = useState<{
    afk: 'alphabetical' | 'round' | 'duration';
    teamKills: 'alphabetical' | 'round';
    teamDamage: 'alphabetical' | 'round' | 'damage';
    disconnects: 'alphabetical' | 'round';
    teamFlashes: 'alphabetical' | 'round' | 'duration';
    midRoundInactivity: 'alphabetical' | 'round' | 'confidence';
    bodyBlocking: 'alphabetical' | 'round' | 'confidence';
    objectiveSabotage: 'alphabetical' | 'round' | 'confidence';
    economyGriefing: 'alphabetical' | 'round' | 'confidence' | 'score';
  }>({
    afk: 'alphabetical',
    teamKills: 'alphabetical',
    teamDamage: 'damage',
    disconnects: 'alphabetical',
    teamFlashes: 'duration',
    midRoundInactivity: 'confidence',
    bodyBlocking: 'confidence',
    objectiveSabotage: 'confidence',
    economyGriefing: 'confidence'
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const generateConsoleCommands = (tick: number, playerName?: string, secondsBefore: number = 5) => {
    const tickRate = demoFile?.tickRate || 64;
    const ticksBefore = Math.max(0, tick - Math.ceil(secondsBefore * tickRate));
    
    const commands: string[] = [];
    commands.push(`demo_gototick ${ticksBefore}`);
    
    if (playerName) {
      // CS2 console accepts player names for spec_player
      // Escape quotes in player name if needed
      const escapedName = playerName.replace(/"/g, '\\"');
      commands.push(`spec_player "${escapedName}"`);
    }
    
    return commands.join('; ');
  };

  const copyToClipboard = async (text: string, commandId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCommand(commandId);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const mapWeaponName = (weapon: string | undefined): string => {
    if (!weapon) return '';
    // Map internal weapon names to user-friendly names
    const weaponMap: Record<string, string> = {
      'inferno': 'Molotov/Incendiary',
    };
    const mapped = weaponMap[weapon.toLowerCase()] || weapon;
    // Capitalize first letter of each word
    return mapped.split('/').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join('/');
  };

  const getTeamColor = (team: Team) => {
    // Team colors - muted, professional
    switch (team) {
      case Team.CT:
        return { color: 'var(--color-team-ct)' };
      case Team.T:
        return { color: 'var(--color-team-t)' };
      default:
        return { color: 'var(--color-text-muted)' };
    }
  };

  const getTeamBadge = (team: Team) => {
    const isCT = team === Team.CT;
    const ctColor = '91, 127, 168'; // #5b7fa8
    const tColor = '166, 124, 82';  // #a67c52
    return (
      <span 
        style={{
          padding: '0.125rem 0.5rem',
          fontSize: '0.75rem',
          fontWeight: '500',
          borderRadius: '0.25rem',
          border: '1px solid',
          backgroundColor: isCT ? `rgba(${ctColor}, 0.15)` : `rgba(${tColor}, 0.15)`,
          color: isCT ? 'var(--color-team-ct)' : 'var(--color-team-t)',
          borderColor: isCT ? `rgba(${ctColor}, 0.25)` : `rgba(${tColor}, 0.25)`
        }}
      >
        {team}
      </span>
    );
  };

  // Tooltip icon component
  const TooltipIcon: React.FC<{ icon: React.ReactNode; tooltip: string; color?: string }> = ({ icon, tooltip, color }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
    const iconRef = useRef<HTMLDivElement>(null);
    const iconColor = color || 'var(--color-text-muted)';
    
    const handleMouseEnter = () => {
      if (iconRef.current) {
        const rect = iconRef.current.getBoundingClientRect();
        setTooltipPosition({
          top: rect.top - 8,
          left: rect.left + rect.width / 2
        });
      }
      setIsHovered(true);
    };
    
    return (
      <div 
        className="relative inline-block"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div ref={iconRef} style={{ color: iconColor }} className="cursor-help">
          {icon}
        </div>
        {isHovered && (
          <div 
            style={{
              position: 'fixed',
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              transform: 'translate(-50%, -100%)',
              marginBottom: '0.5rem',
              padding: '0.25rem 0.5rem',
              backgroundColor: 'var(--color-bg-secondary)',
              fontSize: '0.75rem',
              color: 'var(--color-text-primary)',
              borderRadius: '0.25rem',
              border: '1px solid var(--color-border-subtle)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 99999,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
            }}
          >
            {tooltip}
            <div 
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginTop: '-0.25rem',
                border: '4px solid transparent',
                borderTopColor: 'var(--color-bg-secondary)'
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: 'var(--color-bg-primary)' }} className="flex flex-col gap-6 p-6 h-full overflow-y-auto">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div style={{ color: 'var(--color-text-secondary)' }} className="flex items-center gap-2 mb-2">
            <Clock size={16} />
            <span className="text-sm font-medium">AFK Detections</span>
          </div>
          <div style={{ color: 'var(--color-text-primary)' }} className="text-3xl font-bold mb-1">{results.afkDetections.length}</div>
          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">No movement after freezetime (5s grace)</div>
        </div>
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div style={{ color: 'var(--color-text-secondary)' }} className="flex items-center gap-2 mb-2">
            <Skull size={16} />
            <span className="text-sm font-medium">Team Kills</span>
          </div>
          <div style={{ color: 'var(--color-status-afk-died)' }} className="text-3xl font-bold mb-1">{results.teamKills.length}</div>
          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Friendly fire kills</div>
        </div>
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div style={{ color: 'var(--color-text-secondary)' }} className="flex items-center gap-2 mb-2">
            <Zap size={16} />
            <span className="text-sm font-medium">Team Damage</span>
          </div>
          <div style={{ color: 'var(--color-accent-primary)' }} className="text-3xl font-bold mb-1">{results.teamDamage.length}</div>
          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Friendly fire damage events</div>
        </div>
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div style={{ color: 'var(--color-text-secondary)' }} className="flex items-center gap-2 mb-2">
            <WifiOff size={16} />
            <span className="text-sm font-medium">Disconnects</span>
          </div>
          <div style={{ color: 'var(--color-status-neutral)' }} className="text-3xl font-bold mb-1">{results.disconnects.length}</div>
          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Player disconnection events</div>
        </div>
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div style={{ color: 'var(--color-text-secondary)' }} className="flex items-center gap-2 mb-2">
            <FlashbangIcon size={16} color="var(--color-accent-primary)" />
            <span className="text-sm font-medium">Team Flashes</span>
          </div>
          <div style={{ color: 'var(--color-accent-primary)' }} className="text-3xl font-bold mb-1">{results.teamFlashes?.length || 0}</div>
          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Friendly flashbang detonations</div>
        </div>
        {false && (
          <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4 relative">
            <span 
              style={{ 
                position: 'absolute',
                top: '0.5rem',
                right: '0.5rem',
                backgroundColor: 'var(--color-accent-primary)', 
                color: 'var(--color-bg-primary)',
                fontSize: '0.5rem',
                padding: '0.125rem 0.25rem',
                borderRadius: '0.125rem',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                cursor: 'help'
              }}
              title="This feature is untested and may provide incorrect information"
            >BETA</span>
            <div style={{ color: 'var(--color-text-secondary)' }} className="flex items-center gap-2 mb-2">
              <DollarSign size={16} style={{ color: 'var(--color-status-afk-died)' }} />
              <span className="text-sm font-medium">Economy Griefing</span>
            </div>
            <div style={{ color: 'var(--color-status-afk-died)' }} className="text-3xl font-bold mb-1">{results.economyGriefing?.byPlayer ? Array.from(results.economyGriefing.byPlayer.values()).reduce((sum, p) => sum + p.events.length, 0) : 0}</div>
            <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Buy sabotage events</div>
          </div>
        )}
      </div>

      {/* AFK Detections */}
      {results.afkDetections.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('afk')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <Clock size={18} />
              AFK Players at Round Start
              {expandedSections.afk ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.afk && (
            <div className="flex items-center gap-3">
              <label style={{ color: 'var(--color-text-secondary)' }} className="text-xs whitespace-nowrap">
                Threshold:
              </label>
              <input
                type="number"
                min="5"
                max="30"
                step="1"
                value={afkThreshold}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!isNaN(val) && val >= 5 && val <= 30) {
                    setAfkThreshold(val);
                  }
                }}
                style={{ 
                  width: '4rem',
                  backgroundColor: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: '0.375rem',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem'
                }}
                className="text-center"
              />
              <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">s</span>
              <div className="flex items-center gap-2">
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.afk}
                  onChange={(e) => setSortBy(prev => ({ ...prev, afk: e.target.value as 'alphabetical' | 'round' | 'duration' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '0.375rem',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem'
                  }}
                  className="cursor-pointer"
                >
                  <option value="alphabetical">Name</option>
                  <option value="round">Round</option>
                  <option value="duration">Time AFK (highest)</option>
                </select>
              </div>
            </div>
            )}
          </div>
          {expandedSections.afk && (() => {
            let filteredAFKs = results.afkDetections.filter(afk => afk.afkDuration >= afkThreshold);
            if (selectedPlayers.length > 0) {
              filteredAFKs = filteredAFKs.filter(afk => selectedPlayers.includes(afk.playerName));
            }
            return (
            <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto', scrollbarGutter: 'stable' }}>
              {(() => {
                // Filter AFK detections based on threshold (each round's duration, not average)
              
              // Group by player, but keep individual round data
              const playerAFKs = new Map<number, {
                playerId: number;
                playerName: string;
                team: Team;
                rounds: AFKDetection[];
              }>();
              
              filteredAFKs.forEach(afk => {
                const existing = playerAFKs.get(afk.playerId);
                if (existing) {
                  existing.rounds.push(afk);
                } else {
                  playerAFKs.set(afk.playerId, {
                    playerId: afk.playerId,
                    playerName: afk.playerName,
                    team: afk.team,
                    rounds: [afk]
                  });
                }
              });
              
              // Sort rounds within each player
              playerAFKs.forEach(player => {
                player.rounds.sort((a, b) => a.round - b.round);
              });
              
              // Convert to array and sort based on selected option
              const sortedPlayers = Array.from(playerAFKs.values());
              if (sortBy.afk === 'alphabetical') {
                sortedPlayers.sort((a, b) => a.playerName.localeCompare(b.playerName));
              } else if (sortBy.afk === 'round') {
                // Sort by lowest round first
                sortedPlayers.sort((a, b) => {
                  const aMinRound = Math.min(...a.rounds.map(r => r.round));
                  const bMinRound = Math.min(...b.rounds.map(r => r.round));
                  return aMinRound - bMinRound;
                });
              } else if (sortBy.afk === 'duration') {
                // Sort by highest AFK duration first
                sortedPlayers.sort((a, b) => {
                  const aMaxDuration = Math.max(...a.rounds.map(r => r.afkDuration));
                  const bMaxDuration = Math.max(...b.rounds.map(r => r.afkDuration));
                  return bMaxDuration - aMaxDuration; // Highest first
                });
              }
              
              return sortedPlayers.map((player) => (
                <div key={player.playerId} style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-subtle)', width: 'calc(50% - 0.5rem)', minWidth: '25rem' }} className="border rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{player.playerName}</span>
                      <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                        {player.rounds.length} round{player.rounds.length !== 1 ? 's' : ''} AFK
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {player.rounds.map((afk, roundIdx) => {
                      const commandId = `afk-${player.playerId}-${afk.round}`;
                      const tick = afk.freezeEndTick || afk.startTick;
                      const commands = generateConsoleCommands(tick, afk.playerName);
                      const borderColor = afk.diedWhileAFK 
                        ? 'var(--color-status-afk-died)' 
                        : 'var(--color-status-afk)';
                      return (
                        <div 
                          key={afk.round} 
                          style={{ 
                            backgroundColor: 'var(--color-bg-tertiary)',
                            borderLeft: `2px solid ${borderColor}`
                          }} 
                          className="rounded p-2"
                        >
                          <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                            <span style={{ color: 'var(--color-text-secondary)' }} className="text-xs">Round {afk.round}</span>
                            {getTeamBadge(afk.team)}
                            {afk.diedWhileAFK ? (
                              <TooltipIcon
                                icon={
                                  <span style={{ color: 'var(--color-status-afk-died)' }} className="flex items-center gap-1 text-xs font-semibold">
                                    <Skull size={12} />
                                    Ended when player died
                                  </span>
                                }
                                tooltip="Player died while being AFK, ending the AFK period"
                                color="var(--color-status-afk-died)"
                              />
                            ) : afk.timeToFirstMovement !== undefined ? (
                              <TooltipIcon
                                icon={
                                  <span style={{ color: 'var(--color-status-afk)' }} className="flex items-center gap-1 text-xs">
                                    <Move size={12} />
                                    Ended when player started moving
                                  </span>
                                }
                                tooltip="Player started moving, ending the AFK period"
                                color="var(--color-status-afk)"
                              />
                            ) : (
                              <TooltipIcon
                                icon={
                                  <span style={{ color: 'var(--color-text-muted)' }} className="flex items-center gap-1 text-xs">
                                    <Flag size={12} />
                                    Ended when round ended
                                  </span>
                                }
                                tooltip="Player remained AFK until the round ended"
                                color="var(--color-text-muted)"
                              />
                            )}
                            </div>
                            <button
                              onClick={() => copyToClipboard(commands, commandId)}
                              style={{ 
                                backgroundColor: 'transparent'
                              }}
                              className="p-1.5 rounded transition-colors hover:opacity-70"
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              title="Copy console commands for this round"
                            >
                              {copiedCommand === commandId ? (
                                <Check size={12} style={{ color: 'var(--color-accent-primary)' }} />
                              ) : (
                                <Copy size={12} style={{ color: 'var(--color-text-muted)' }} />
                              )}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            <Timer size={12} style={{ color: 'var(--color-text-muted)' }} />
                            <span>{afk.afkDuration.toFixed(1)}s AFK</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                            <span>{(() => {
                              // Calculate time from startAfkTick (freezeEndTick) - when AFK period started
                              const startTick = afk.startAfkTick || afk.freezeEndTick;
                              if (startTick !== undefined && demoFile?.tickRate) {
                                const startTime = startTick / demoFile.tickRate;
                                // Try to find the frame for more accurate time
                                const frame = demoFile.frames.find(f => f.tick === startTick);
                                return formatTime(frame ? frame.time : startTime);
                              }
                              return 'N/A';
                            })()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
            </div>
            );
          })()}
        </div>
      )}

      {/* Disconnects/Reconnects */}
      {results.disconnects && results.disconnects.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <button
            onClick={() => toggleSection('disconnects')}
            style={{ color: 'var(--color-text-primary)' }}
            className="flex items-center gap-2 text-lg font-semibold mb-3 transition-colors hover:opacity-80"
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-status-neutral)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
          >
            <WifiOff size={18} />
            Disconnects & Reconnects
            {expandedSections.disconnects ? (
              <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
            )}
          </button>
          {expandedSections.disconnects && (() => {
            let filteredDisconnects = results.disconnects;
            if (selectedPlayers.length > 0) {
              filteredDisconnects = filteredDisconnects.filter(dc => selectedPlayers.includes(dc.playerName));
            }
            // Sort based on selected option
            if (sortBy.disconnects === 'alphabetical') {
              filteredDisconnects = [...filteredDisconnects].sort((a, b) => a.playerName.localeCompare(b.playerName));
            } else {
              filteredDisconnects = [...filteredDisconnects].sort((a, b) => a.disconnectRound - b.disconnectRound);
            }
            return (
            <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto', scrollbarGutter: 'stable' }}>
            {filteredDisconnects.map((dc, idx) => {
              const commandId = `dc-${idx}`;
              // Jump to 5 seconds before disconnect to see context before player leaves
              const commands = generateConsoleCommands(dc.disconnectTick, dc.playerName, 5);
              return (
              <div 
                key={idx} 
                style={{ 
                  backgroundColor: 'var(--color-bg-tertiary)',
                  borderColor: 'var(--color-border-subtle)',
                  width: 'calc(50% - 0.5rem)',
                  minWidth: '25rem'
                }} 
                className="border rounded p-3"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={getTeamColor(dc.team)} className="font-medium">{dc.playerName}</span>
                    {getTeamBadge(dc.team)}
                  </div>
                  <button
                    onClick={() => copyToClipboard(commands, commandId)}
                    style={{ backgroundColor: 'transparent' }}
                    className="p-1.5 rounded transition-colors flex-shrink-0 hover:opacity-70"
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Copy console commands"
                  >
                    {copiedCommand === commandId ? (
                      <Check size={14} style={{ color: 'var(--color-accent-primary)' }} />
                    ) : (
                      <Copy size={14} style={{ color: 'var(--color-text-muted)' }} />
                    )}
                  </button>
                </div>
                
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <WifiOff size={12} style={{ color: 'var(--color-status-neutral)' }} />
                    <span style={{ color: 'var(--color-text-secondary)' }}>Disconnected:</span>
                    <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span style={{ color: 'var(--color-status-neutral)' }} className="font-medium">Round {dc.disconnectRound}</span>
                    <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span style={{ color: 'var(--color-text-muted)' }}>at {formatTime(dc.disconnectTime)}</span>
                    {dc.diedBeforeDisconnect && (
                      <TooltipIcon
                        icon={<Skull size={16} />}
                        tooltip="Player died in this round before disconnecting, so this round is not counted as missed"
                        color="var(--color-text-muted)"
                      />
                    )}
                  </div>
                  {dc.reason && (
                    <div className="flex items-center gap-2 text-xs">
                      <Info size={12} style={{ color: 'var(--color-text-muted)' }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>Reason:</span>
                      <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{dc.reason}</span>
                    </div>
                  )}
                  
                  {dc.reconnectTime ? (
                    <>
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <Users size={12} style={{ color: 'var(--color-accent-primary)' }} />
                        <span style={{ color: 'var(--color-text-secondary)' }}>Reconnected:</span>
                        <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                        <span style={{ color: 'var(--color-accent-primary)' }} className="font-medium">Round {dc.reconnectRound || '?'}</span>
                        <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                        <span style={{ color: 'var(--color-text-muted)' }}>at {formatTime(dc.reconnectTime)}</span>
                        {dc.reconnectedBeforeFreezeEnd && (
                          <TooltipIcon
                            icon={<Shield size={16} />}
                            tooltip="Player reconnected before freeze time ended, so they are playing this round"
                            color="var(--color-accent-primary)"
                          />
                        )}
                      </div>
                      {dc.duration && (
                        <div className="flex items-center gap-2 text-xs">
                          <Timer size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>Duration:</span>
                          <span style={{ color: 'var(--color-text-primary)' }}>{dc.duration.toFixed(1)}s</span>
                        </div>
                      )}
                      {dc.roundsMissed !== undefined && dc.roundsMissed > 0 && (
                        <div className="flex items-center gap-2 text-xs">
                          <AlertCircle size={12} style={{ color: 'var(--color-status-afk-died)' }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>Rounds missed:</span>
                          <span style={{ color: 'var(--color-status-afk)' }} className="font-semibold">{dc.roundsMissed} round{dc.roundsMissed !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs">
                        <AlertCircle size={12} style={{ color: 'var(--color-status-afk-died)' }} />
                        <span style={{ color: 'var(--color-text-secondary)' }}>Status:</span>
                        <span style={{ color: 'var(--color-status-afk-died)' }} className="font-semibold">Never reconnected</span>
                      </div>
                      {dc.duration && (
                        <div className="flex items-center gap-2 text-xs">
                          <Timer size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>Offline for:</span>
                          <span style={{ color: 'var(--color-text-primary)' }}>{dc.duration.toFixed(1)}s</span>
                        </div>
                      )}
                      {dc.roundsMissed !== undefined && dc.roundsMissed > 0 && (
                        <div className="flex items-center gap-2 text-xs">
                          <AlertCircle size={12} style={{ color: 'var(--color-status-afk-died)' }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>Rounds missed:</span>
                          <span style={{ color: 'var(--color-status-afk-died)' }} className="font-semibold">{dc.roundsMissed} round{dc.roundsMissed !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              );
            })}
            </div>
            );
          })()}
        </div>
      )}

      {/* Team Kills */}
      {results.teamKills.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('teamKills')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-status-afk-died)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <Skull size={18} />
              Team Kills
              {expandedSections.teamKills ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.teamKills && (
              <div className="flex items-center gap-2">
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.teamKills}
                  onChange={(e) => setSortBy(prev => ({ ...prev, teamKills: e.target.value as 'alphabetical' | 'round' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '0.25rem',
                    padding: '0.125rem 0.5rem',
                    fontSize: '0.7rem',
                    cursor: 'pointer'
                  }}
                  className="appearance-none"
                >
                  <option value="alphabetical">Alphabetical</option>
                  <option value="round">Round</option>
                </select>
              </div>
            )}
          </div>
          {expandedSections.teamKills && (() => {
            let filteredTeamKills = results.teamKills;
            if (selectedPlayers.length > 0) {
              filteredTeamKills = filteredTeamKills.filter(tk => 
                selectedPlayers.includes(tk.attackerName) || selectedPlayers.includes(tk.victimName)
              );
            }
            // Sort based on selected option
            if (sortBy.teamKills === 'alphabetical') {
              filteredTeamKills = [...filteredTeamKills].sort((a, b) => a.attackerName.localeCompare(b.attackerName));
            } else {
              filteredTeamKills = [...filteredTeamKills].sort((a, b) => a.round - b.round);
            }
            return (
            <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto', scrollbarGutter: 'stable' }}>
            {filteredTeamKills.map((tk, idx) => {
              const commandId = `tk-${tk.attackerId}-${tk.victimId}-${tk.tick}`;
              const commands = generateConsoleCommands(tk.tick, tk.attackerName);
              return (
              <div 
                key={`${tk.attackerId}-${tk.victimId}-${tk.tick}-${idx}`} 
                style={{ 
                  backgroundColor: 'var(--color-bg-tertiary)',
                  borderColor: 'rgba(217, 107, 43, 0.3)',
                  width: 'calc(50% - 0.5rem)',
                  minWidth: '25rem'
                }} 
                className="border rounded p-3"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={getTeamColor(tk.attackerTeam)} className="font-medium">{tk.attackerName}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                    <span style={getTeamColor(tk.victimTeam)} className="font-medium">{tk.victimName}</span>
                    {getTeamBadge(tk.attackerTeam)}
                  </div>
                  <button
                    onClick={() => copyToClipboard(commands, commandId)}
                    style={{ backgroundColor: 'transparent' }}
                    className="p-1.5 rounded transition-colors flex-shrink-0 hover:opacity-70"
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Copy console commands"
                  >
                    {copiedCommand === commandId ? (
                      <Check size={14} style={{ color: 'var(--color-accent-primary)' }} />
                    ) : (
                      <Copy size={14} style={{ color: 'var(--color-text-muted)' }} />
                    )}
                  </button>
                </div>
                
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span>{formatTime(tk.time)}</span>
                  </div>
                  <div style={{ color: 'var(--color-text-muted)' }} className="flex items-center gap-2 text-xs">
                    <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span>Round {tk.round}</span>
                    <span>•</span>
                    {tk.weapon.toLowerCase().includes('he') || tk.weapon.toLowerCase().includes('grenade') ? (
                      <HEIcon size={12} color="var(--color-text-muted)" />
                    ) : (
                      <Target size={12} style={{ color: 'var(--color-text-muted)' }} />
                    )}
                    <span>{tk.weapon}</span>
                    {tk.isHeadshot && (
                      <>
                        <HeadshotIcon size={12} color="var(--color-status-afk-died)" />
                        <span style={{ color: 'var(--color-status-afk-died)' }}>Headshot</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
            </div>
            );
          })()}
        </div>
      )}

      {/* Team Damage */}
      {results.teamDamage.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('teamDamage')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <Zap size={18} />
              Team Damage
              {expandedSections.teamDamage ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.teamDamage && (
              <div className="flex items-center gap-3">
                <label style={{ color: 'var(--color-text-secondary)' }} className="text-xs whitespace-nowrap">
                  Min Damage:
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={teamDamageThreshold}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 100) {
                      setTeamDamageThreshold(val);
                    }
                  }}
                  style={{ 
                    width: '4rem',
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '0.375rem',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem'
                  }}
                  className="text-center"
                />
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.teamDamage}
                  onChange={(e) => setSortBy(prev => ({ ...prev, teamDamage: e.target.value as 'alphabetical' | 'round' | 'damage' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '0.25rem',
                    padding: '0.125rem 0.5rem',
                    fontSize: '0.7rem',
                    cursor: 'pointer'
                  }}
                  className="appearance-none"
                >
                  <option value="damage">Damage</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="round">Round</option>
                </select>
              </div>
            )}
          </div>
          {expandedSections.teamDamage && (() => {
            let filteredTeamDamage = results.teamDamage.filter(td => td.damage >= teamDamageThreshold);
            if (selectedPlayers.length > 0) {
              filteredTeamDamage = filteredTeamDamage.filter(td => 
                selectedPlayers.includes(td.attackerName) || selectedPlayers.includes(td.victimName)
              );
            }
            // Sort based on selected option
            let sortedTeamDamage = [...filteredTeamDamage];
            if (sortBy.teamDamage === 'alphabetical') {
              sortedTeamDamage.sort((a, b) => a.attackerName.localeCompare(b.attackerName));
            } else if (sortBy.teamDamage === 'round') {
              // Sort by round (lowest first)
              sortedTeamDamage.sort((a, b) => a.round - b.round);
            } else {
              // Sort by damage (highest first)
              sortedTeamDamage.sort((a, b) => b.damage - a.damage);
            }
            return (
            <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto', scrollbarGutter: 'stable' }}>
            {sortedTeamDamage.map((td, idx) => {
              const commandId = `td-${idx}`;
              return (
              <div 
                key={idx} 
                style={{ 
                  backgroundColor: 'var(--color-bg-tertiary)',
                  borderColor: 'rgba(243, 156, 61, 0.3)',
                  width: 'calc(50% - 0.5rem)',
                  minWidth: '25rem'
                }} 
                className="border rounded p-3"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={getTeamColor(td.attackerTeam)} className="font-medium">{td.attackerName}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                    <span style={getTeamColor(td.victimTeam)} className="font-medium">{td.victimName}</span>
                    {getTeamBadge(td.attackerTeam)}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        const attackerCommands = generateConsoleCommands(td.tick, td.attackerName);
                        copyToClipboard(attackerCommands, `${commandId}-attacker`);
                      }}
                      style={{ 
                        backgroundColor: copiedCommand === `${commandId}-attacker` ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                        color: copiedCommand === `${commandId}-attacker` ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)'
                      }}
                      className="px-2 py-1 rounded text-xs flex items-center gap-1.5 transition-colors hover:opacity-80"
                      title={`Copy console commands for ${td.attackerName}`}
                    >
                      {copiedCommand === `${commandId}-attacker` ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                      <span className="font-medium">Attacker</span>
                    </button>
                    <button
                      onClick={() => {
                        const victimCommands = generateConsoleCommands(td.tick, td.victimName);
                        copyToClipboard(victimCommands, `${commandId}-victim`);
                      }}
                      style={{ 
                        backgroundColor: copiedCommand === `${commandId}-victim` ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                        color: copiedCommand === `${commandId}-victim` ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)'
                      }}
                      className="px-2 py-1 rounded text-xs flex items-center gap-1.5 transition-colors hover:opacity-80"
                      title={`Copy console commands for ${td.victimName}`}
                    >
                      {copiedCommand === `${commandId}-victim` ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                      <span className="font-medium">Victim</span>
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  <div style={{ color: 'var(--color-text-muted)' }} className="flex items-center gap-2 text-xs">
                    <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span>Round {td.round}</span>
                    {td.weapon && (
                      <>
                        <span>•</span>
                        {td.weapon.toLowerCase().includes('molotov') || td.weapon.toLowerCase().includes('inferno') ? (
                          <MolotovIcon size={12} color="var(--color-status-afk-died)" />
                        ) : td.weapon.toLowerCase().includes('he') || td.weapon.toLowerCase().includes('grenade') ? (
                          <HEIcon size={12} color="var(--color-text-muted)" />
                        ) : (
                          <Target size={12} style={{ color: 'var(--color-text-muted)' }} />
                        )}
                        <span>{mapWeaponName(td.weapon)}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <DamageIcon size={12} color="#d96b2b" />
                    <span style={{ color: 'var(--color-text-secondary)' }}>Damage:</span>
                    {td.initialHP !== undefined && td.finalHP !== undefined ? (
                      <span style={{ color: '#d96b2b' }} className="font-semibold">
                        {td.initialHP} → {td.finalHP} HP ({td.damage} dmg)
                      </span>
                    ) : (
                      <span style={{ color: '#d96b2b' }} className="font-semibold">{td.damage} HP</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                    <span>{formatTime(td.time)}</span>
                  </div>
                </div>
              </div>
              );
            })}
            </div>
            );
          })()}
        </div>
      )}

      {/* Team Flashes */}
      {results.teamFlashes && results.teamFlashes.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('teamFlashes')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <FlashbangIcon size={18} color="var(--color-accent-primary)" />
              Team Flashes
              {expandedSections.teamFlashes ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.teamFlashes && (
              <div className="flex items-center gap-3">
                <label style={{ color: 'var(--color-text-secondary)' }} className="text-xs whitespace-nowrap">
                  Min Duration:
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="0.1"
                  value={flashDurationThreshold}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (!isNaN(val) && val >= 1 && val <= 10) {
                      setFlashDurationThreshold(val);
                    }
                  }}
                  style={{ 
                    width: '4rem',
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '0.375rem',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem'
                  }}
                  className="text-center"
                />
                <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">s</span>
                <div className="flex items-center gap-2">
                  <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <select
                    value={sortBy.teamFlashes}
                    onChange={(e) => setSortBy(prev => ({ ...prev, teamFlashes: e.target.value as 'alphabetical' | 'round' | 'duration' }))}
                    style={{
                      backgroundColor: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-subtle)'
                    }}
                    className="border rounded px-2 py-1 text-xs"
                  >
                    <option value="duration">Duration</option>
                    <option value="alphabetical">Alphabetical</option>
                    <option value="round">Round</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          {expandedSections.teamFlashes && (() => {
            let filteredTeamFlashes = results.teamFlashes || [];
            // Filter by flash duration threshold
            filteredTeamFlashes = filteredTeamFlashes.filter(tf => tf.flashDuration >= flashDurationThreshold);
            // Filter by selected players
            if (selectedPlayers.length > 0) {
              filteredTeamFlashes = filteredTeamFlashes.filter(tf =>
                selectedPlayers.includes(tf.throwerName) || selectedPlayers.includes(tf.victimName)
              );
            }
            
            if (sortBy.teamFlashes === 'alphabetical') {
              filteredTeamFlashes.sort((a, b) => {
                const aName = `${a.throwerName} → ${a.victimName}`;
                const bName = `${b.throwerName} → ${b.victimName}`;
                return aName.localeCompare(bName);
              });
            } else if (sortBy.teamFlashes === 'round') {
              // Sort by round (lowest first)
              filteredTeamFlashes.sort((a, b) => a.round - b.round);
            } else {
              // Sort by duration (highest first)
              filteredTeamFlashes.sort((a, b) => b.flashDuration - a.flashDuration);
            }
            
            return (
              <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto' }}>
                {filteredTeamFlashes.map((flash, idx) => {
                  const commandId = `flash-${flash.throwerId}-${flash.victimId}-${flash.tick}`;
                  // flashDuration is in seconds, format it nicely
                  const flashDurationFormatted = flash.flashDuration > 0 
                    ? `${flash.flashDuration.toFixed(2)}s` 
                    : '0s';
                  
                  return (
                    <div key={idx} style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-subtle)', width: 'calc(50% - 0.5rem)', minWidth: '25rem' }} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{flash.throwerName}</span>
                          <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">→</span>
                          <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{flash.victimName}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => {
                              const throwerCommands = generateConsoleCommands(flash.tick, flash.throwerName);
                              copyToClipboard(throwerCommands, `${commandId}-thrower`);
                            }}
                            style={{ 
                              backgroundColor: copiedCommand === `${commandId}-thrower` ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                              color: copiedCommand === `${commandId}-thrower` ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)'
                            }}
                            className="px-2 py-1 rounded text-xs flex items-center gap-1.5 transition-colors hover:opacity-80"
                            title={`Copy console commands for ${flash.throwerName}`}
                          >
                            {copiedCommand === `${commandId}-thrower` ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                            <span className="font-medium">Thrower</span>
                          </button>
                          <button
                            onClick={() => {
                              const victimCommands = generateConsoleCommands(flash.tick, flash.victimName);
                              copyToClipboard(victimCommands, `${commandId}-victim`);
                            }}
                            style={{ 
                              backgroundColor: copiedCommand === `${commandId}-victim` ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                              color: copiedCommand === `${commandId}-victim` ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)'
                            }}
                            className="px-2 py-1 rounded text-xs flex items-center gap-1.5 transition-colors hover:opacity-80"
                            title={`Copy console commands for ${flash.victimName}`}
                          >
                            {copiedCommand === `${commandId}-victim` ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                            <span className="font-medium">Victim</span>
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        <div className="flex items-center gap-2">
                          <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span style={{ color: 'var(--color-text-muted)' }}>Round {flash.round}</span>
                          {getTeamBadge(flash.throwerTeam)}
                          <FlashbangIcon size={12} color="var(--color-accent-primary)" />
                          <span style={{ color: 'var(--color-accent-primary)' }} className="font-medium">{flashDurationFormatted} flashed</span>
                        </div>
                        <div className="flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
                          <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span>{formatTime(flash.time)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Mid-Round Inactivity - DISABLED */}
      {false && results.midRoundInactivity && results.midRoundInactivity.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('midRoundInactivity')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-status-afk)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <Activity size={18} style={{ color: 'var(--color-status-afk)' }} />
              Mid-Round Inactivity
              <span 
                style={{ 
                  backgroundColor: 'var(--color-accent-primary)', 
                  color: 'var(--color-bg-primary)',
                  fontSize: '0.625rem',
                  padding: '0.125rem 0.375rem',
                  borderRadius: '0.25rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  cursor: 'help'
                }}
                title="This feature is untested and may provide incorrect information"
              >BETA</span>
              {expandedSections.midRoundInactivity ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.midRoundInactivity && (
              <div className="flex items-center gap-3">
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.midRoundInactivity}
                  onChange={(e) => setSortBy(prev => ({ ...prev, midRoundInactivity: e.target.value as 'alphabetical' | 'round' | 'confidence' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    borderColor: 'var(--color-border-subtle)'
                  }}
                  className="border rounded px-2 py-1 text-xs"
                >
                  <option value="confidence">Confidence</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="round">Round</option>
                </select>
              </div>
            )}
          </div>
          {expandedSections.midRoundInactivity && (() => {
            let filteredInactivity = results.midRoundInactivity || [];
            
            // Filter by selected players
            if (selectedPlayers.length > 0) {
              filteredInactivity = filteredInactivity.filter(mr => selectedPlayers.includes(mr.playerName));
            }
            
            // Sort
            if (sortBy.midRoundInactivity === 'alphabetical') {
              filteredInactivity.sort((a, b) => a.playerName.localeCompare(b.playerName));
            } else if (sortBy.midRoundInactivity === 'round') {
              filteredInactivity.sort((a, b) => a.round - b.round);
            } else {
              // Sort by confidence (highest first)
              filteredInactivity.sort((a, b) => b.confidence - a.confidence);
            }
            
            return (
              <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto' }}>
                {filteredInactivity.map((inactivity, idx) => {
                  const totalDuration = inactivity.segments.reduce((sum, seg) => sum + seg.duration, 0);
                  const avgConfidence = inactivity.segments.reduce((sum, seg) => sum + seg.confidence, 0) / inactivity.segments.length;
                  
                  return (
                    <div key={idx} style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-subtle)', width: 'calc(50% - 0.5rem)', minWidth: '25rem' }} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{inactivity.playerName}</span>
                          <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">Round {inactivity.round}</span>
                          {getTeamBadge(inactivity.team)}
                        </div>
                        <div className="flex items-center gap-2">
                          <span style={{ color: 'var(--color-status-afk)' }} className="text-xs font-medium">
                            {Math.round(avgConfidence * 100)}% confidence
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        <div className="flex items-center gap-2">
                          <Timer size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span>Total inactive: {totalDuration.toFixed(1)}s</span>
                          <span style={{ color: 'var(--color-text-muted)' }}>({inactivity.segments.length} segment{inactivity.segments.length !== 1 ? 's' : ''})</span>
                        </div>
                        {inactivity.segments.map((segment, segIdx) => (
                          <div key={segIdx} className="pl-4 border-l-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
                            <div className="flex items-center gap-2 mb-1">
                              <Clock size={10} style={{ color: 'var(--color-text-muted)' }} />
                              <span>{formatTime(segment.startTime)} - {formatTime(segment.endTime)}</span>
                              <span style={{ color: 'var(--color-text-muted)' }}>({segment.duration.toFixed(1)}s)</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                              <span>Reason: {segment.reason.replace(/_/g, ' ')}</span>
                              <span>•</span>
                              <span>Score: {segment.score.toFixed(2)}</span>
                              <span>•</span>
                              <span>Confidence: {Math.round(segment.confidence * 100)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Body Blocking - DISABLED */}
      {false && results.bodyBlocking && results.bodyBlocking.length > 0 && results.bodyBlocking.some(b => b.events.length > 0) && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('bodyBlocking')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-status-afk-died)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <Ban size={18} style={{ color: 'var(--color-status-afk-died)' }} />
              Body Blocking
              <span 
                style={{ 
                  backgroundColor: 'var(--color-accent-primary)', 
                  color: 'var(--color-bg-primary)',
                  fontSize: '0.625rem',
                  padding: '0.125rem 0.375rem',
                  borderRadius: '0.25rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  cursor: 'help'
                }}
                title="This feature is untested and may provide incorrect information"
              >BETA</span>
              {expandedSections.bodyBlocking ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.bodyBlocking && (
              <div className="flex items-center gap-3">
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.bodyBlocking}
                  onChange={(e) => setSortBy(prev => ({ ...prev, bodyBlocking: e.target.value as 'alphabetical' | 'round' | 'confidence' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    borderColor: 'var(--color-border-subtle)'
                  }}
                  className="border rounded px-2 py-1 text-xs"
                >
                  <option value="confidence">Confidence</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="round">Round</option>
                </select>
              </div>
            )}
          </div>
          {expandedSections.bodyBlocking && (() => {
            // Flatten all events from all rounds
            const allEvents = results.bodyBlocking.flatMap(b => 
              b.events.map(e => ({ ...e, round: b.round }))
            );
            
            let filteredEvents = allEvents;
            
            // Filter by selected players
            if (selectedPlayers.length > 0) {
              filteredEvents = filteredEvents.filter(e => 
                selectedPlayers.includes(e.blockerName) || selectedPlayers.includes(e.victimName)
              );
            }
            
            // Sort
            if (sortBy.bodyBlocking === 'alphabetical') {
              filteredEvents.sort((a, b) => a.blockerName.localeCompare(b.blockerName));
            } else if (sortBy.bodyBlocking === 'round') {
              filteredEvents.sort((a, b) => a.round - b.round);
            } else {
              // Sort by confidence (highest first)
              filteredEvents.sort((a, b) => b.confidence - a.confidence);
            }
            
            return (
              <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto' }}>
                {filteredEvents.map((event, idx) => {
                  const commandId = `block-${event.blockerId}-${event.victimId}-${event.startTick}`;
                  const commands = generateConsoleCommands(event.startTick, event.blockerName);
                  
                  return (
                    <div key={idx} style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-subtle)', width: 'calc(50% - 0.5rem)', minWidth: '25rem' }} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ color: 'var(--color-status-afk-died)' }} className="font-medium">{event.blockerName}</span>
                          <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">→</span>
                          <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{event.victimName}</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(commands, commandId)}
                          style={{ 
                            backgroundColor: copiedCommand === commandId ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                            color: copiedCommand === commandId ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)'
                          }}
                          className="px-2 py-1 rounded text-xs flex items-center gap-1.5 transition-colors hover:opacity-80"
                          title="Copy console commands to spectate at this time"
                        >
                          {copiedCommand === commandId ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                          <span className="font-medium">Copy</span>
                        </button>
                      </div>
                      <div className="space-y-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        <div className="flex items-center gap-2">
                          <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span style={{ color: 'var(--color-text-muted)' }}>Round {event.round}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Timer size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span>Duration: {event.duration.toFixed(1)}s</span>
                          <span style={{ color: 'var(--color-status-afk-died)' }} className="font-medium">
                            ({Math.round(event.confidence * 100)}% confidence)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span>{formatTime(event.startTime)} - {formatTime(event.endTime)}</span>
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          {event.reason}
                        </div>
                        <div className="pl-2 border-l-2 text-xs" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                          <div>Avg distance: {event.featuresSummary.avgDistance.toFixed(1)} units</div>
                          <div>Blocker stationary: {Math.round(event.featuresSummary.blockerStationaryFraction * 100)}%</div>
                          {event.featuresSummary.failedPassAttempts > 0 && (
                            <div>Failed pass attempts: {event.featuresSummary.failedPassAttempts}</div>
                          )}
                          {event.featuresSummary.reblockCount > 0 && (
                            <div>Re-blocks: {event.featuresSummary.reblockCount}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Objective Sabotage - DISABLED */}
      {false && results.objectiveSabotage && results.objectiveSabotage.length > 0 && results.objectiveSabotage.some(o => o.allEvents.length > 0) && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('objectiveSabotage')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-status-afk-died)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <Bomb size={18} style={{ color: 'var(--color-status-afk-died)' }} />
              Objective Sabotage
              <span 
                style={{ 
                  backgroundColor: 'var(--color-accent-primary)', 
                  color: 'var(--color-bg-primary)',
                  fontSize: '0.625rem',
                  padding: '0.125rem 0.375rem',
                  borderRadius: '0.25rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  cursor: 'help'
                }}
                title="This feature is untested and may provide incorrect information"
              >BETA</span>
              {expandedSections.objectiveSabotage ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.objectiveSabotage && (
              <div className="flex items-center gap-3">
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.objectiveSabotage}
                  onChange={(e) => setSortBy(prev => ({ ...prev, objectiveSabotage: e.target.value as 'alphabetical' | 'round' | 'confidence' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    borderColor: 'var(--color-border-subtle)'
                  }}
                  className="border rounded px-2 py-1 text-xs"
                >
                  <option value="confidence">Confidence</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="round">Round</option>
                </select>
              </div>
            )}
          </div>
          {expandedSections.objectiveSabotage && (() => {
            // Flatten all events from all rounds
            const allEvents = results.objectiveSabotage.flatMap(o => o.allEvents);
            
            let filteredEvents = allEvents;
            
            // Filter by selected players
            if (selectedPlayers.length > 0) {
              filteredEvents = filteredEvents.filter(e => selectedPlayers.includes(e.actorName));
            }
            
            // Sort
            if (sortBy.objectiveSabotage === 'alphabetical') {
              filteredEvents.sort((a, b) => a.actorName.localeCompare(b.actorName));
            } else if (sortBy.objectiveSabotage === 'round') {
              filteredEvents.sort((a, b) => a.round - b.round);
            } else {
              // Sort by confidence (highest first)
              filteredEvents.sort((a, b) => b.confidence - a.confidence);
            }
            
            return (
              <div className="flex flex-wrap gap-4" style={{ maxHeight: '64rem', overflowY: 'auto' }}>
                {filteredEvents.map((event, idx) => {
                  const commandId = `objective-${event.actorId}-${event.startTick}`;
                  const commands = generateConsoleCommands(event.startTick, event.actorName);
                  
                  return (
                    <div key={idx} style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-subtle)', width: 'calc(50% - 0.5rem)', minWidth: '25rem' }} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ color: 'var(--color-status-afk-died)' }} className="font-medium">{event.actorName}</span>
                          <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">•</span>
                          <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">{event.type.replace(/([A-Z])/g, ' $1').trim()}</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(commands, commandId)}
                          style={{ 
                            backgroundColor: copiedCommand === commandId ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)',
                            color: copiedCommand === commandId ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)'
                          }}
                          className="px-2 py-1 rounded text-xs flex items-center gap-1.5 transition-colors hover:opacity-80"
                          title="Copy console commands to spectate at this time"
                        >
                          {copiedCommand === commandId ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                          <span className="font-medium">Copy</span>
                        </button>
                      </div>
                      <div className="space-y-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        <div className="flex items-center gap-2">
                          <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span style={{ color: 'var(--color-text-muted)' }}>Round {event.round}</span>
                        </div>
                        {event.duration > 0 && (
                          <div className="flex items-center gap-2">
                            <Timer size={12} style={{ color: 'var(--color-text-muted)' }} />
                            <span>Duration: {event.duration.toFixed(1)}s</span>
                            <span style={{ color: 'var(--color-status-afk-died)' }} className="font-medium">
                              ({Math.round(event.confidence * 100)}% confidence)
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Clock size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span>{formatTime(event.startTime)} - {formatTime(event.endTime)}</span>
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          {event.humanReason}
                        </div>
                        <div className="pl-2 border-l-2 text-xs" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                          <div>Time left: {event.featuresSummary.timeLeft.toFixed(1)}s</div>
                          <div>Teammates: {event.featuresSummary.aliveTeammates} | Enemies: {event.featuresSummary.aliveEnemies}</div>
                          <div>Pressure: {Math.round(event.featuresSummary.pressureScore * 100)}% | Hopeless: {Math.round(event.featuresSummary.hopelessScore * 100)}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Economy Griefing */}
      {false && results.economyGriefing && results.economyGriefing.byPlayer && results.economyGriefing.byPlayer.size > 0 && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => toggleSection('economyGriefing')}
              style={{ color: 'var(--color-text-primary)' }}
              className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-status-afk-died)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
            >
              <DollarSign size={20} style={{ color: 'var(--color-status-afk-died)' }} />
              <span>Economy Griefing / Buy Sabotage</span>
              <span 
                style={{ 
                  backgroundColor: 'var(--color-accent-primary)', 
                  color: 'var(--color-bg-primary)',
                  fontSize: '0.5rem',
                  padding: '0.125rem 0.25rem',
                  borderRadius: '0.125rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  cursor: 'help',
                  marginLeft: '0.5rem'
                }}
                title="This feature is untested and may provide incorrect information"
              >BETA</span>
            </button>
            <button
              onClick={() => toggleSection('economyGriefing')}
              style={{ color: 'var(--color-text-muted)' }}
              className="transition-colors hover:opacity-80"
            >
              {expandedSections.economyGriefing ? (
                <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
              ) : (
                <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </button>
            {expandedSections.economyGriefing && (
              <div className="flex items-center gap-3">
                <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  value={sortBy.economyGriefing}
                  onChange={(e) => setSortBy(prev => ({ ...prev, economyGriefing: e.target.value as 'alphabetical' | 'round' | 'confidence' | 'score' }))}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-primary)',
                    borderColor: 'var(--color-border-subtle)'
                  }}
                  className="border rounded px-2 py-1 text-xs"
                >
                  <option value="alphabetical">Sort by Name</option>
                  <option value="round">Sort by Round</option>
                  <option value="confidence">Sort by Confidence</option>
                  <option value="score">Sort by Score</option>
                </select>
              </div>
            )}
          </div>

          {expandedSections.economyGriefing && (() => {
            // Get all players with economy events (with playerId and playerName)
            const players = Array.from(results.economyGriefing.byPlayer.entries()).map(([playerId, playerResult]) => {
              // Get player name from demoFile
              let playerName = `Player ${playerId}`;
              if (demoFile) {
                for (const frame of demoFile.frames) {
                  const player = frame.players.find(p => p.id === playerId);
                  if (player) {
                    playerName = player.name;
                    break;
                  }
                }
              }
              return { playerId, playerName, ...playerResult };
            });
            
            let filteredPlayers = players;
            
            // Filter by selected players
            if (selectedPlayers.length > 0) {
              filteredPlayers = filteredPlayers.filter(p => selectedPlayers.includes(p.playerName));
            }
            
            // Sort players
            if (sortBy.economyGriefing === 'alphabetical') {
              filteredPlayers.sort((a, b) => a.playerName.localeCompare(b.playerName));
            } else if (sortBy.economyGriefing === 'round') {
              filteredPlayers.sort((a, b) => {
                const aFirstRound = Math.min(...a.events.map(e => e.round));
                const bFirstRound = Math.min(...b.events.map(e => e.round));
                return aFirstRound - bFirstRound;
              });
            } else if (sortBy.economyGriefing === 'confidence') {
              filteredPlayers.sort((a, b) => b.matchConfidence - a.matchConfidence);
            } else {
              // Sort by score
              filteredPlayers.sort((a, b) => b.matchScore - a.matchScore);
            }
            
            if (filteredPlayers.length === 0) {
              return (
                <div className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                  No economy griefing events found for selected players.
                </div>
              );
            }
            
            return (
              <div className="space-y-4">
                {filteredPlayers.map((playerResult) => {
                  // Sort events for this player
                  const sortedEvents = [...playerResult.events].sort((a, b) => {
                    if (sortBy.economyGriefing === 'round') {
                      return a.round - b.round;
                    } else if (sortBy.economyGriefing === 'confidence') {
                      return b.confidence - a.confidence;
                    } else if (sortBy.economyGriefing === 'score') {
                      return b.score - a.score;
                    }
                    return 0;
                  });
                  
                  return (
                    <div
                      key={playerResult.playerId}
                      style={{
                        backgroundColor: 'var(--color-bg-tertiary)',
                        borderColor: 'var(--color-border-subtle)'
                      }}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <button
                          onClick={() => setEconomyTimelineModal({ playerId: playerResult.playerId, playerName: playerResult.playerName })}
                          style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-primary)',
                            borderColor: 'var(--color-border-subtle)'
                          }}
                          className="border rounded px-3 py-1 text-xs font-medium transition-colors hover:opacity-80 flex items-center gap-1"
                        >
                          <Clock size={12} />
                          View Timeline
                        </button>
                      </div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {(() => {
                            // Get team from first event or demoFile
                            let playerTeam = Team.SPECTATOR;
                            if (demoFile) {
                              for (const frame of demoFile.frames) {
                                const player = frame.players.find(p => p.id === playerResult.playerId);
                                if (player) {
                                  playerTeam = player.team;
                                  break;
                                }
                              }
                            }
                            return (
                              <div
                                style={{
                                  backgroundColor: getTeamColor(playerTeam),
                                  color: 'white',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '0.25rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 'bold'
                                }}
                              >
                                {playerResult.playerName}
                              </div>
                            );
                          })()}
                          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            <span>{playerResult.events.length} event{playerResult.events.length !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>Score: {playerResult.matchScore.toFixed(2)}</span>
                            <span>•</span>
                            <span>Confidence: {Math.round(playerResult.matchConfidence * 100)}%</span>
                            {playerResult.flaggedMatch && (
                              <>
                                <span>•</span>
                                <span style={{ color: 'var(--color-status-afk-died)', fontWeight: 'bold' }}>FLAGGED</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard(
                            generateConsoleCommands(0, playerResult.playerName),
                            `economy-${playerResult.playerId}`
                          )}
                          style={{
                            backgroundColor: copiedCommand === `economy-${playerResult.playerId}` ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                            color: copiedCommand === `economy-${playerResult.playerId}` ? 'var(--color-bg-primary)' : 'var(--color-text-primary)'
                          }}
                          className="px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                        >
                          {copiedCommand === `economy-${playerResult.playerId}` ? (
                            <>
                              <Check size={12} />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              Copy Commands
                            </>
                          )}
                        </button>
                      </div>
                      
                      <div className="space-y-2">
                        {sortedEvents.map((event, idx) => (
                          <div
                            key={idx}
                            style={{
                              backgroundColor: 'var(--color-bg-primary)',
                              borderColor: 'var(--color-border-subtle)'
                            }}
                            className="border rounded p-3"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <span
                                style={{
                                  backgroundColor: 'var(--color-status-afk-died)',
                                  color: 'white',
                                  padding: '0.125rem 0.375rem',
                                  borderRadius: '0.25rem',
                                  fontSize: '0.625rem',
                                  fontWeight: 'bold',
                                  textTransform: 'uppercase'
                                }}
                              >
                                {event.type.replace(/([A-Z])/g, ' $1').trim()}
                              </span>
                              <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                                Confidence: {Math.round(event.confidence * 100)}%
                              </span>
                              <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                                Score: {event.score.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <Award size={12} style={{ color: 'var(--color-text-muted)' }} />
                              <span style={{ color: 'var(--color-text-muted)' }}>Round {event.round}</span>
                            </div>
                            <div className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                              {event.humanReason}
                            </div>
                            {event.featureSummary && (
                              <div className="pl-2 border-l-2 text-xs" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                                {event.featureSummary.postBuyValue !== undefined && (
                                  <div>Post-buy value: ${event.featureSummary.postBuyValue.toLocaleString()}</div>
                                )}
                                {event.featureSummary.teamMedianValue !== undefined && (
                                  <div>Team median: ${event.featureSummary.teamMedianValue.toLocaleString()}</div>
                                )}
                                {event.featureSummary.teamBuyState && (
                                  <div>Team buy state: {event.featureSummary.teamBuyState}</div>
                                )}
                                {event.featureSummary.damageDealt !== undefined && (
                                  <div>Damage: {event.featureSummary.damageDealt}</div>
                                )}
                                {event.featureSummary.timeToDeath !== undefined && (
                                  <div>Time to death: {event.featureSummary.timeToDeath.toFixed(1)}s</div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Clean Players (Not in any sections) */}
      {(() => {
        // Get all unique players from demo (use player ID as key to avoid duplicates)
        const allPlayers = new Map<number, { id: number; name: string; team: Team }>();
        if (demoFile) {
          for (const frame of demoFile.frames) {
            for (const player of frame.players) {
              if (player.team !== Team.SPECTATOR && !allPlayers.has(player.id)) {
                allPlayers.set(player.id, { id: player.id, name: player.name, team: player.team });
              }
            }
          }
        }
        
        // Get all players that appear in any analysis section (by ID for consistency)
        const playersInSections = new Set<number>();
        
        // Helper to find player ID by name (with fallback)
        const getPlayerIdByName = (name: string): number | null => {
          // First try exact match
          for (const [id, player] of allPlayers.entries()) {
            if (player.name === name) return id;
          }
          // If not found, try case-insensitive match
          for (const [id, player] of allPlayers.entries()) {
            if (player.name.toLowerCase() === name.toLowerCase()) return id;
          }
          return null;
        };
        
        // AFK (has playerId)
        results.afkDetections.forEach(afk => {
          if (afk.playerId) {
            playersInSections.add(afk.playerId);
          } else {
            const playerId = getPlayerIdByName(afk.playerName);
            if (playerId !== null) playersInSections.add(playerId);
          }
        });
        
        // Team Kills (has attackerId and victimId)
        results.teamKills.forEach(tk => {
          if (tk.attackerId) playersInSections.add(tk.attackerId);
          if (tk.victimId) playersInSections.add(tk.victimId);
        });
        
        // Team Damage (has attackerId and victimId)
        results.teamDamage.forEach(td => {
          if (td.attackerId) playersInSections.add(td.attackerId);
          if (td.victimId) playersInSections.add(td.victimId);
        });
        
        // Disconnects (has playerId)
        results.disconnects?.forEach(d => {
          if (d.playerId) {
            playersInSections.add(d.playerId);
          } else {
            const playerId = getPlayerIdByName(d.playerName);
            if (playerId !== null) playersInSections.add(playerId);
          }
        });
        
        // Team Flashes (has throwerId and victimId)
        results.teamFlashes?.forEach(tf => {
          if (tf.throwerId) playersInSections.add(tf.throwerId);
          if (tf.victimId) playersInSections.add(tf.victimId);
        });
        
        // Mid-Round Inactivity (has playerId) - DISABLED
        // results.midRoundInactivity?.forEach(m => {
        //   if (m.playerId) {
        //     playersInSections.add(m.playerId);
        //   } else {
        //     const playerId = getPlayerIdByName(m.playerName);
        //     if (playerId !== null) playersInSections.add(playerId);
        //   }
        // });
        
        // Body Blocking (check events for player IDs or names) - DISABLED
        // results.bodyBlocking?.forEach(bb => {
        //   bb.events.forEach(event => {
        //     // Check if event has player IDs
        //     if ('blockerId' in event && typeof event.blockerId === 'number') {
        //       playersInSections.add(event.blockerId as number);
        //     } else if (event.blockerName) {
        //       const blockerId = getPlayerIdByName(event.blockerName);
        //       if (blockerId !== null) playersInSections.add(blockerId);
        //     }
        //     if ('blockedId' in event && typeof event.blockedId === 'number') {
        //       playersInSections.add(event.blockedId as number);
        //     } else if (event.blockedName) {
        //       const blockedId = getPlayerIdByName(event.blockedName);
        //       if (blockedId !== null) playersInSections.add(blockedId);
        //     }
        //   });
        // });
        
        // Objective Sabotage (has playerId in playerData) - DISABLED
        // results.objectiveSabotage?.forEach(os => {
        //   os.eventsByPlayer.forEach((playerData) => {
        //     if (playerData.playerId) {
        //       playersInSections.add(playerData.playerId);
        //     } else {
        //       const playerId = getPlayerIdByName(playerData.playerName);
        //       if (playerId !== null) playersInSections.add(playerId);
        //     }
        //   });
        // });
        
        // Economy Griefing (even though disabled, check if it exists)
        if (results.economyGriefing?.byPlayer) {
          results.economyGriefing.byPlayer.forEach((playerResult, playerId) => {
            playersInSections.add(playerId);
          });
        }
        
        // Find clean players (not in any section)
        const cleanPlayers = Array.from(allPlayers.values()).filter(p => !playersInSections.has(p.id));
        
        // Filter by selected players if applicable
        let filteredCleanPlayers = cleanPlayers;
        if (selectedPlayers.length > 0) {
          filteredCleanPlayers = cleanPlayers.filter(p => selectedPlayers.includes(p.name));
        }
        
        // Sort alphabetically
        filteredCleanPlayers.sort((a, b) => a.name.localeCompare(b.name));
        
        if (cleanPlayers.length === 0) return null;
        
        return (
          <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => toggleSection('cleanPlayers')}
                style={{ color: 'var(--color-text-primary)' }}
                className="flex items-center gap-2 text-lg font-semibold transition-colors hover:opacity-80"
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
              >
                <Users size={18} />
                Clean Players
                {expandedSections.cleanPlayers ? (
                  <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
                ) : (
                  <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
                )}
              </button>
            </div>
            
            {expandedSections.cleanPlayers && (
              <div className="space-y-2">
                {filteredCleanPlayers.length === 0 ? (
                  <div className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                    No clean players found for selected filters.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredCleanPlayers.map((player) => (
                      <div
                        key={player.id}
                        style={{
                          backgroundColor: 'var(--color-bg-tertiary)',
                          borderColor: 'var(--color-border-subtle)'
                        }}
                        className="border rounded-lg p-3 flex items-center justify-between"
                      >
                        <div
                          style={{
                            backgroundColor: player.team === Team.CT ? 'var(--color-team-ct)' : player.team === Team.T ? 'var(--color-team-t)' : 'var(--color-text-muted)',
                            color: 'white',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: 'bold'
                          }}
                        >
                          {player.name}
                        </div>
                        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          <Check size={14} style={{ color: 'var(--color-accent-primary)' }} />
                          <span>No issues</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                  Showing {filteredCleanPlayers.length} of {cleanPlayers.length} clean player{cleanPlayers.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Economy Timeline Modal */}
      {false && economyTimelineModal && (() => {
        const playerResult = results.economyGriefing?.byPlayer?.get(economyTimelineModal.playerId);
        if (!playerResult) return null;
        
        // Get team color
        let playerTeam = Team.SPECTATOR;
        if (demoFile) {
          for (const frame of demoFile.frames) {
            const player = frame.players.find(p => p.id === economyTimelineModal.playerId);
            if (player) {
              playerTeam = player.team;
              break;
            }
          }
        }
        
        // Sort round summaries by round number
        const sortedSummaries = [...playerResult.roundSummaries].sort((a, b) => a.round - b.round);
        
        // Find max value for scaling
        const maxValue = Math.max(...sortedSummaries.map(s => Math.max(s.preBuyValue, s.postBuyValue)), 1000);
        
        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem'
            }}
            onClick={() => setEconomyTimelineModal(null)}
          >
            <div
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-subtle)',
                maxWidth: '90vw',
                maxHeight: '90vh',
                width: '1000px',
                overflow: 'auto'
              }}
              className="border rounded-lg p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    style={{
                      backgroundColor: getTeamColor(playerTeam),
                      color: 'white',
                      padding: '0.5rem 1rem',
                      borderRadius: '0.5rem',
                      fontSize: '1rem',
                      fontWeight: 'bold'
                    }}
                  >
                    {economyTimelineModal.playerName}
                  </div>
                  <h2 style={{ color: 'var(--color-text-primary)' }} className="text-xl font-semibold">
                    Economy Timeline
                  </h2>
                </div>
                <button
                  onClick={() => setEconomyTimelineModal(null)}
                  style={{
                    color: 'var(--color-text-muted)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  className="hover:opacity-80"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="space-y-4">
                {sortedSummaries.map((summary) => {
                  const roundEvents = playerResult.events.filter(e => e.round === summary.round);
                  const preBuyHeight = (summary.preBuyValue / maxValue) * 200;
                  const postBuyHeight = (summary.postBuyValue / maxValue) * 200;
                  
                  return (
                    <div
                      key={summary.round}
                      style={{
                        backgroundColor: 'var(--color-bg-tertiary)',
                        borderColor: 'var(--color-border-subtle)'
                      }}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div
                            style={{
                              backgroundColor: 'var(--color-accent-primary)',
                              color: 'white',
                              padding: '0.25rem 0.75rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.875rem',
                              fontWeight: 'bold'
                            }}
                          >
                            Round {summary.round}
                          </div>
                          <div
                            style={{
                              backgroundColor: summary.teamBuyState === 'FULL' ? 'var(--color-status-afk-died)' :
                                             summary.teamBuyState === 'FORCE' ? 'var(--color-accent-primary)' :
                                             'var(--color-text-muted)',
                              color: 'white',
                              padding: '0.25rem 0.75rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              textTransform: 'uppercase'
                            }}
                          >
                            {summary.teamBuyState}
                          </div>
                          {roundEvents.length > 0 && (
                            <div
                              style={{
                                backgroundColor: 'var(--color-status-afk-died)',
                                color: 'white',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.75rem',
                                fontWeight: 'bold'
                              }}
                            >
                              {roundEvents.length} Event{roundEvents.length !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                        <div style={{ color: 'var(--color-text-muted)' }} className="text-sm">
                          Team Median: ${summary.teamMedianValue.toLocaleString()}
                        </div>
                      </div>
                      
                      {/* Economy Value Visualization */}
                      <div className="flex items-end gap-4 mb-3" style={{ height: '220px' }}>
                        <div className="flex flex-col items-center gap-2">
                          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Pre-Buy</div>
                          <div className="flex flex-col items-center gap-1" style={{ height: '200px', justifyContent: 'flex-end' }}>
                            <div
                              style={{
                                backgroundColor: 'var(--color-text-muted)',
                                width: '40px',
                                height: `${preBuyHeight}px`,
                                borderRadius: '0.25rem 0.25rem 0 0',
                                minHeight: preBuyHeight > 0 ? '2px' : '0'
                              }}
                            />
                            <div style={{ color: 'var(--color-text-primary)' }} className="text-xs font-medium">
                              ${summary.preBuyValue.toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 flex flex-col items-center gap-2">
                          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">Post-Buy</div>
                          <div className="flex flex-col items-center gap-1" style={{ height: '200px', justifyContent: 'flex-end' }}>
                            <div
                              style={{
                                backgroundColor: summary.teamBuyState === 'FULL' ? 'var(--color-status-afk-died)' :
                                               summary.teamBuyState === 'FORCE' ? 'var(--color-accent-primary)' :
                                               'var(--color-text-muted)',
                                width: '60px',
                                height: `${postBuyHeight}px`,
                                borderRadius: '0.25rem 0.25rem 0 0',
                                minHeight: postBuyHeight > 0 ? '2px' : '0'
                              }}
                            />
                            <div style={{ color: 'var(--color-text-primary)' }} className="text-xs font-medium">
                              ${summary.postBuyValue.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Acquired Items */}
                      {summary.acquiredDuringBuy.length > 0 && (
                        <div className="mb-2">
                          <div style={{ color: 'var(--color-text-secondary)' }} className="text-xs font-medium mb-1">
                            Acquired during buy:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {summary.acquiredDuringBuy.map((item, idx) => (
                              <span
                                key={idx}
                                style={{
                                  backgroundColor: 'var(--color-bg-primary)',
                                  color: 'var(--color-text-primary)',
                                  padding: '0.125rem 0.5rem',
                                  borderRadius: '0.25rem',
                                  fontSize: '0.75rem'
                                }}
                              >
                                {item.replace('weapon_', '').replace('item_', '')}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Events for this round */}
                      {roundEvents.length > 0 && (
                        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                          <div style={{ color: 'var(--color-text-secondary)' }} className="text-xs font-medium mb-2">
                            Events:
                          </div>
                          <div className="space-y-2">
                            {roundEvents.map((event, idx) => (
                              <div
                                key={idx}
                                style={{
                                  backgroundColor: 'var(--color-bg-primary)',
                                  borderColor: 'var(--color-border-subtle)'
                                }}
                                className="border rounded p-2"
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span
                                    style={{
                                      backgroundColor: 'var(--color-status-afk-died)',
                                      color: 'white',
                                      padding: '0.125rem 0.375rem',
                                      borderRadius: '0.25rem',
                                      fontSize: '0.625rem',
                                      fontWeight: 'bold',
                                      textTransform: 'uppercase'
                                    }}
                                  >
                                    {event.type.replace(/([A-Z])/g, ' $1').trim()}
                                  </span>
                                  <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                                    Confidence: {Math.round(event.confidence * 100)}%
                                  </span>
                                </div>
                                <div style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }} className="text-xs">
                                  {event.humanReason}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Empty State */}
      {results.afkDetections.length === 0 && results.teamKills.length === 0 && results.teamDamage.length === 0 && (!results.disconnects || results.disconnects.length === 0) && (!results.teamFlashes || results.teamFlashes.length === 0) && (!results.economyGriefing || !results.economyGriefing.byPlayer || results.economyGriefing.byPlayer.size === 0) && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users style={{ color: 'var(--color-text-muted)' }} className="mb-4" size={48} />
          <p style={{ color: 'var(--color-text-secondary)' }} className="text-lg font-medium">No issues detected</p>
          <p style={{ color: 'var(--color-text-muted)' }} className="text-sm mt-2">The demo analysis found no issues detected.</p>
        </div>
      )}
    </div>
  );
};

export default AnalysisResults;
