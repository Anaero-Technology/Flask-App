import React, { useState, useEffect, useRef } from "react";
import { Settings, Edit2, Save, Circle, Clock, LineChart, Wind, Activity, MoreVertical, FolderOpen, FlaskConical, Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CalibrationProgressBar from './CalibrationProgressBar';
import ChimeraConfigTooltip from './ChimeraConfigTooltip';
import BlackBoxConfigTooltip from './BlackBoxConfigTooltip';
import { useCalibration } from './ChimeraContext';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';

function DeviceCard(props) {
    const { authFetch } = useAuth();
    const { t: tPages } = useTranslation('pages');
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(props.name);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [calibrationSensor, setCalibrationSensor] = useState("");
    const [calibrationGasPct, setCalibrationGasPct] = useState("");
    const [availableSensors, setAvailableSensors] = useState([]);
    const [borderProgress, setBorderProgress] = useState(0);
    const [duration, setDuration] = useState("0h 0m 0s");
    const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
    const actionsMenuRef = useRef(null);

    // Use global calibration context for persistent state across page navigation
    const { subscribeToDevice, calibrationStates, chimeraStates } = useCalibration();
    const calibrationProgress = calibrationStates[props.deviceId] || null;
    const chimeraStatus = chimeraStates?.[props.deviceId] || null;

    // Animate border progress based on chimera status timing
    useEffect(() => {
        if (!props.logging || !chimeraStatus) {
            setBorderProgress(0);
            return;
        }

        const { phaseStartTime, phaseDuration } = chimeraStatus;
        if (!phaseStartTime || !phaseDuration) return;

        let interval = null;

        const updateProgress = () => {
            const elapsed = Date.now() - phaseStartTime;
            const progress = Math.min((elapsed / phaseDuration) * 100, 100);
            setBorderProgress(progress);

            // Stop animation when complete
            if (progress >= 100 && interval) {
                clearInterval(interval);
                interval = null;
            }
        };

        updateProgress();
        interval = setInterval(updateProgress, 16); // ~60fps for smooth animation
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [props.logging, chimeraStatus]);

    useEffect(() => {
        // Always fetch sensor info on mount to check for active calibration
        if (props.deviceType.startsWith('chimera')) {
            // Subscribe to SSE via global context (handles calibration progress)
            subscribeToDevice(props.deviceId);

            authFetch(`/api/v1/chimera/${props.deviceId}/sensor_info`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        // 1. Check active calibration - set UI to calibrating mode if active
                        if (data.is_calibrating) {
                            setIsCalibrating(true);
                        }

                        // 2. Process sensors and history
                        if (data.sensor_types) {
                            const sensorsArray = Object.entries(data.sensor_types).map(([num, name]) => {
                                const lastCalStart = data.calibration_history ? data.calibration_history[num] : null;
                                let lastCalStr = "";
                                if (lastCalStart) {
                                    const date = new Date(lastCalStart);
                                    // Simple format: "Dec 10, 14:30" or similar
                                    lastCalStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                }

                                return {
                                    sensor_number: parseInt(num),
                                    gas_name: name,
                                    last_calibrated: lastCalStr
                                };
                            });
                            setAvailableSensors(sensorsArray);

                            // Only set default if not already set
                            if (!calibrationSensor && sensorsArray.length > 0) {
                                setCalibrationSensor(sensorsArray[0].sensor_number);
                            }
                        }
                    }
                })
                .catch(err => console.error("Failed to fetch sensor info", err));
        }
    }, [props.deviceId, props.deviceType, subscribeToDevice]);

    // Track if calibration was ever in progress (to detect completion)
    const [hadCalibrationProgress, setHadCalibrationProgress] = useState(false);

    // Compute calibration instruction message based on device model and progress stage
    const getCalibrationMessage = () => {
        if (!calibrationProgress || calibrationProgress.stage !== 'opening') return '';

        const calibrationMode = props.globalDeviceModel === 'chimera-max' ? 'pump' : 'manual';

        if (calibrationMode === 'manual') {
            return 'Opening sensor for gas accumulation: Please push gas into channel 1';
        } else if (calibrationMode === 'pump') {
            return 'Auto pumping gas into channel 1';
        }
        return '';
    };

    // Update isCalibrating based on context state
    useEffect(() => {
        if (calibrationProgress) {
            setIsCalibrating(true);
            setHadCalibrationProgress(true);
        }
    }, [calibrationProgress]);

    // Handle calibration completion - only when progress goes from having a value to null
    useEffect(() => {
        if (!calibrationProgress && hadCalibrationProgress) {
            // Calibration just completed, refresh sensor info
            setIsCalibrating(false);
            setHadCalibrationProgress(false);
            if (props.deviceType.startsWith('chimera')) {
                authFetch(`/api/v1/chimera/${props.deviceId}/sensor_info`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success && data.sensor_types) {
                            const sensorsArray = Object.entries(data.sensor_types).map(([num, name]) => {
                                const lastCalStart = data.calibration_history ? data.calibration_history[num] : null;
                                let lastCalStr = "";
                                if (lastCalStart) {
                                    const date = new Date(lastCalStart);
                                    lastCalStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                }
                                return {
                                    sensor_number: parseInt(num),
                                    gas_name: name,
                                    last_calibrated: lastCalStr
                                };
                            });
                            setAvailableSensors(sensorsArray);
                        }
                    });
            }
        }
    }, [calibrationProgress, hadCalibrationProgress, props.deviceId, props.deviceType]);


    useEffect(() => {
        if (!props.testStartTime) return;

        const calculateDuration = () => {
            const start = new Date(props.testStartTime).getTime();
            const now = new Date().getTime();
            const seconds = Math.floor((now - start) / 1000);

            if (seconds < 0) return "0h 0m 0s";
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return `${h}h ${m}m ${s}s`;
        };

        setDuration(calculateDuration());
        const interval = setInterval(() => {
            setDuration(calculateDuration());
        }, 1000);

        return () => clearInterval(interval);
    }, [props.testStartTime]);

    const handleCalibrationStart = () => {
        if (!calibrationSensor || !calibrationGasPct) return;

        const sensor = availableSensors.find(s => s.sensor_number === parseInt(calibrationSensor));
        const gasName = sensor ? sensor.gas_name : `Sensor ${calibrationSensor}`;

        if (window.confirm(`Are you sure you want to start calibration for ${gasName}?`)) {
            if (props.onCalibrateAction) {
                props.onCalibrateAction(props.deviceId, calibrationSensor, calibrationGasPct);
                // Don't close setIsCalibrating(false) yet - wait for progress
                setCalibrationGasPct("");
            }
        }
    };

    const handleNameSubmit = async () => {
        if (editedName === props.name) {
            setIsEditingName(false);
            return;
        }

        setIsUpdating(true);
        try {
            let deviceType = 'chimera';
            if (props.deviceType === 'black-box') deviceType = 'black_box';
            else if (props.deviceType === 'plc') deviceType = 'plc';

            const response = await authFetch(`/api/v1/${deviceType}/${props.deviceId}/name`, {
                method: 'POST',
                body: JSON.stringify({ name: editedName })
            });

            if (response.ok) {
                if (props.onNameUpdate) {
                    props.onNameUpdate(props.deviceId, editedName);
                }
                setIsEditingName(false);
            } else {
                const error = await response.json();
                console.error(`Failed to update name: ${error.error || 'Unknown error'}`);
                setEditedName(props.name);
            }
        } catch (error) {
            console.error(`Failed to update name: ${error.message}`);
            setEditedName(props.name);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleNameSubmit();
        } else if (e.key === 'Escape') {
            setEditedName(props.name);
            setIsEditingName(false);
        }
    };

    const isCompact = props.compact;
    const supportsCalibration = props.deviceType === 'chimera' || props.deviceType === 'chimera-max';
    const supportsFiles = ['black-box', 'chimera', 'chimera-max'].includes(props.deviceType);
    const supportsTestControl = ['black-box', 'chimera', 'chimera-max'].includes(props.deviceType);
    const showDashboardActionsMenu = Boolean(props.showDashboardActions) && !isCompact;
    const actionsDisabled = Boolean(props.actionsDisabled);
    const getMenuItemClass = (disabled) => (
        `w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${disabled
            ? 'text-gray-400 bg-gray-50/70 cursor-not-allowed'
            : 'text-gray-700 hover:bg-gray-50'}`
    );

    useEffect(() => {
        if (!isActionsMenuOpen) return;
        const handleOutsideClick = (event) => {
            if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target)) {
                setIsActionsMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isActionsMenuOpen]);

    const getDeviceLabel = () => {
        switch (props.deviceType) {
            case 'black-box': return tPages('device_status.gas_flow_meter');
            case 'chimera': return tPages('device_status.gas_monitor');
            case 'chimera-max': return tPages('device_status.gas_monitor');
            case 'plc': return tPages('device_status.plc');
            default: return 'Unknown';
        }
    };

    // Show animated border when chimera is actively logging with status
    const showStatusBorder = props.logging && chimeraStatus;
    const isFlushing = chimeraStatus?.status === 'flushing';

    // Calculate border gradient based on progress (fills clockwise from top)
    // Green for reading, orange for flushing
    const activeColor = isFlushing ? '#f97316' : '#22c55e'; // orange-500 or green-500
    const baseBorderColor = isDark ? '#1f2937' : '#e5e7eb';
    const borderRadius = 12;
    const borderWidth = 3;

    return (
        <div className="relative">
            {/* Animated border overlay */}
            {showStatusBorder && (
                <svg
                    className="absolute inset-0 w-full h-full pointer-events-none z-10"
                    style={{ overflow: 'visible' }}
                    aria-hidden="true"
                >
                    <rect
                        x={0}
                        y={0}
                        width="100%"
                        height="100%"
                        rx={borderRadius}
                        ry={borderRadius}
                        fill="none"
                        stroke={baseBorderColor}
                        strokeWidth={borderWidth}
                    />
                    <rect
                        x={0}
                        y={0}
                        width="100%"
                        height="100%"
                        rx={borderRadius}
                        ry={borderRadius}
                        fill="none"
                        stroke={activeColor}
                        strokeWidth={borderWidth}
                        strokeLinecap="round"
                        pathLength="100"
                        strokeDasharray={`${borderProgress} 100`}
                    />
                </svg>
            )}
            <div
                className={`relative bg-white rounded-xl shadow-sm border transition-all hover:shadow-md group ${isCompact ? 'p-4' : 'p-6'} ${showStatusBorder ? 'border-transparent' : 'border-gray-200'}`}
            >
                <div className={`flex ${isCompact ? 'flex-row items-center gap-4' : 'flex-col sm:flex-row gap-6 items-start'}`}>
                {/* Image Container */}
                <div className={`${isCompact ? 'w-16 h-16' : 'w-full sm:w-32 h-32'} bg-gray-50 rounded-lg flex items-center justify-center p-2 shrink-0 device-card-image-wrap`}>
                    <img
                        src={props.image}
                        alt={props.title}
                        className="max-w-full max-h-full object-contain mix-blend-multiply device-card-image"
                    />
                </div>

                <div className="flex-1 w-full min-w-0 relative">
                    <div className="flex justify-between items-start">
                        <div className="min-w-0">
                            <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-0.5 truncate">
                                {getDeviceLabel()}
                            </h3>

                            {isEditingName ? (
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="text"
                                        value={editedName}
                                        onChange={(e) => setEditedName(e.target.value)}
                                        onBlur={handleNameSubmit}
                                        onKeyDown={handleKeyPress}
                                        disabled={isUpdating}
                                        className={`${isCompact ? 'text-lg' : 'text-2xl'} font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none px-1 w-full`}
                                        autoFocus
                                    />
                                    <button onMouseDown={handleNameSubmit} className="text-green-600 shrink-0">
                                        <Save size={16} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 group/edit">
                                    <h2 className={`${isCompact ? 'text-lg' : 'text-2xl'} font-bold text-gray-900 truncate`} title={props.name}>{props.name}</h2>
                                    <button
                                        onClick={() => setIsEditingName(true)}
                                        className="opacity-0 group-hover/edit:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity shrink-0"
                                    >
                                        <Edit2 size={14} />
                                    </button>
                                </div>
                            )}
                            <p className="text-xs text-gray-500 font-mono mt-0.5 truncate">{props.port}</p>
                        </div>

                        {showDashboardActionsMenu && (
                            <div className="relative shrink-0" ref={actionsMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsActionsMenuOpen(prev => !prev)}
                                    className="flex items-center justify-center w-9 h-9 text-gray-500 hover:text-gray-700 transition-colors"
                                    aria-label={tPages('device_card.actions')}
                                >
                                    <MoreVertical size={16} />
                                </button>

                                {isActionsMenuOpen && (
                                    <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1">
                                        {supportsTestControl && !props.activeTestId && props.onStartTest && (
                                            <button
                                                type="button"
                                                disabled={actionsDisabled}
                                                onClick={() => {
                                                    if (actionsDisabled) return;
                                                    props.onStartTest(props.deviceId, props.deviceType);
                                                    setIsActionsMenuOpen(false);
                                                }}
                                                className={getMenuItemClass(actionsDisabled)}
                                            >
                                                <Play size={14} />
                                                <span>Start Test</span>
                                            </button>
                                        )}

                                        {supportsTestControl && props.activeTestId && props.onStopTest && (
                                            <button
                                                type="button"
                                                disabled={actionsDisabled}
                                                onClick={() => {
                                                    if (actionsDisabled) return;
                                                    props.onStopTest(props.activeTestId);
                                                    setIsActionsMenuOpen(false);
                                                }}
                                                className={getMenuItemClass(actionsDisabled)}
                                            >
                                                <Square size={14} />
                                                <span>Stop Test</span>
                                            </button>
                                        )}

                                        {supportsCalibration && !props.activeTestId && props.onCalibrateAction && (
                                            <button
                                                type="button"
                                                disabled={actionsDisabled}
                                                onClick={() => {
                                                    if (actionsDisabled) return;
                                                    setIsCalibrating(true);
                                                    setIsActionsMenuOpen(false);
                                                }}
                                                className={getMenuItemClass(actionsDisabled)}
                                            >
                                                <Settings size={14} />
                                                <span>{tPages('device_card.calibrate')}</span>
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            disabled={actionsDisabled || !props.activeTestId || !props.onViewPlot}
                                            onClick={() => {
                                                if (actionsDisabled) return;
                                                if (props.activeTestId && props.onViewPlot) {
                                                    props.onViewPlot(props.activeTestId, props.deviceId);
                                                }
                                                setIsActionsMenuOpen(false);
                                            }}
                                            className={getMenuItemClass(actionsDisabled || !props.activeTestId || !props.onViewPlot)}
                                        >
                                            <LineChart size={14} />
                                            <span>{tPages('device_card.view_plot')}</span>
                                        </button>

                                        <button
                                            type="button"
                                            disabled={actionsDisabled || !props.activeTestId || !props.onViewTest}
                                            onClick={() => {
                                                if (actionsDisabled) return;
                                                if (props.activeTestId && props.onViewTest) {
                                                    props.onViewTest(props.activeTestId, props.deviceId);
                                                }
                                                setIsActionsMenuOpen(false);
                                            }}
                                            className={getMenuItemClass(actionsDisabled || !props.activeTestId || !props.onViewTest)}
                                        >
                                            <FlaskConical size={14} />
                                            <span>{tPages('device_card.view_test')}</span>
                                        </button>

                                        {supportsFiles && props.onViewFiles && (
                                            <button
                                                type="button"
                                                disabled={actionsDisabled}
                                                onClick={() => {
                                                    if (actionsDisabled) return;
                                                    props.onViewFiles(props.deviceId, props.deviceType);
                                                    setIsActionsMenuOpen(false);
                                                }}
                                                className={getMenuItemClass(actionsDisabled)}
                                            >
                                                <FolderOpen size={14} />
                                                <span>{tPages('device_card.view_files')}</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {!showDashboardActionsMenu && !isCompact && props.activeTestId && (
                            <button
                                onClick={() => props.onViewPlot && props.onViewPlot(props.activeTestId, props.deviceId)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:text-blue-600 transition-all shadow-sm shrink-0"
                            >
                                <LineChart size={16} />
                                <span>{tPages('device_card.view_plot')}</span>
                            </button>
                        )}

                        {!isCompact && !props.activeTestId && supportsCalibration && props.onCalibrateAction && (
                            isCalibrating ? (
                                <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-right-2 duration-200">
                                    {calibrationProgress ? (
                                        <div className="w-88">
                                            <CalibrationProgressBar progress={calibrationProgress} instructionMessage={getCalibrationMessage()} />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <select
                                                className="text-sm border-gray-300 rounded-lg focus:ring-orange-500 focus:border-orange-500 py-1 pl-2 pr-8"
                                                value={calibrationSensor}
                                                onChange={(e) => setCalibrationSensor(e.target.value)}
                                            >
                                                {availableSensors.length > 0 ? (
                                                    availableSensors.map(s => (
                                                        <option key={s.sensor_number} value={s.sensor_number}>
                                                            {s.gas_name || `Sensor ${s.sensor_number}`}
                                                        </option>
                                                    ))
                                                ) : (
                                                    [1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                                                        <option key={n} value={n}>Sensor {n}</option>
                                                    ))
                                                )}
                                            </select>

                                            <div className="flex items-center gap-1 bg-gray-50 rounded-lg border border-gray-200 px-2 py-1">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="w-12 text-sm bg-transparent border-none focus:ring-0 p-0 text-right"
                                                    value={calibrationGasPct}
                                                    onChange={(e) => setCalibrationGasPct(e.target.value)}
                                                />
                                                <span className="text-sm text-gray-500">
                                                    {(() => {
                                                        const sensor = availableSensors.find(s => s.sensor_number === parseInt(calibrationSensor));
                                                        const gasName = sensor?.gas_name?.toUpperCase() || '';
                                                        return ['H2S', 'H2', 'CO', 'NH3'].includes(gasName) ? 'ppm' : '%';
                                                    })()}
                                                </span>
                                            </div>

                                            <div className="flex gap-1">
                                                <button
                                                    onClick={handleCalibrationStart}
                                                    disabled={!calibrationSensor || !calibrationGasPct}
                                                    className="px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 text-sm font-medium transition-colors shadow-sm"
                                                >
                                                    {tPages('device_card.start')}
                                                </button>
                                                <button
                                                    onClick={() => setIsCalibrating(false)}
                                                    className="px-3 py-1 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors shadow-sm"
                                                >
                                                    {tPages('device_card.cancel')}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                !showDashboardActionsMenu && (
                                <button
                                    onClick={() => setIsCalibrating(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:text-orange-600 transition-all shadow-sm shrink-0"
                                >
                                    <Settings size={16} />
                                    <span>{tPages('device_card.calibrate')}</span>
                                </button>
                                )
                            )
                        )}
                    </div>


                    <div className={`flex flex-wrap items-center gap-2 ${isCompact ? 'mt-2' : 'mt-6'}`}>
                        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${props.logging
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                            }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${props.logging ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                            {props.logging ? tPages('device_status.recording') : tPages('device_status.idle')}
                        </div>

                        {/* Chimera status indicator (flushing/reading + channel) */}
                        {props.logging && chimeraStatus && (
                            <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                isFlushing
                                    ? 'bg-orange-50 text-orange-700 border-orange-100'
                                    : 'bg-green-50 text-green-700 border-green-100'
                            }`}>
                                {isFlushing ? (
                                    <>
                                        <Wind size={10} />
                                        <span>{tPages('device_status.flushing')}</span>
                                    </>
                                ) : (
                                    <>
                                        <Activity size={10} />
                                        <span>{tPages('device_status.channel')} {chimeraStatus.channel}</span>
                                    </>
                                )}
                            </div>
                        )}

                        {props.activeTestName && (
                            <>
                                {(props.deviceType === 'chimera' || props.deviceType === 'chimera-max') ? (
                                    <ChimeraConfigTooltip
                                        testId={props.activeTestId}
                                        activeTestName={props.activeTestName}
                                        currentChannel={chimeraStatus?.channel}
                                        isFlushing={isFlushing}
                                        deviceName={props.name}
                                    />
                                ) : props.deviceType === 'black-box' ? (
                                    <BlackBoxConfigTooltip
                                        testId={props.activeTestId}
                                        deviceId={props.deviceId}
                                        activeTestName={props.activeTestName}
                                    />
                                ) : null}
                                {props.testStartTime && (
                                    <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium border border-blue-100">
                                        <Clock size={10} />
                                        <span className="font-mono">{duration}</span>
                                    </div>
                                )}
                            </>
                        )}

                        {!isCompact && (
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                                <Circle size={6} fill="currentColor" />
                                {tPages('device_status.connected')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </div>
        </div>
    )
}

export default DeviceCard;
