import React, { useState, useEffect } from "react";
import { Settings, Edit2, Save, Circle, FlaskConical, Clock, LineChart } from 'lucide-react';

function DeviceCard(props) {
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(props.name);
    const [isUpdating, setIsUpdating] = useState(false);
    const [duration, setDuration] = useState("0h 0m 0s");

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

            const response = await fetch(`/api/v1/${deviceType}/${props.deviceId}/name`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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

    const getDeviceLabel = () => {
        switch (props.deviceType) {
            case 'black-box': return 'Gas Flow meter';
            case 'chimera': return 'Gas Monitor';
            case 'chimera-max': return 'Gas Monitor'
            case 'plc': return 'PLC';
            default: return 'Unknown';
        }
    };

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-200 transition-all hover:shadow-md group ${isCompact ? 'p-4' : 'p-6'}`}>
            <div className={`flex ${isCompact ? 'flex-row items-center gap-4' : 'flex-col sm:flex-row gap-6 items-start'}`}>
                {/* Image Container */}
                <div className={`${isCompact ? 'w-16 h-16' : 'w-full sm:w-32 h-32'} bg-gray-50 rounded-lg flex items-center justify-center p-2 shrink-0`}>
                    <img
                        src={props.image}
                        alt={props.title}
                        className="max-w-full max-h-full object-contain mix-blend-multiply"
                    />
                </div>

                <div className="flex-1 w-full min-w-0">
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

                        {!isCompact && props.activeTestId && (
                            <button
                                onClick={() => props.onViewPlot && props.onViewPlot(props.activeTestId, props.deviceId)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:text-blue-600 transition-all shadow-sm shrink-0"
                            >
                                <LineChart size={16} />
                                <span>View Plot</span>
                            </button>
                        )}
                    </div>
                    <div className={`flex flex-wrap items-center gap-2 ${isCompact ? 'mt-2' : 'mt-6'}`}>
                        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${props.logging
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                            }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${props.logging ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                            {props.logging ? 'Recording' : 'Idle'}
                        </div>

                        {props.activeTestName && (
                            <>
                                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium border border-purple-100">
                                    <FlaskConical size={10} />
                                    <span className="truncate max-w-[120px]" title={props.activeTestName}>{props.activeTestName}</span>
                                </div>
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
                                Connected
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default DeviceCard;
