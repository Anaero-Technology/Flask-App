import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

const ChimeraContext = createContext();

export const getCalibrationMessage = (stage) => {
    switch (stage) {
        case 'starting':
            return 'Flushing sensor to get zero value';
        case 'opening':
            return 'Opening sensor for gas accumulation';
        case 'info':
            return 'Accumulating gas';
        case 'reading':
            return 'Reading sensor values';
        case 'finishing':
            return 'Flushing sensor to finish';
        case 'complete':
            return 'Calibration Complete!';
        default:
            return 'Calibrating...';
    }
};

export const useChimera = () => {
    const context = useContext(ChimeraContext);
    if (!context) {
        throw new Error('useChimera must be used within a ChimeraProvider');
    }
    return context;
};

// Backwards compatibility alias
export const useCalibration = useChimera;

export const ChimeraProvider = ({ children }) => {
    const { authFetch } = useAuth();
    // Map of deviceId -> calibrationProgress
    const [calibrationStates, setCalibrationStates] = useState({});
    // Map of deviceId -> chimeraStatus (status, channel, timing info)
    const [chimeraStates, setChimeraStates] = useState({});
    // Use ref for eventSources to avoid closure issues
    const eventSourcesRef = useRef({});
    // Use ref for finishing timeouts
    const finishingTimeoutsRef = useRef({});
    // Use ref for chimera status timeout (to clear stale status)
    const chimeraTimeoutsRef = useRef({});
    // Use ref for chimera timing config
    const chimeraTimingRef = useRef({});

    // Fetch timing for a device (can be called to refresh)
    const fetchDeviceTiming = async (deviceId) => {
        try {
            const timingRes = await authFetch(`/api/v1/chimera/${deviceId}/timing`);
            if (timingRes.ok) {
                const timingData = await timingRes.json();
                if (timingData.success) {
                    const channelTimes = timingData.timing.channel_times_ms || [];
                    chimeraTimingRef.current[deviceId] = {
                        flushTimeMs: timingData.timing.flush_time_ms,
                        channelTimesMs: channelTimes
                    };
                }
            }
        } catch (err) {
            // Silently ignore - will use defaults
        }
    };

    const subscribeToDevice = async (deviceId) => {
        // Always refresh timing (even if already subscribed)
        await fetchDeviceTiming(deviceId);

        // Don't create duplicate SSE connections
        if (eventSourcesRef.current[deviceId]) {
            return;
        }

        // Check if calibration is already in progress on the backend
        try {
            const response = await authFetch(`/api/v1/chimera/${deviceId}/sensor_info`);
            if (response.ok) {
                const data = await response.json();
                if (data.is_calibrating) {
                    setCalibrationStates(prev => ({
                        ...prev,
                        [deviceId]: {
                            stage: data.is_calibrating.stage,
                            message: getCalibrationMessage(data.is_calibrating.stage),
                            time_ms: data.is_calibrating.time_ms || 0,
                            startTime: Date.now() - (Date.now() - (data.is_calibrating.timestamp * 1000))
                        }
                    }));
                }
            }
        } catch (err) {
            // Silently ignore - calibration check is optional
        }

        const eventSource = new EventSource(`/api/v1/chimera/${deviceId}/stream`);

        eventSource.addEventListener('calibration_progress', (event) => {
            const data = JSON.parse(event.data);

            setCalibrationStates(prev => ({
                ...prev,
                [deviceId]: {
                    stage: data.stage,
                    message: getCalibrationMessage(data.stage),
                    time_ms: data.time_ms,
                    startTime: Date.now()
                }
            }));

            // If this is the finishing stage, set a timeout to auto-complete
            // This handles cases where "done calibrate" message isn't received
            if (data.stage === 'finishing') {
                // Clear any existing timeout
                if (finishingTimeoutsRef.current[deviceId]) {
                    clearTimeout(finishingTimeoutsRef.current[deviceId]);
                }
                // Set timeout for finishing duration + 2 second buffer
                const timeoutMs = (data.time_ms || 3000) + 2000;
                finishingTimeoutsRef.current[deviceId] = setTimeout(() => {
                    setCalibrationStates(prev => ({
                        ...prev,
                        [deviceId]: {
                            stage: 'complete',
                            message: getCalibrationMessage('complete'),
                            time_ms: 0,
                            startTime: Date.now()
                        }
                    }));
                    setTimeout(() => {
                        setCalibrationStates(prev => {
                            const newState = { ...prev };
                            delete newState[deviceId];
                            return newState;
                        });
                    }, 2000);
                }, timeoutMs);
            } else {
                // Clear timeout if we get a different stage (calibration might have restarted)
                if (finishingTimeoutsRef.current[deviceId]) {
                    clearTimeout(finishingTimeoutsRef.current[deviceId]);
                    delete finishingTimeoutsRef.current[deviceId];
                }
            }
        });

        // Listen for chimera_status events (flushing/reading status)
        eventSource.addEventListener('chimera_status', (event) => {
            try {
                const data = JSON.parse(event.data);

                // Only process events for this device (compare as numbers to avoid type mismatch)
                if (data.device_id !== undefined && Number(data.device_id) !== Number(deviceId)) {
                    return;
                }

                const now = Date.now();
                const timing = chimeraTimingRef.current[deviceId] || {};

                // Determine duration based on status
                let phaseDuration = 30000; // default 30s
                if (data.status === 'flushing') {
                    phaseDuration = timing.flushTimeMs || 30000;
                } else if (data.status === 'reading') {
                    // Use per-channel timing from channelTimesMs array (0-indexed, channel is 1-15)
                    const channelIndex = (data.channel || 1) - 1;
                    const channelTimesMs = timing.channelTimesMs || [];
                    phaseDuration = channelTimesMs[channelIndex] || 600000;
                }

                setChimeraStates(prev => ({
                    ...prev,
                    [deviceId]: {
                        status: data.status,
                        channel: data.channel,
                        phaseStartTime: now,
                        phaseDuration: phaseDuration
                    }
                }));

                // Clear status after timeout (in case we miss close events)
                if (chimeraTimeoutsRef.current[deviceId]) {
                    clearTimeout(chimeraTimeoutsRef.current[deviceId]);
                }
                chimeraTimeoutsRef.current[deviceId] = setTimeout(() => {
                    setChimeraStates(prev => {
                        const newState = { ...prev };
                        delete newState[deviceId];
                        return newState;
                    });
                }, phaseDuration + 5000); // Clear after phase + 5s buffer

            } catch (e) {
                console.error('[ChimeraContext] Error parsing chimera_status:', e);
            }
        });

        // Listen for done calibrate to clear progress
        eventSource.addEventListener('message', (event) => {
            let isDone = false;
            try {
                const data = JSON.parse(event.data);
                if (data.message && data.message.includes('done calibrate')) {
                    isDone = true;
                }
            } catch {
                // Not JSON, check raw data
                if (event.data && event.data.includes('done calibrate')) {
                    isDone = true;
                }
            }

            if (isDone) {
                // First show "Done!" message
                setCalibrationStates(prev => ({
                    ...prev,
                    [deviceId]: {
                        stage: 'complete',
                        message: getCalibrationMessage('complete'),
                        time_ms: 0,
                        startTime: Date.now()
                    }
                }));
                // Then clear after 2 seconds
                setTimeout(() => {
                    setCalibrationStates(prev => {
                        const newState = { ...prev };
                        delete newState[deviceId];
                        return newState;
                    });
                }, 2000);
            }
        });

        eventSource.onerror = () => {
            // Don't close on error - SSE will auto-reconnect
        };

        eventSourcesRef.current[deviceId] = eventSource;
    };

    const unsubscribeFromDevice = (deviceId) => {
        if (eventSourcesRef.current[deviceId]) {
            eventSourcesRef.current[deviceId].close();
            delete eventSourcesRef.current[deviceId];
        }
    };

    const clearCalibrationProgress = (deviceId) => {
        setCalibrationStates(prev => {
            const newState = { ...prev };
            delete newState[deviceId];
            return newState;
        });
    };

    // Cleanup all connections on unmount
    useEffect(() => {
        return () => {
            Object.values(eventSourcesRef.current).forEach(es => es.close());
            eventSourcesRef.current = {};
        };
    }, []);

    return (
        <ChimeraContext.Provider value={{
            subscribeToDevice,
            unsubscribeFromDevice,
            clearCalibrationProgress,
            calibrationStates,
            chimeraStates
        }}>
            {children}
        </ChimeraContext.Provider>
    );
};

// Backwards compatibility alias
export const CalibrationProvider = ChimeraProvider;

export default ChimeraContext;
