import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const CalibrationContext = createContext();

export const useCalibration = () => {
    const context = useContext(CalibrationContext);
    if (!context) {
        throw new Error('useCalibration must be used within a CalibrationProvider');
    }
    return context;
};

export const CalibrationProvider = ({ children }) => {
    // Map of deviceId -> calibrationProgress
    const [calibrationStates, setCalibrationStates] = useState({});
    // Use ref for eventSources to avoid closure issues
    const eventSourcesRef = useRef({});
    // Use ref for finishing timeouts
    const finishingTimeoutsRef = useRef({});

    const subscribeToDevice = async (deviceId) => {
        // First, check if calibration is already in progress on the backend
        try {
            const response = await fetch(`/api/v1/chimera/${deviceId}/sensor_info`);
            if (response.ok) {
                const data = await response.json();
                if (data.is_calibrating) {
                    console.log(`[CalibrationContext] Calibration already in progress for device ${deviceId}:`, data.is_calibrating);
                    // Map stage to message
                    let message = '';
                    switch (data.is_calibrating.stage) {
                        case 'starting':
                            message = 'Flushing sensor to get zero value';
                            break;
                        case 'opening':
                            message = 'Opening sensor - Please push gas in';
                            break;
                        case 'info':
                            message = 'Accumulating gas';
                            break;
                        case 'reading':
                            message = 'Reading sensor values';
                            break;
                        case 'finishing':
                            message = 'Flushing sensor to finish';
                            break;
                        default:
                            message = 'Calibrating...';
                    }
                    setCalibrationStates(prev => ({
                        ...prev,
                        [deviceId]: {
                            stage: data.is_calibrating.stage,
                            message: message,
                            time_ms: data.is_calibrating.time_ms || 0,
                            startTime: Date.now() - (Date.now() - (data.is_calibrating.timestamp * 1000))
                        }
                    }));
                }
            }
        } catch (err) {
            console.log(`[CalibrationContext] Could not fetch initial calibration state:`, err);
        }

        // Don't create duplicate connections
        if (eventSourcesRef.current[deviceId]) {
            console.log(`[CalibrationContext] Already subscribed to device ${deviceId}`);
            return;
        }

        console.log(`[CalibrationContext] Subscribing to device ${deviceId}`);
        const eventSource = new EventSource(`/api/v1/chimera/${deviceId}/stream`);

        eventSource.addEventListener('calibration_progress', (event) => {
            console.log(`[CalibrationContext] Received calibration_progress for device ${deviceId}:`, event.data);
            const data = JSON.parse(event.data);

            // Map stage to message
            let message = '';
            switch (data.stage) {
                case 'starting':
                    message = 'Flushing sensor to get zero value';
                    break;
                case 'opening':
                    message = 'Opening sensor for gas accumulation';
                    break;
                case 'info':
                    message = 'Accumulating gas';
                    break;
                case 'reading':
                    message = 'Reading sensor values';
                    break;
                case 'finishing':
                    message = 'Flushing sensor to finish';
                    break;
                default:
                    message = 'Calibrating...';
            }

            setCalibrationStates(prev => ({
                ...prev,
                [deviceId]: {
                    stage: data.stage,
                    message: message,
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
                console.log(`[CalibrationContext] Setting auto-complete timeout for ${timeoutMs}ms`);
                finishingTimeoutsRef.current[deviceId] = setTimeout(() => {
                    console.log(`[CalibrationContext] Auto-completing calibration for device ${deviceId}`);
                    setCalibrationStates(prev => ({
                        ...prev,
                        [deviceId]: {
                            stage: 'complete',
                            message: 'Calibration Complete!',
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

        // Listen for done calibrate to clear progress
        eventSource.addEventListener('message', (event) => {
            console.log(`[CalibrationContext] Received message for device ${deviceId}:`, event.data);
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
                console.log(`[CalibrationContext] Calibration done for device ${deviceId}, showing completion`);
                // First show "Done!" message
                setCalibrationStates(prev => ({
                    ...prev,
                    [deviceId]: {
                        stage: 'complete',
                        message: 'Calibration Complete!',
                        time_ms: 0,
                        startTime: Date.now()
                    }
                }));
                // Then clear after 2 seconds
                setTimeout(() => {
                    console.log(`[CalibrationContext] Clearing calibration state for device ${deviceId}`);
                    setCalibrationStates(prev => {
                        const newState = { ...prev };
                        delete newState[deviceId];
                        return newState;
                    });
                }, 2000);
            }
        });

        // Also listen for generic SSE messages (some backends send without event type)
        eventSource.onmessage = (event) => {
            console.log(`[CalibrationContext] Received onmessage for device ${deviceId}:`, event.data);
            let isDone = false;
            try {
                const data = JSON.parse(event.data);
                if (data.message && data.message.includes('done calibrate')) {
                    isDone = true;
                }
            } catch {
                if (event.data && event.data.includes('done calibrate')) {
                    isDone = true;
                }
            }

            if (isDone) {
                console.log(`[CalibrationContext] Calibration done (onmessage) for device ${deviceId}`);
                setCalibrationStates(prev => ({
                    ...prev,
                    [deviceId]: {
                        stage: 'complete',
                        message: 'Calibration Complete!',
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
            }
        };

        eventSource.onerror = (err) => {
            console.log(`[CalibrationContext] EventSource error for device ${deviceId}:`, err);
            // Don't close on error - SSE will auto-reconnect
        };

        eventSource.onopen = () => {
            console.log(`[CalibrationContext] EventSource connected for device ${deviceId}`);
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
        <CalibrationContext.Provider value={{
            subscribeToDevice,
            unsubscribeFromDevice,
            clearCalibrationProgress,
            calibrationStates
        }}>
            {children}
        </CalibrationContext.Provider>
    );
};

export default CalibrationContext;
