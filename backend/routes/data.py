from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from database.models import *
from sqlalchemy import and_

data_bp = Blueprint('data', __name__)

@data_bp.route('/api/v1/tests/<int:test_id>/device/<int:device_id>/data', methods=['GET'])
@jwt_required()
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
            
        limit = request.args.get('limit', type=int)

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
            # Get all data first (limit doesn't apply easily before aggregation without subquery)
            results = query.order_by(model.seconds_elapsed.asc()).all()
            # Raw data aggregation not implemented yet - returns raw data

        elif aggregation in ['daily', 'hourly', 'minute'] and model == BlackBoxEventLogData:
            # Aggregate event log data by time period and channel
            # Group by time period, take the last value in each group (since values are cumulative)
            all_results = query.order_by(model.timestamp.asc()).all()

            # Group by time period and channel
            groups = {}
            for row in all_results:
                if aggregation == 'daily':
                    key = (row.channel_number, row.days)
                elif aggregation == 'hourly':
                    key = (row.channel_number, row.days, row.hours)
                else:  # minute
                    key = (row.channel_number, row.days, row.hours, row.minutes)

                # Keep overwriting - last value wins (since data is ordered by timestamp asc)
                groups[key] = row

            # Convert back to list, sorted by timestamp
            results = sorted(groups.values(), key=lambda r: r.timestamp)
                
        else:
            # Raw data fetch (no aggregation)
          # Execute query
            results = query.order_by(model.timestamp.desc()).all()
            results.reverse()
        
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
@jwt_required()
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

@data_bp.route('/api/v1/events/recent', methods=['GET'])
@jwt_required()
def get_recent_events():
    """Get the last 20 events across all tests and devices (Tips, Raw Data, Chimera Analysis)"""
    try:
        events_list = []
        limit = 20

        # Get configured device/test combinations using SQL (more efficient)
        configured_combos = set(
            db.session.query(
                ChannelConfiguration.device_id,
                ChannelConfiguration.test_id
            ).distinct().all()
        )

        # 1. Fetch BlackBox Tips (Event Log) - only for devices with channel config
        tips = db.session.query(
            BlackBoxEventLogData, Device.name, Test.name
        ).join(
            Device, BlackBoxEventLogData.device_id == Device.id
        ).join(
            Test, BlackBoxEventLogData.test_id == Test.id
        ).order_by(
            BlackBoxEventLogData.timestamp.desc()
        ).limit(limit).all()

        for event, device_name, test_name in tips:
            events_list.append({
                "id": f"tip_{event.id}",
                "type": "tip",
                "device_name": device_name,
                "test_name": test_name,
                "channel": event.channel_number,
                "timestamp": event.timestamp,
                "details": {
                    "volume": event.volume_this_tip_stp,
                    "cumulative_tips": event.cumulative_tips
                }
            })

        # 2. Fetch Chimera Raw Data (Gas Analysis) - group by timestamp/channel
        # Fetch recent gas data (multiple sensors per timestamp/channel)
        from sqlalchemy import func
        
        # Get the most recent 30 distinct timestamp/channel/device combinations
        # (to ensure we have enough after grouping)
        recent_combos = db.session.query(
            ChimeraRawData.timestamp,
            ChimeraRawData.channel_number,
            ChimeraRawData.device_id
        ).distinct().order_by(
            ChimeraRawData.timestamp.desc()
        ).limit(30).subquery()
        
        # Fetch all gas readings for these combinations
        chimera_data = db.session.query(
            ChimeraRawData, Device.name, Test.name
        ).join(
            recent_combos,
            (ChimeraRawData.timestamp == recent_combos.c.timestamp) &
            (ChimeraRawData.channel_number == recent_combos.c.channel_number) &
            (ChimeraRawData.device_id == recent_combos.c.device_id)
        ).join(
            Device, ChimeraRawData.device_id == Device.id
        ).join(
            Test, ChimeraRawData.test_id == Test.id
        ).order_by(
            ChimeraRawData.timestamp.desc(),
            ChimeraRawData.sensor_number
        ).all()

        # Group by timestamp/channel/device
        gas_groups = {}
        for event, device_name, test_name in chimera_data:
            key = (event.timestamp, event.channel_number, event.device_id)
            
            if key not in gas_groups:
                gas_groups[key] = {
                    "timestamp": event.timestamp,
                    "channel": event.channel_number,
                    "device_name": device_name,
                    "test_name": test_name,
                    "device_id": event.device_id,
                    "gases": []
                }
            
            gas_groups[key]["gases"].append({
                "gas": event.gas_name,
                "peak": event.peak_value,
                "sensor": event.sensor_number
            })

        # Add to events list (sorted by timestamp, limited to 20)
        for group_data in sorted(gas_groups.values(), key=lambda x: x["timestamp"], reverse=True)[:limit]:
            events_list.append({
                "id": f"gas_group_{group_data['timestamp']}_{group_data['channel']}_{group_data['device_id']}",
                "type": "gas_analysis",
                "device_name": group_data["device_name"],
                "test_name": group_data["test_name"],
                "channel": group_data["channel"],
                "timestamp": group_data["timestamp"],
                "details": {
                    "gases": group_data["gases"]
                }
            })

        # 3. Fetch BlackBox Raw Data (Pressure/Temp) - only for non-configured devices
        bb_raw = db.session.query(
            BlackboxRawData, Device.name, Test.name
        ).join(
            Device, BlackboxRawData.device_id == Device.id
        ).join(
            Test, BlackboxRawData.test_id == Test.id
        ).order_by(
            BlackboxRawData.timestamp.desc()
        ).limit(limit).all()

        for event, device_name, test_name in bb_raw:
            # Only include if this device/test combo is NOT configured
            if (event.device_id, event.test_id) not in configured_combos:
                events_list.append({
                    "id": f"raw_{event.id}",
                    "type": "raw_data",
                    "device_name": device_name,
                    "test_name": test_name,
                    "channel": event.channel_number,
                    "timestamp": event.timestamp,
                    "details": {
                        "pressure": event.pressure,
                        "temperature": event.temperature
                    }
                })

        # Sort combined list by timestamp and return top items
        events_list.sort(key=lambda x: x['timestamp'], reverse=True)
        return jsonify(events_list[:limit])

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()
