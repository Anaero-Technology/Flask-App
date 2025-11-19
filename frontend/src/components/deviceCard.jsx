import React, { useState } from "react";
import { Settings, Edit2, Save, Circle } from 'lucide-react';

function DeviceCard(props) {
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(props.name);
    const [isUpdating, setIsUpdating] = useState(false);

    const handleNameSubmit = async () => {
        if (editedName === props.name) {
            setIsEditingName(false);
            return;
        }

        setIsUpdating(true);
        try {
            const deviceType = props.deviceType === 'black-box' ? 'black_box' : 'chimera';
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

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 transition-all hover:shadow-md group">
            <div className="flex flex-col sm:flex-row gap-6 items-start">
                {/* Image Container */}
                <div className="w-full sm:w-32 h-32 bg-gray-50 rounded-lg flex items-center justify-center p-2 shrink-0">
                    <img
                        src={props.image}
                        alt={props.title}
                        className="max-w-full max-h-full object-contain mix-blend-multiply"
                    />
                </div>

                <div className="flex-1 w-full">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-1">
                                {props.deviceType === 'black-box' ? 'Volumetric' : 'Gas Analysis'}
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
                                        className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none px-1"
                                        autoFocus
                                    />
                                    <button onMouseDown={handleNameSubmit} className="text-green-600">
                                        <Save size={18} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 group/edit">
                                    <h2 className="text-2xl font-bold text-gray-900">{props.name}</h2>
                                    <button
                                        onClick={() => setIsEditingName(true)}
                                        className="opacity-0 group-hover/edit:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </div>
                            )}
                            <p className="text-sm text-gray-500 font-mono mt-1">{props.port}</p>
                        </div>

                        <button className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                            <Settings size={20} />
                        </button>
                    </div>

                    <div className="mt-6 flex items-center gap-3">
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                            props.logging
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                        }`}>
                            <div className={`w-2 h-2 rounded-full ${props.logging ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                            {props.logging ? 'Recording Data' : 'Idle'}
                        </div>

                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
                            <Circle size={8} fill="currentColor" />
                            Connected
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default DeviceCard;
