# Flask Device Management API Documentation

## Base URL
All endpoints are prefixed with: `http://localhost:6000`

## General Device Management

### List Available Serial Ports
```
GET /api/v1/ports
```
Returns a list of available serial ports on the system.

**Response:**
```json
[
  {
    "name": "COM3",
    "device": "/dev/ttyUSB0",
    "description": "USB Serial Port"
  }
]
```

### List All Devices
```
GET /api/v1/devices
```
Returns all registered devices in the database.

**Response:**
```json
[
  {
    "id": 1,
    "name": "MyBlackBox",
    "device_type": "black_box",
    "serial_port": "/dev/ttyUSB0",
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "logging": false,
    "connected": false
  }
]
```

### Register New Device
```
POST /api/v1/devices
```
Register a new device by connecting to it and calling the info command. This automatically determines the device type and retrieves the MAC address.

**Request Body:**
```json
{
  "serial_port": "/dev/ttyUSB0",  // Required\
  "device_type": "black_box",      // Required: "black_box" or "chimera"
  "name": "MyDevice"              // Optional: custom name (if not provided, must be available from device)
}
```

**Response:** Same as device object above with status 201

**Notes:**
- The system automatically connects to the device and calls the info command
- Device type is determined automatically (currently only supports black_box)
- MAC address is automatically retrieved from the device
- If no name is provided in the request AND the device doesn't provide a name, registration fails

### Get Device by ID
```
GET /api/v1/devices/<device_id>
```
Get details of a specific device.

**Response:** Single device object

### Update Device
```
PUT /api/v1/devices/<device_id>
```
Update device information.

**Request Body:**
```json
{
  "name": "NewName",              // Optional
  "serial_port": "/dev/ttyUSB1"   // Optional: update port if device moved
}
```

### Delete Device
```
DELETE /api/v1/devices/<device_id>
```
Delete a device (must be disconnected first).

**Response:**
```json
{
  "message": "Device deleted successfully"
}
```

### Find Device by MAC Address
```
GET /api/v1/devices/by_mac/<mac_address>
```
Find a device using its MAC address.

### List Connected Devices
```
GET /api/v1/devices/connected
```
Get status of all currently connected devices from DeviceManager.

**Response:**
```json
{
  "black_boxes": [
    {
      "device_id": 1,
      "port": "/dev/ttyUSB0",
      "name": "BlackBox1",
      "serial": "12345",
      "status": "idle"
    }
  ],
  "chimeras": []
}
```

### Discover Device
```
POST /api/v1/devices/discover
```
Test connection to a device without registering it. Useful for checking what's connected to a port.

**Request Body:**
```json
{
  "device_type": "black_box",     // Required for now
  "serial_port": "/dev/ttyUSB0"   // Required
}
```

**Response:**
```json
{
  "device_type": "black_box",
  "port": "/dev/ttyUSB0",
  "device_name": "BlackBox1",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "is_logging": false,
  "current_log_file": null
}
```

## Black Box Specific Endpoints

### Connect to Black Box
```
POST /api/v1/black_box/<device_id>/connect
```
Connect to a registered black box device.

**Response:**
```json
{
  "success": true,
  "device_id": 1,
  "device_name": "BlackBox1",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "is_logging": false,
  "current_log_file": null
}
```

### Disconnect from Black Box
```
POST /api/v1/black_box/<device_id>/disconnect
```
Disconnect from a black box device.

### Get Device Info
```
GET /api/v1/black_box/<device_id>/info
```
Get current device information.

**Response:**
```json
{
  "device_name": "BlackBox1",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "is_logging": false,
  "current_log_file": null,
  "port": "/dev/ttyUSB0"
}
```

### Start Logging
```
POST /api/v1/black_box/<device_id>/start_logging
```
Start logging data to SD card.

**Request Body:**
```json
{
  "filename": "log_20240115.txt"
}
```

### Stop Logging
```
POST /api/v1/black_box/<device_id>/stop_logging
```
Stop current logging session.

### List Files
```
GET /api/v1/black_box/<device_id>/files
```
Get SD card memory info and list of files.

**Response:**
```json
{
  "memory": {
    "total": 16000000000,
    "used": 1234567
  },
  "files": [
    {
      "name": "log_20240115.txt",
      "size": 123456
    }
  ]
}
```

### Download File
```
POST /api/v1/black_box/<device_id>/download
```
Download a file from the SD card.

**Request Body:**
```json
{
  "filename": "log_20240115.txt",
  "max_bytes": 1000000  // Optional: limit download size
}
```

### Download File From Byte
```
POST /api/v1/black_box/<device_id>/download_from
```
Download file starting from specific byte position.

**Request Body:**
```json
{
  "filename": "log_20240115.txt",
  "byte_from": 1000
}
```

### Delete File
```
POST /api/v1/black_box/<device_id>/delete_file
```
Delete a file from SD card.

**Request Body:**
```json
{
  "filename": "log_20240115.txt"
}
```

### Get Device Time
```
GET /api/v1/black_box/<device_id>/time
```
Get current time from device RTC.

**Response:**
```json
{
  "timestamp": "2024 01 15 14 30 45",
  "success": true
}
```

### Set Device Time
```
POST /api/v1/black_box/<device_id>/time
```
Set device RTC time.


**Request Body:**
```json
{
  "timestamp": "2024,01,15,14,30,45"
}
```

### Set Device Name
```
POST /api/v1/black_box/<device_id>/name
```
Change the device name.

**Request Body:**
```json
{
  "name": "NewDeviceName"
}
```

### Get Hourly Tips
```
GET /api/v1/black_box/<device_id>/hourly_tips
```
Get hourly tip count data.

### Send Raw Command
```
POST /api/v1/black_box/<device_id>/send_command
```
Send a raw command to the device.

**Request Body:**
```json
{
  "command": "info"
}
```

## Error Responses

All endpoints may return error responses in the format:
```json
{
  "error": "Error description"
}
```

Common HTTP status codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 404: Not Found
- 409: Conflict (e.g., port already in use)
- 500: Internal Server Error