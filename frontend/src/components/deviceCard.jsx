import React, { useState } from "react";
import settingsCog from '../assets/cog.svg';

function DeviceCard(props){
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
                alert(`Failed to update name: ${error.error || 'Unknown error'}`);
                setEditedName(props.name);
            }
        } catch (error) {
            alert(`Failed to update name: ${error.message}`);
            setEditedName(props.name);
        } finally {
            setIsUpdating(false);
            setIsUpdating(true);
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
        <div className="bg-white rounded-lg shadow-md p-8 mb-4 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between gap-6">
                <div className="flex-1 text-left">
                    <h2 className="text-3xl font-bold text-gray-800">{props.title}</h2>
                    {isEditingName ? (
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                type="text"
                                value={editedName}
                                onChange={(e) => setEditedName(e.target.value)}
                                onKeyDown={handleKeyPress}
                                onBlur={handleNameSubmit}
                                disabled={isUpdating}
                                className="text-lg px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                autoFocus
                            />
                            {isUpdating && <span className="text-sm text-gray-500">Updating...</span>}
                        </div>
                    ) : (
                        <p 
                            className="text-lg text-gray-600 mt-2 cursor-pointer hover:text-blue-600"
                            onClick={() => setIsEditingName(true)}
                            title="Click to edit name"
                        >
                            {props.name}
                        </p>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <span className="text-base text-green-600 font-medium">● Connected</span>
                            <span className={`text-base font-medium ${props.logging ? 'text-blue-600' : 'text-gray-400'}`}>
                                {props.logging ? '📊 Logging' : '📊 Not Logging'}
                            </span>
                        </div>
                        <img 
                            src={settingsCog}
                            onClick={() => alert(`Settings for ${props.name}`)}
                            className="w-8 h-8 cursor-pointer transform transition-transform duration-200 ease-in-out hover:scale-125"
                            style={{ filter: 'invert(0.4)' }}
                            aria-label="Settings"
                            alt="Settings"
                        />
                    </div>
                </div>
                
                <img 
                    src={props.image} 
                    alt={props.title}
                    className="h-28 w-auto rounded-lg object-contain"
                />
            </div>
        </div>
    )
}


export default DeviceCard