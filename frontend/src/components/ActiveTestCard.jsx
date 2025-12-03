import React, { useState, useEffect } from 'react';
import { Clock, Activity, Server } from 'lucide-react';
import DeviceCard from './deviceCard';

const ActiveTestCard = ({ test, onNameUpdate }) => {
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const calculateDuration = () => {
            if (!test.date_started) return 0;
            const start = new Date(test.date_started).getTime();
            const now = new Date().getTime();
            return Math.floor((now - start) / 1000);
        };

        setDuration(calculateDuration());

        const interval = setInterval(() => {
            setDuration(calculateDuration());
        }, 1000);

        return () => clearInterval(interval);
    }, [test.date_started]);

    // Format duration
    const formatDuration = (seconds) => {
        if (seconds < 0) return "0h 0m 0s";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h}h ${m}m ${s}s`;
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden mb-6">
            {/* Header */}
            <div className="bg-blue-50/50 border-b border-blue-100 p-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                        <Activity size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">{test.name}</h3>
                        <p className="text-xs text-gray-500">{test.description || "Active Experiment"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
                        <Clock size={14} className="text-blue-500" />
                        <span className="font-mono">{formatDuration(duration)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
                        <Server size={14} className="text-purple-500" />
                        <span>{(test.devices || []).length} Devices</span>
                    </div>
                </div>
            </div>

            {/* Devices Grid */}
            <div className="p-6 bg-gray-50/30">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Assigned Devices</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(test.devices || []).map((device) => (
                        <DeviceCard
                            key={device.id}
                            deviceId={device.id}
                            deviceType={device.device_type}
                            title={device.device_type === "black-box" ? "Gas-flow meter" : "Chimera"}
                            name={device.name}
                            logging={device.logging}
                            port={device.serial_port}
                            activeTestName={test.name} // Pass test name to device card
                            compact={true}
                            onNameUpdate={onNameUpdate}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ActiveTestCard;
