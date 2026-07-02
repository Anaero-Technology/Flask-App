#!/usr/bin/env python3
"""
Test script for ChimeraHandler implementation
"""

import time
from chimera_handler import ChimeraHandler


def test_chimera_handler():
    """Test basic ChimeraHandler functionality"""
    
    # Note: Update this to match your actual serial port
    PORT = "/dev/ttyUSB0"  # Example port - change as needed
    
    print("Testing ChimeraHandler...")
    
    try:
        # Create handler
        handler = ChimeraHandler(PORT)
        print(f"✓ Handler created for port {PORT}")
        
        # Test connection
        print("\nTesting connection...")
        handler.connect()
        print("✓ Connected successfully")
        
        # Get device info
        print("\nGetting device info...")
        info = handler.get_info()
        print(f"✓ Device info retrieved: {info}")
        
        # Get timing
        print("\nGetting timing info...")
        success, timing, msg = handler.get_timing()
        if success:
            print(f"✓ Timing info: {timing}")
        else:
            print(f"✗ Failed to get timing: {msg}")
        
        # Get service info
        print("\nGetting service info...")
        success, service, msg = handler.get_service()
        if success:
            print(f"✓ Service sequence: {service}")
        else:
            print(f"✗ Failed to get service: {msg}")
        
        # Get sensor info
        print("\nGetting sensor info...")
        success, sensors, msg = handler.get_sensor_info()
        if success:
            print(f"✓ Sensor types: {sensors}")
        else:
            print(f"✗ Failed to get sensors: {msg}")
        
        # Get past values
        print("\nGetting past values...")
        success, past_data, msg = handler.get_past_values()
        if success:
            print(f"✓ Past data retrieved: {len(past_data)} channels")
        else:
            print(f"✗ Failed to get past data: {msg}")
        
        # Test time functions
        print("\nGetting current time...")
        success, dt, msg = handler.get_time()
        if success:
            print(f"✓ Current time: {dt}")
        else:
            print(f"✗ Failed to get time: {msg}")
        
        # List files
        print("\nGetting file list...")
        success, files = handler.get_files()
        if success:
            print(f"✓ Found {len(files)} files")
            for f in files[:5]:  # Show first 5 files
                print(f"  - {f['filename']} ({f['size']} bytes)")
        else:
            print("✗ Failed to get files")
        
        # Test raw command
        print("\nTesting raw command...")
        response = handler.send_raw_command("info")
        print(f"✓ Raw command response: {response}")
        
        # Disconnect
        print("\nDisconnecting...")
        handler.disconnect()
        print("✓ Disconnected successfully")
        
        print("\n✅ All tests completed!")
        
    except Exception as e:
        print(f"\n❌ Error during testing: {e}")
        if 'handler' in locals() and handler.is_connected:
            handler.disconnect()


def test_data_callback():
    """Test automatic data point callback"""
    PORT = "/dev/ttyUSB0"  # Update as needed
    
    print("\nTesting data callback functionality...")
    
    def data_callback(channel, sensor_data):
        print(f"\n📊 Data received for channel {channel}:")
        for sensor in sensor_data:
            print(f"  - Sensor {sensor['sensor_number']} ({sensor['gas_name']}): {sensor['peak_value']}")
    
    try:
        handler = ChimeraHandler(PORT)
        handler.connect()
        
        # Set data callback
        handler.set_data_callback(data_callback)
        print("✓ Data callback registered")
        
        # Check if logging
        info = handler.get_info()
        if info['is_logging']:
            print("Device is logging - waiting for data points...")
            print("Press Ctrl+C to stop")
            
            # Wait for data
            time.sleep(30)  # Wait 30 seconds for data
        else:
            print("Device is not logging. Start logging to receive data points.")
            
            # Optionally start logging
            response = input("Start logging? (y/n): ")
            if response.lower() == 'y':
                success, msg = handler.start_logging()
                if success:
                    print("✓ Logging started")
                    print("Waiting for data points... (30 seconds)")
                    time.sleep(30)
                    
                    # Stop logging
                    handler.stop_logging()
                    print("✓ Logging stopped")
                else:
                    print(f"✗ Failed to start logging: {msg}")
        
        handler.disconnect()
        
    except KeyboardInterrupt:
        print("\n\nStopped by user")
        if 'handler' in locals() and handler.is_connected:
            handler.disconnect()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        if 'handler' in locals() and handler.is_connected:
            handler.disconnect()


if __name__ == "__main__":
    print("ChimeraHandler Test Suite")
    print("=" * 50)
    
    # Basic tests
    test_chimera_handler()
    
    # Data callback test (optional)
    print("\n" + "=" * 50)
    response = input("\nTest data callback functionality? (y/n): ")
    if response.lower() == 'y':
        test_data_callback()
    
    print("\nTest suite completed!")