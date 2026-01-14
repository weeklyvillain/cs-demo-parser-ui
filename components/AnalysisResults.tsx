import React, { useState, useRef } from 'react';
import { AnalysisResults as AnalysisResultsType, AFKDetection, TeamKill, TeamDamage, DisconnectReconnect } from '../services/demoAnalyzer';
import { Team, DemoFile } from '../types';
import { Skull, Zap, Clock, Users, WifiOff, Copy, Check, ChevronDown, ChevronUp, Info, Shield, ArrowUpDown } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';

interface AnalysisResultsProps {
  results: AnalysisResultsType;
  selectedPlayers?: string[];
}

const AnalysisResults: React.FC<AnalysisResultsProps> = ({ results, selectedPlayers = [] }) => {
  const { demoFile } = useDemoStore();
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [afkThreshold, setAfkThreshold] = useState<number>(8); // Default 8 seconds
  const [expandedSections, setExpandedSections] = useState({
    afk: true,
    teamKills: true,
    teamDamage: true,
    disconnects: true
  });
  const [sortBy, setSortBy] = useState<{
    afk: 'alphabetical' | 'round';
    teamKills: 'alphabetical' | 'round';
    teamDamage: 'alphabetical' | 'round' | 'damage';
    disconnects: 'alphabetical' | 'round';
  }>({
    afk: 'alphabetical',
    teamKills: 'alphabetical',
    teamDamage: 'damage',
    disconnects: 'alphabetical'
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
      <div className="grid grid-cols-4 gap-4">
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
                Threshold: <span style={{ color: 'var(--color-text-primary)' }} className="font-medium">{afkThreshold}s</span>
              </label>
              <input
                type="range"
                min="5"
                max="30"
                value={afkThreshold}
                onChange={(e) => setAfkThreshold(Number(e.target.value))}
                style={{ 
                  width: '8rem',
                  height: '0.5rem',
                  backgroundColor: 'var(--color-bg-tertiary)',
                  accentColor: 'var(--color-accent-primary)'
                }}
                className="rounded-lg appearance-none cursor-pointer"
              />
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
              } else {
                // Sort by lowest round first
                sortedPlayers.sort((a, b) => {
                  const aMinRound = Math.min(...a.rounds.map(r => r.round));
                  const bMinRound = Math.min(...b.rounds.map(r => r.round));
                  return aMinRound - bMinRound;
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
                              <span style={{ color: 'var(--color-text-secondary)' }} className="text-xs">Round {afk.round}</span>
                              {getTeamBadge(afk.team)}
                              <span style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                                {afk.afkDuration.toFixed(1)}s AFK
                              </span>
                              {afk.diedWhileAFK && (
                                <span style={{ color: 'var(--color-status-afk-died)' }} className="flex items-center gap-1 text-xs font-semibold">
                                  <Skull size={12} />
                                  Died while AFK
                                </span>
                              )}
                              {afk.timeToFirstMovement !== undefined && !afk.diedWhileAFK && (
                                <span style={{ color: 'var(--color-status-afk)' }} className="text-xs">
                                  • Moved after {afk.timeToFirstMovement.toFixed(1)}s
                                </span>
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
                          <div style={{ color: 'var(--color-text-muted)' }} className="text-xs">
                            Reason: {afk.reason === 'both' ? 'No movement and no actions' : afk.reason === 'no_movement' ? 'No movement' : 'No actions'}
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
                  <div className="flex items-center gap-3 text-xs">
                    <span style={{ color: 'var(--color-text-secondary)' }}>Time:</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{formatTime(tk.time)}</span>
                  </div>
                  <div style={{ color: 'var(--color-text-muted)' }} className="flex items-center gap-2 text-xs">
                    <span>Round {tk.round}</span>
                    <span>•</span>
                    <span>{tk.weapon}</span>
                    {tk.isHeadshot && <span style={{ color: 'var(--color-status-afk-died)' }}>• Headshot</span>}
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
              <div className="flex items-center gap-2">
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
            let filteredTeamDamage = results.teamDamage;
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
              const commands = generateConsoleCommands(td.tick, td.victimName);
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
                  <div className="flex items-center gap-3 text-xs">
                    <span style={{ color: 'var(--color-text-secondary)' }}>Damage:</span>
                    {td.initialHP !== undefined && td.finalHP !== undefined ? (
                      <span style={{ color: 'var(--color-accent-primary)' }} className="font-semibold">
                        {td.initialHP} → {td.finalHP} HP ({td.damage} dmg)
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-accent-primary)' }} className="font-semibold">{td.damage} HP</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span style={{ color: 'var(--color-text-secondary)' }}>Time:</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{formatTime(td.time)}</span>
                  </div>
                  <div style={{ color: 'var(--color-text-muted)' }} className="flex items-center gap-2 text-xs">
                    <span>Round {td.round}</span>
                    {td.weapon && (
                      <>
                        <span>•</span>
                        <span>{mapWeaponName(td.weapon)}</span>
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
                  <div className="flex items-center gap-3 text-xs">
                    <span style={{ color: 'var(--color-text-secondary)' }}>Disconnected:</span>
                    <span style={{ color: 'var(--color-status-neutral)' }} className="font-medium">Round {dc.disconnectRound}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>at {formatTime(dc.disconnectTime)}</span>
                    {dc.diedBeforeDisconnect && (
                      <TooltipIcon
                        icon={<Skull size={14} />}
                        tooltip="Player died in this round before disconnecting, so this round is not counted as missed"
                        color="var(--color-text-muted)"
                      />
                    )}
                  </div>
                  
                  {dc.reconnectTime ? (
                    <>
                      <div className="flex items-center gap-3 text-xs">
                        <span style={{ color: 'var(--color-text-secondary)' }}>Reconnected:</span>
                        <span style={{ color: 'var(--color-accent-primary)' }} className="font-medium">Round {dc.reconnectRound || '?'}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>at {formatTime(dc.reconnectTime)}</span>
                        {dc.reconnectedBeforeFreezeEnd && (
                          <TooltipIcon
                            icon={<Shield size={14} />}
                            tooltip="Player reconnected before freeze time ended, so they are playing this round"
                            color="var(--color-accent-primary)"
                          />
                        )}
                      </div>
                      {dc.duration && (
                        <div className="flex items-center gap-3 text-xs">
                          <span style={{ color: 'var(--color-text-secondary)' }}>Duration:</span>
                          <span style={{ color: 'var(--color-text-primary)' }}>{dc.duration.toFixed(1)}s</span>
                        </div>
                      )}
                      {dc.roundsMissed !== undefined && dc.roundsMissed > 0 && (
                        <div className="flex items-center gap-3 text-xs">
                          <span style={{ color: 'var(--color-text-secondary)' }}>Rounds missed:</span>
                          <span style={{ color: 'var(--color-status-afk)' }} className="font-semibold">{dc.roundsMissed} round{dc.roundsMissed !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 text-xs">
                        <span style={{ color: 'var(--color-text-secondary)' }}>Status:</span>
                        <span style={{ color: 'var(--color-status-afk-died)' }} className="font-semibold">Never reconnected</span>
                      </div>
                      {dc.duration && (
                        <div className="flex items-center gap-3 text-xs">
                          <span style={{ color: 'var(--color-text-secondary)' }}>Offline for:</span>
                          <span style={{ color: 'var(--color-text-primary)' }}>{dc.duration.toFixed(1)}s</span>
                        </div>
                      )}
                      {dc.roundsMissed !== undefined && dc.roundsMissed > 0 && (
                        <div className="flex items-center gap-3 text-xs">
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

      {/* Empty State */}
      {results.afkDetections.length === 0 && results.teamKills.length === 0 && results.teamDamage.length === 0 && (!results.disconnects || results.disconnects.length === 0) && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users style={{ color: 'var(--color-text-muted)' }} className="mb-4" size={48} />
          <p style={{ color: 'var(--color-text-secondary)' }} className="text-lg font-medium">No issues detected</p>
          <p style={{ color: 'var(--color-text-muted)' }} className="text-sm mt-2">The demo analysis found no AFK players, team kills, team damage, or disconnects.</p>
        </div>
      )}
    </div>
  );
};

export default AnalysisResults;
