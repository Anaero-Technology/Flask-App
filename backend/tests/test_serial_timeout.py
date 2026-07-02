#!/usr/bin/env python3
"""
Test script to demonstrate the refactored serial handler architecture.
This shows how automatic messages (like "tip") are handled separately from command responses.
"""

import time
from black_box_handler import BlackBoxHandler


def test_serial_handler():
    # Replace with your actual serial port
    PORT = "/dev/cu.usbserial-0001"
    
    # Create handler instance
    handler = BlackBoxHandler(PORT)
    
    try:
        print("Connecting to device...")
        handler.connect()
        print("Connected!")
        
        # Get device info
        print("\nGetting device info...")
        info = handler.get_info()
        print(f"Device: {info['device_name']}")
        print(f"MAC: {info['mac_address']}")
        print(f"Logging: {info['is_logging']}")
        print(f"Log file: {info['current_log_file']}")
        
        # Test sending commands while automatic messages are being received
        print("\n--- Testing command/response while receiving automatic tips ---")
        print("(Automatic tip messages will be printed as they arrive)")
        
        # Get time
        print("\nGetting time...")
        time_str = handler.get_time()
        print(f"Device time: {time_str}")
        
        # Wait a bit to see automatic messages
        print("\nWaiting 5 seconds to see automatic tip messages...")
        time.sleep(5)
        
        # Get files list
        print("\nGetting files list...")
        files_info = handler.get_files()
        print(f"Memory - Total: {files_info['memory']['total']} KB, Used: {files_info['memory']['used']} KB")
        print(f"Files count: {len(files_info['files'])}")
        
        # Wait more to see additional automatic messages
        print("\nWaiting another 5 seconds...")
        time.sleep(20)
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        print("\nDisconnecting...")
        handler.disconnect()
        print("Disconnected!")

if __name__ == "__main__":
    test_serial_handler()