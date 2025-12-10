import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle } from 'lucide-react';

// Calibration Progress Bar Component
function CalibrationProgressBar({ progress }) {
    const [currentProgress, setCurrentProgress] = useState(0);

    const isComplete = progress.stage === 'complete';

    useEffect(() => {
        // For complete stage, show 100%
        if (isComplete) {
            setCurrentProgress(100);
            return;
        }

        // Reset progress when stage changes
        setCurrentProgress(0);

        if (progress.time_ms > 0) {
            const startTime = progress.startTime;
            const duration = progress.time_ms;

            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const progressPercent = Math.min((elapsed / duration) * 100, 100);
                setCurrentProgress(progressPercent);

                if (progressPercent >= 100) {
                    clearInterval(interval);
                }
            }, 50); // Update every 50ms for smooth animation

            return () => clearInterval(interval);
        }
    }, [progress.stage, progress.time_ms, progress.startTime, isComplete]);

    // Show green completion state
    if (isComplete) {
        return (
            <div className="bg-green-50 p-4 rounded-lg border border-green-200 w-full animate-in fade-in duration-300">
                <div className="flex items-center justify-center gap-2">
                    <CheckCircle size={20} className="text-green-600" />
                    <span className="text-sm font-medium text-green-800">{progress.message}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 w-full animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-orange-800 flex items-center gap-2">
                    <Activity size={16} className="animate-pulse" />
                    {progress.message}
                </div>
                <div className="text-xs font-bold text-orange-600">
                    {currentProgress.toFixed(0)}%
                </div>
            </div>
            <div className="w-full bg-orange-200 rounded-full h-2 overflow-hidden">
                <div
                    className="bg-orange-500 h-2 rounded-full transition-all duration-100 ease-out"
                    style={{ width: `${currentProgress}%` }}
                />
            </div>
            <div className="text-xs text-orange-600 mt-2 font-mono">
                Stage: {progress.stage}
            </div>
        </div>
    );
}

export default CalibrationProgressBar;
