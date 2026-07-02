#!/usr/bin/env python3
"""
Test script for BlackBoxHandler tip reading functionality
"""

import time
from black_box_handler import BlackBoxHandler


def test_tip_callback():
    """Test automatic tip callback functionality"""
    
    # Note: Update this to match your actual serial port
    PORT = "/dev/cu.usbserial-0001"  # Example port - change as needed
    
    print("Testing BlackBoxHandler tip reading...")
    
    def tip_callback(tip_data):
        print(f"\n📊 Tip received:")
        print(f"  - Tip Number: {tip_data['tip_number']}")
        print(f"  - Timestamp: {tip_data['timestamp']}")
        print(f"  - Seconds Elapsed: {tip_data['seconds_elapsed']}")
        print(f"  - Channel: {tip_data['channel_number']}")
        print(f"  - Temperature: {tip_data['temperature']}°C")
        print(f"  - Pressure: {tip_data['pressure']} Pa")
    
    try:
        # Create handler
        handler = BlackBoxHandler(PORT)
        print(f"✓ Handler created for port {PORT}")
        
        # Connect
        handler.connect()
        print("✓ Connected successfully")
        
        # Set tip callback
        handler.set_tip_callback(tip_callback)
        print("✓ Tip callback registered")
        
        # Get device info
        info = handler.get_info()
        print(f"✓ Device info: {info}")
        
        # Check if logging
        if info['is_logging']:
            print("Device is logging - waiting for tip messages...")
            print("Press Ctrl+C to stop")
            
            # Wait for tips
            time.sleep(60)  # Wait 60 seconds for tips
        else:
            print("Device is not logging. Start logging to receive tip messages.")
            
            # Optionally start logging
            response = input("Start logging? (y/n): ")
            if response.lower() == 'y':
                filename = input("Enter filename: ")
                success, msg = handler.start_logging(filename)
                if success:
                    print("✓ Logging started")
                    print("Waiting for tip messages... (60 seconds)")
                    time.sleep(60)
                    
                    # Stop logging
                    handler.stop_logging()
                    print("✓ Logging stopped")
                else:
                    print(f"✗ Failed to start logging: {msg}")
        
        # Disconnect
        handler.disconnect()
        print("✓ Disconnected successfully")
        
    except KeyboardInterrupt:
        print("\n\nStopped by user")
        if 'handler' in locals() and handler.is_connected:
            handler.disconnect()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        if 'handler' in locals() and handler.is_connected:
            handler.disconnect()


def test_basic_functionality():
    """Test basic BlackBoxHandler functionality"""
    
    # Note: Update this to match your actual serial port
    PORT = "/dev/cu.usbserial-0001"  # Example port - change as needed
    
    print("Testing basic BlackBoxHandler functionality...")
    
    try:
        # Create handler
        handler = BlackBoxHandler(PORT)
        print(f"✓ Handler created for port {PORT}")
        
        # Test connection
        handler.connect()
        print("✓ Connected successfully")
        
        # Get device info
        info = handler.get_info()
        print(f"✓ Device info: {info}")
        
        # Get files
        files_info = handler.get_files()
        print(f"✓ Files info retrieved: {len(files_info['files'])} files, Memory: {files_info['memory']}")
        
        # Get time
        current_time = handler.get_time()
        print(f"✓ Current time: {current_time}")
        
        # Test raw command
        response = handler.send_command("info")
        print(f"✓ Raw command response: {response}")
        
        # Disconnect
        handler.disconnect()
        print("✓ Disconnected successfully")
        
        print("\n✅ Basic tests completed!")
        
    except Exception as e:
        print(f"\n❌ Error during testing: {e}")
        if 'handler' in locals() and handler.is_connected:
            handler.disconnect()


if __name__ == "__main__":
    print("BlackBoxHandler Test Suite")
    print("=" * 50)
    
    # Basic tests
    test_basic_functionality()
    
    # Tip callback test (optional)
    print("\n" + "=" * 50)  
    response = input("\nTest tip callback functionality? (y/n): ")
    if response.lower() == 'y':
        test_tip_callback()
    
    print("\nTest suite completed!")