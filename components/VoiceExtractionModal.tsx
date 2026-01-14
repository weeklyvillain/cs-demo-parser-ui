import React, { useState, useMemo } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore';
import { Team } from '../types';
import { TEAM_COLORS } from '../constants';

interface VoiceExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExtract: (options: {
    playerIds: number[];
    removeSilence: boolean;
  }) => Promise<void>;
}

const VoiceExtractionModal: React.FC<VoiceExtractionModalProps> = ({
  isOpen,
  onClose,
  onExtract,
}) => {
  const { getActivePlayers } = useDemoStore();
  const players = getActivePlayers();
  
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<number>>(new Set());
  const [removeSilence, setRemoveSilence] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  // Group players by team
  const playersByTeam = useMemo(() => {
    const ct = players.filter(p => p.team === Team.CT);
    const t = players.filter(p => p.team === Team.T);
    return { ct, t };
  }, [players]);

  const handleTogglePlayer = (playerId: number) => {
    const newSelected = new Set(selectedPlayerIds);
    if (newSelected.has(playerId)) {
      newSelected.delete(playerId);
    } else {
      newSelected.add(playerId);
    }
    setSelectedPlayerIds(newSelected);
  };

  const handleSelectTeam = (team: Team) => {
    const teamPlayers = players.filter(p => p.team === team);
    const teamIds = new Set(teamPlayers.map(p => p.id));
    
    // If all team players are selected, deselect them; otherwise select all
    const allSelected = teamPlayers.every(p => selectedPlayerIds.has(p.id));
    
    const newSelected = new Set(selectedPlayerIds);
    if (allSelected) {
      teamIds.forEach(id => newSelected.delete(id));
    } else {
      teamIds.forEach(id => newSelected.add(id));
    }
    setSelectedPlayerIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedPlayerIds.size === players.length) {
      setSelectedPlayerIds(new Set());
    } else {
      setSelectedPlayerIds(new Set(players.map(p => p.id)));
    }
  };

  const handleExtract = async () => {
    if (selectedPlayerIds.size === 0) {
      alert('Please select at least one player');
      return;
    }

    setIsExtracting(true);
    try {
      await onExtract({
        playerIds: Array.from(selectedPlayerIds),
        removeSilence,
      });
      onClose();
    } catch (error: any) {
      alert(`Failed to extract voice: ${error.message || error}`);
    } finally {
      setIsExtracting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Extract Voice Data</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            disabled={isExtracting}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Options */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={removeSilence}
                onChange={(e) => setRemoveSilence(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-slate-900"
                disabled={isExtracting}
              />
              <span className="text-sm text-slate-300">
                Remove silence from extracted audio
              </span>
            </label>
          </div>

          {/* Player Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">Select Players</h3>
              <button
                onClick={handleSelectAll}
                className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                disabled={isExtracting}
              >
                {selectedPlayerIds.size === players.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Team A (CT) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Team A
                </h4>
                <button
                  onClick={() => handleSelectTeam(Team.CT)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  disabled={isExtracting}
                >
                  {playersByTeam.ct.every(p => selectedPlayerIds.has(p.id)) ? 'Deselect Team' : 'Select Team'}
                </button>
              </div>
              <div className="space-y-1">
                {playersByTeam.ct.map((player) => (
                  <label
                    key={player.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPlayerIds.has(player.id)}
                      onChange={() => handleTogglePlayer(player.id)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-slate-900"
                      disabled={isExtracting}
                    />
                    <span className="text-sm text-slate-300 flex-1">{player.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Team B (T) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Team B
                </h4>
                <button
                  onClick={() => handleSelectTeam(Team.T)}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  disabled={isExtracting}
                >
                  {playersByTeam.t.every(p => selectedPlayerIds.has(p.id)) ? 'Deselect Team' : 'Select Team'}
                </button>
              </div>
              <div className="space-y-1">
                {playersByTeam.t.map((player) => (
                  <label
                    key={player.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPlayerIds.has(player.id)}
                      onChange={() => handleTogglePlayer(player.id)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-slate-900"
                      disabled={isExtracting}
                    />
                    <span className="text-sm text-slate-300 flex-1">{player.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            disabled={isExtracting}
          >
            Cancel
          </button>
          <button
            onClick={handleExtract}
            disabled={isExtracting || selectedPlayerIds.size === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExtracting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Download size={16} />
                Extract Voice
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceExtractionModal;

