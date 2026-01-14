import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface ParsingProgress {
  percentage: number;
  currentStep: string;
  estimatedTimeRemaining: number; // in seconds
}

interface ProgressDisplayProps {
  progress: ParsingProgress | null;
}

const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ progress }) => {
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    if (!progress || progress.estimatedTimeRemaining <= 0) {
      setCountdown(0);
      return;
    }

    // Set initial countdown
    setCountdown(Math.ceil(progress.estimatedTimeRemaining));

    // Update countdown every second
    const interval = setInterval(() => {
      setCountdown((prev) => {
        const newValue = Math.max(0, prev - 1);
        return newValue;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [progress?.estimatedTimeRemaining]);

  // Calculate progress bar width based on estimated time remaining
  // Progress increases as time remaining decreases
  // We track the initial estimated time and calculate progress from that
  const [initialEstimatedTime, setInitialEstimatedTime] = useState<number>(0);

  useEffect(() => {
    if (progress && progress.estimatedTimeRemaining > 0 && initialEstimatedTime === 0) {
      setInitialEstimatedTime(progress.estimatedTimeRemaining);
    }
  }, [progress, initialEstimatedTime]);

  const getProgressWidth = () => {
    if (!progress) return 0;
    
    // If we have a percentage, use it
    if (progress.percentage > 0) {
      return progress.percentage;
    }
    
    // Otherwise, calculate from time remaining vs initial estimate
    if (initialEstimatedTime > 0 && progress.estimatedTimeRemaining > 0) {
      const elapsed = initialEstimatedTime - progress.estimatedTimeRemaining;
      const progressPercent = (elapsed / initialEstimatedTime) * 100;
      return Math.min(99, Math.max(1, progressPercent));
    }
    
    return 5; // Start with small progress
  };

  const formatTime = (seconds: number) => {
    if (seconds <= 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="flex flex-col items-center gap-4 p-10 w-full max-w-md">
      <Loader2 
        style={{ color: 'var(--color-accent-primary)' }}
        className="animate-spin" 
        size={48} 
      />
      <div className="w-full">
        <div className="flex justify-between items-center mb-2">
          <span 
            style={{ color: 'var(--color-text-primary)' }}
            className="font-medium"
          >
            {progress?.currentStep || 'Processing...'}
          </span>
          <div className="flex items-center gap-2">
            {progress && progress.percentage > 0 && (
              <span 
                style={{ color: 'var(--color-text-secondary)' }}
                className="text-xs"
              >
                {Math.round(progress.percentage)}%
              </span>
            )}
            {countdown > 0 && (
              <span 
                style={{ color: 'var(--color-accent-primary)' }}
                className="text-sm font-mono font-semibold"
              >
                {formatTime(countdown)}
              </span>
            )}
          </div>
        </div>
        <div 
          style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
          className="w-full h-2 rounded-full overflow-hidden"
        >
          <div 
            style={{ 
              backgroundColor: 'var(--color-accent-primary)',
              width: `${getProgressWidth()}%`
            }}
            className="h-full transition-all duration-500 ease-out"
          />
        </div>
        {progress && progress.estimatedTimeRemaining > 0 && (
          <div 
            style={{ color: 'var(--color-text-muted)' }}
            className="mt-2 text-xs text-center"
          >
            Estimated time remaining: {formatTime(Math.ceil(progress.estimatedTimeRemaining))}
          </div>
        )}
        <div 
          style={{ color: 'var(--color-text-muted)' }}
          className="mt-3 text-xs text-center"
        >
          Still working! Not frozen, just sloth-approved speed 🦥
        </div>
      </div>
    </div>
  );
};

export default ProgressDisplay;

