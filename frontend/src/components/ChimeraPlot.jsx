import React, { useState, useEffect, useRef } from 'react';
import Plot from 'react-plotly.js';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0', '#a4de6c', '#ff9999', '#66b3ff', '#99ff99'];
const MAX_DATA_POINTS = 100;

// Global storage to persist connections and data across page navigations
const globalConnections = {};
const globalGasData = {};
const globalDataCounts = {};

function ChimeraPlot({ deviceId }) {
    const [plotData, setPlotData] = useState([]);
    const [activeGases, setActiveGases] = useState(new Set());
    const [dataPointCount, setDataPointCount] = useState(0);
    const updateIntervalRef = useRef(null);

    // Initialize global storage for this device if it doesn't exist
    if (!globalGasData[deviceId]) {
        globalGasData[deviceId] = {};
        globalDataCounts[deviceId] = 0;
    }

    // Update plot data from global storage
    const updatePlotFromGlobal = () => {
        const gasData = globalGasData[deviceId];
        const traces = Object.keys(gasData).map((gasName, index) => ({
            x: gasData[gasName].x,
            y: gasData[gasName].y,
            type: 'scatter',
            mode: 'lines',
            name: gasName,
            line: {
                color: COLORS[index % COLORS.length],
                width: 2
            }
        }));

        setPlotData(traces);
        setActiveGases(new Set(Object.keys(gasData)));
        setDataPointCount(globalDataCounts[deviceId]);
    };

    useEffect(() => {
        if (!deviceId) return;

        // Load existing data from global storage
        updatePlotFromGlobal();

        // Create or reuse SSE connection
        if (!globalConnections[deviceId]) {
            console.log(`[ChimeraPlot] Creating new SSE connection for device ${deviceId}`);
            const eventSource = new EventSource(`/api/v1/chimera/${deviceId}/stream`);
            globalConnections[deviceId] = eventSource;

            eventSource.addEventListener('datapoint', (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.sensor_data && Array.isArray(data.sensor_data)) {
                        const timestamp = new Date().toLocaleTimeString();

                        // Process each sensor in the datapoint
                        data.sensor_data.forEach(sensor => {
                            const gasName = sensor.gas_name || `Gas ${sensor.sensor}`;
                            const peakValue = sensor.peak_value || 0;

                            // Initialize gas data if it doesn't exist
                            if (!globalGasData[deviceId][gasName]) {
                                globalGasData[deviceId][gasName] = {
                                    x: [],
                                    y: []
                                };
                            }

                            // Add data point
                            globalGasData[deviceId][gasName].x.push(timestamp);
                            globalGasData[deviceId][gasName].y.push(peakValue);

                            // Keep only last MAX_DATA_POINTS
                            if (globalGasData[deviceId][gasName].x.length > MAX_DATA_POINTS) {
                                globalGasData[deviceId][gasName].x.shift();
                                globalGasData[deviceId][gasName].y.shift();
                            }
                        });

                        globalDataCounts[deviceId] += 1;
                    }
                } catch (error) {
                    console.error('Error processing datapoint:', error);
                }
            });

            eventSource.onerror = (error) => {
                console.error('SSE error:', error);
                if (eventSource.readyState === EventSource.CLOSED) {
                    console.log('SSE connection closed');
                    delete globalConnections[deviceId];
                }
            };
        } else {
            console.log(`[ChimeraPlot] Reusing existing SSE connection for device ${deviceId}`);
        }

        // Set up interval to update plot from global data
        updateIntervalRef.current = setInterval(() => {
            updatePlotFromGlobal();
        }, 1000); // Update every second

        // Cleanup on unmount - DON'T close the connection, just stop the interval
        return () => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
            }
        };
    }, [deviceId]);

    const getLatestValue = (gasName) => {
        const data = globalGasData[deviceId]?.[gasName];
        if (data && data.y.length > 0) {
            return data.y[data.y.length - 1];
        }
        return 0;
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
            <div className="mb-4">
                <h2 className="text-2xl font-bold">Real-Time Gas Sensor Data</h2>
            </div>

            {plotData.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                    <p className="text-lg mb-2">No data yet</p>
                    <p className="text-sm">Waiting for sensor readings from device...</p>
                    <p className="text-xs mt-2 text-gray-400">Start logging to see real-time plots</p>
                </div>
            ) : (
                <>
                    <div className="mb-4">
                        <p className="text-sm text-gray-600">
                            Tracking {activeGases.size} gas sensor{activeGases.size !== 1 ? 's' : ''} |
                            {' '}{dataPointCount} data point{dataPointCount !== 1 ? 's' : ''}
                            {globalConnections[deviceId] && (
                                <span className="ml-2 text-green-600">● Connected</span>
                            )}
                        </p>
                    </div>

                    <Plot
                        data={plotData}
                        layout={{
                            autosize: true,
                            height: 450,
                            margin: { l: 50, r: 50, t: 30, b: 50 },
                            xaxis: {
                                title: 'Time',
                                showgrid: true,
                                zeroline: false
                            },
                            yaxis: {
                                title: 'Peak Value',
                                showgrid: true,
                                zeroline: false,
                                range: [0, 100]
                            },
                            hovermode: 'closest',
                            showlegend: true,
                            legend: {
                                x: 1,
                                xanchor: 'right',
                                y: 1
                            }
                        }}
                        config={{
                            responsive: true,
                            displayModeBar: true,
                            displaylogo: false,
                            modeBarButtonsToRemove: ['lasso2d', 'select2d']
                        }}
                        style={{ width: '100%' }}
                        useResizeHandler={true}
                    />

                    {/* Gas Legend with Current Values */}
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {Array.from(activeGases).map((gasName, index) => {
                            const latestValue = getLatestValue(gasName);
                            return (
                                <div key={gasName} className="bg-gray-50 p-3 rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-4 h-4 rounded-full"
                                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                        />
                                        <span className="font-semibold text-sm">{gasName}</span>
                                    </div>
                                    <div className="mt-1 text-lg font-bold text-gray-700">
                                        {latestValue.toFixed(2)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

export default ChimeraPlot;
