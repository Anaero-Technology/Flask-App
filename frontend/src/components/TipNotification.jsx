import React, { useState, useEffect } from 'react';

const TipNotification = ({ deviceId }) => {
  const [notifications, setNotifications] = useState([]);
  const [hasMessages, setHasMessages] = useState(false);

  useEffect(() => {

    if (!deviceId) return;
    
    // Create SSE connection for specific device
    const eventSource = new EventSource(`api/v1/black_box/${deviceId}/stream`);

    // Listen for the specific 'tip' event type
    eventSource.addEventListener('tip', (event) => {
      console.log('SSE tip event received:', event.data);
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'tip_event') {
          const newNotification = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toLocaleTimeString(),
            deviceName: data.device_name,
            tipData: data.tip_data,
            port: data.port
          };
          
          setNotifications(prev => [newNotification, ...prev.slice(0, 9)]); // Keep last 10
          setHasMessages(true);
          
          // Show browser notification if permission granted
          if (Notification.permission === 'granted') {
            new Notification('Tip Event', {
              body: `Tip #${data.tip_data.tip_number} on ${data.device_name} Channel ${data.tip_data.channel_number}`,
              icon: '/favicon.ico'
            });

          }
        }
      } catch (error) {
        console.error('Error parsing SSE tip event:', error);
      }
    });

    eventSource.onerror = (error) => {
      console.error('SSE connection error for device', deviceId, ':', error);
      console.error('EventSource readyState:', eventSource.readyState);
      
      // If the connection failed immediately, it's likely a validation error
      if (eventSource.readyState === EventSource.CLOSED) {
        console.error('SSE connection was closed by server - likely device not connected or validation failed');
      }
    };

    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      eventSource.close();
    };
  }, [deviceId]);

  const clearNotifications = () => {
    setNotifications([]);
    setHasMessages(false);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">
          Tip Notifications
          <span className={`ml-2 inline-block w-2 h-2 rounded-full ${
            hasMessages ? 'bg-green-500' : 'bg-gray-400'
          }`}></span>
        </h3>
        {notifications.length > 0 && (
          <button
            onClick={clearNotifications}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear All
          </button>
        )}
      </div>
      
      {notifications.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-gray-500">
            No tip events received yet
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-medium text-blue-800">
                    Tip #{notification.tipData.tip_number}
                  </p>
                  <p className="text-sm text-blue-600">
                    Device: {notification.deviceName} • Channel: {notification.tipData.channel_number}
                  </p>
                  <p className="text-sm text-blue-600">
                    Temp: {notification.tipData.temperature}°C • Pressure: {notification.tipData.pressure} PSI
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  {notification.timestamp}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TipNotification;