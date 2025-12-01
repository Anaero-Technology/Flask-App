from flask import Blueprint, request, jsonify
from database.models import *
from sqlalchemy import and_

data_bp = Blueprint('data', __name__)

@data_bp.route('/api/v1/tests/<int:test_id>/device/<int:device_id>/data', methods=['GET'])
def get_device_data(test_id, device_id):
    """Get time-series data for a specific device in a test"""
    try:
        # Get query parameters
        data_type = request.args.get('type', 'processed')  # 'processed' or 'raw'
        aggregation = request.args.get('aggregation', 'raw') # 'raw', 'hourly', 'daily'
        start_time = request.args.get('start_time')
        end_time = request.args.get('end_time')
        
        print(f"DEBUG: Fetching data for Test {test_id}, Device {device_id}")
        print(f"DEBUG: Params - Type: {data_type}, Aggregation: {aggregation}, Start: {start_time}, End: {end_time}")
        
        # Verify device exists
        device = Device.query.get(device_id)
        if not device:
            print("DEBUG: Device not found")
            return jsonify({"error": "Device not found"}), 404
            
        # Determine which table to query based on device type and data type
        model = None
        
        if device.device_type in ['black-box', 'black_box']:
            if data_type == 'raw':
                model = BlackboxRawData
            else:
                # Default to Event Log, but check if channels are configured
                # If no channels are configured for this test/device, return error
                channels_configured = ChannelConfiguration.query.filter_by(test_id=test_id, device_id=device_id).first()
                if channels_configured:
                    model = BlackBoxEventLogData
                else:
                    print("DEBUG: No channel configuration found")
                    return jsonify({
                        "error": "Plots can't be rendered in manual logging mode for the blackbox due to unconfigured channels",
                        "code": "NO_CHANNEL_CONFIG"
                    }), 404
        elif device.device_type in ['chimera', 'chimera-max']:
            # Chimera only has raw data for now
            model = ChimeraRawData
        else:
            print(f"DEBUG: Unsupported device type: {device.device_type}")
            return jsonify({"error": f"Unsupported device type: {device.device_type}"}), 400
            
        if not model:
            print("DEBUG: Could not determine data model")
            return jsonify({"error": "Could not determine data model"}), 500
            
        # Build query
        query = model.query.filter_by(test_id=test_id, device_id=device_id)
        
        # Add time filters if provided
        if start_time:
            query = query.filter(model.timestamp >= int(start_time))
        if end_time:
            query = query.filter(model.timestamp <= int(end_time))
            
        data = []
        
        # Apply aggregation if needed (for raw data models)
        if aggregation in ['daily', 'hourly', 'minute'] and model in [ChimeraRawData, BlackboxRawData]:
            # Calculate time period divisor
            if aggregation == 'daily':
                divisor = 86400
            elif aggregation == 'hourly':
                divisor = 3600
            else: # minute
                divisor = 60
            
            # Get all data first
            results = query.order_by(model.seconds_elapsed.asc()).all()
            
            # Group by channel and time period, keep last measurement per period
            period_data = {}
            for row in results:
                channel = row.channel_number
                period = int(row.seconds_elapsed // divisor)
                
                if model == ChimeraRawData:
                    # For Chimera, we must also group by sensor/gas to preserve all gases
                    key = (channel, period, row.sensor_number)
                else:
                    key = (channel, period)
                
                # Keep only the last (most recent) measurement for this period
                if key not in period_data or row.seconds_elapsed > period_data[key].seconds_elapsed:
                    period_data[key] = row
            
            # Convert to list
            results = list(period_data.values())
            print(f"DEBUG: Aggregated {len(query.all())} rows to {len(results)} rows")
        
        elif aggregation in ['daily', 'hourly', 'minute'] and model == BlackBoxEventLogData:
            # Get all data sorted by timestamp
            results = query.order_by(model.timestamp.asc()).all()
            
            # Group by channel and time period, keep last measurement per period
            period_data = {}
            for row in results:
                channel = row.channel_number
                
                # Determine period key based on existing columns or timestamp
                if aggregation == 'daily':
                    # Use the days column directly if reliable, or derive from timestamp
                    period = row.days
                elif aggregation == 'hourly':
                    # Combine days and hours for unique hourly period
                    period = (row.days, row.hours)
                else: # minute
                    # Combine days, hours, minutes for unique minute period
                    period = (row.days, row.hours, row.minutes)
                
                key = (channel, period)
                
                # Keep only the last (most recent) measurement for this period
                # Since results are sorted by timestamp asc, we can just overwrite
                period_data[key] = row
            
            # Convert to list
            results = list(period_data.values())
            print(f"DEBUG: Aggregated EventLog {len(query.all())} rows to {len(results)} rows")
                
        else:
            # Raw data fetch (no aggregation)
            # Limit to 10000 points to prevent browser crash if too much data
            results = query.order_by(model.timestamp.asc()).limit(10000).all()
        
        # Process raw/aggregated results (if not already processed above)
        # Process raw/aggregated results
        for row in results:
            item = {}
            # Common fields
            item['timestamp'] = row.timestamp
            item['channel_number'] = row.channel_number
            
            # Specific fields based on model
            if model == BlackboxRawData:
                item['temperature'] = row.temperature
                item['pressure'] = row.pressure
                item['tip_number'] = row.tip_number
                item['seconds_elapsed'] = row.seconds_elapsed
                # Add derived time columns
                item['days'] = row.seconds_elapsed / 86400
                item['hours'] = row.seconds_elapsed / 3600
                item['minutes'] = row.seconds_elapsed / 60
            elif model == BlackBoxEventLogData:
                item['tumbler_volume'] = row.tumbler_volume
                item['temperature'] = row.temperature
                item['pressure'] = row.pressure
                item['cumulative_tips'] = row.cumulative_tips
                item['total_volume_stp'] = row.total_volume_stp
                item['volume_this_hour_stp'] = row.volume_this_hour_stp
                item['net_volume_per_gram'] = row.net_volume_per_gram
                
                # Add time columns
                item['days'] = row.days
                item['hours'] = row.hours
                item['minutes'] = row.minutes
                # Calculate seconds_elapsed for X-axis compatibility
                item['seconds_elapsed'] = (row.days * 86400) + (row.hours * 3600) + (row.minutes * 60)
            elif model == ChimeraRawData:
                item['gas_name'] = row.gas_name
                item['peak_value'] = row.peak_value
                item['seconds_elapsed'] = row.seconds_elapsed
                # Add derived time columns
                item['days'] = row.seconds_elapsed / 86400
                item['hours'] = row.seconds_elapsed / 3600
                item['minutes'] = row.seconds_elapsed / 60
                
            data.append(item)
        
        print(f"DEBUG: Found {len(data)} records")
        if len(data) > 0:
            print(f"DEBUG: First record sample: {data[0]}")
            
        return jsonify({
            "test_id": test_id,
            "device_id": device_id,
            "device_type": device.device_type,
            "data_type": data_type,
            "aggregation": aggregation,
            "count": len(data),
            "data": data
        })
        
    except Exception as e:
        print(f"DEBUG: Error occurred: {str(e)}")
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@data_bp.route('/api/v1/tests/<int:test_id>/devices', methods=['GET'])
def get_test_devices(test_id):
    """Get all devices associated with a test, either via configuration or data"""
    try:
        devices_map = {}  # device_id -> {channels: set()}

        # 1. Check ChannelConfiguration
        configs = ChannelConfiguration.query.filter_by(test_id=test_id).all()
        for config in configs:
            if config.device_id not in devices_map:
                devices_map[config.device_id] = {'channels': set()}
            devices_map[config.device_id]['channels'].add(config.channel_number)

        # 2. Check Data tables
        # BlackBox Raw
        bb_raw_devices = db.session.query(BlackboxRawData.device_id, BlackboxRawData.channel_number)\
            .filter_by(test_id=test_id).distinct().all()
        for dev_id, chan_num in bb_raw_devices:
            if dev_id not in devices_map:
                devices_map[dev_id] = {'channels': set()}
            devices_map[dev_id]['channels'].add(chan_num)

        # Chimera Raw
        chim_raw_devices = db.session.query(ChimeraRawData.device_id, ChimeraRawData.channel_number)\
            .filter_by(test_id=test_id).distinct().all()
        for dev_id, chan_num in chim_raw_devices:
            if dev_id not in devices_map:
                devices_map[dev_id] = {'channels': set()}
            devices_map[dev_id]['channels'].add(chan_num)

        # 3. Check for devices actively logging to this test
        active_devices = Device.query.filter_by(active_test_id=test_id).all()
        for device in active_devices:
            if device.id not in devices_map:
                devices_map[device.id] = {'channels': set()}

        # 4. Fetch Device details and format response
        response_data = []
        for device_id, info in devices_map.items():
            device = Device.query.get(device_id)
            if device:
                response_data.append({
                    "id": device.id,
                    "name": device.name,
                    "device_type": device.device_type,
                    "channels": sorted(list(info['channels']))
                })

        return jsonify(response_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()
