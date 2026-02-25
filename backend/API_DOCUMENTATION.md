# FlaskApp API Documentation

## Base URL
- Local development: `http://localhost:6000`
- API prefix: `/api/v1`

## Authentication and Authorization
- Auth is JWT-based.
- Send access token in `Authorization: Bearer <token>`.
- Refresh token endpoint: `POST /api/v1/auth/refresh`.
- Role hierarchy: `admin > operator > technician > viewer`.
- Most protected endpoints return:
  - `401` when token is missing/invalid.
  - `403` when role is insufficient.

## Common Response Shape
- Success: endpoint-specific JSON payload.
- Error:

```json
{
  "error": "Human-readable message"
}
```

## Auth Endpoints
- `POST /api/v1/auth/login` - Login and return access/refresh tokens.
- `POST /api/v1/auth/refresh` - Issue a new access token from refresh token.
- `GET /api/v1/auth/me` - Get current authenticated user.
- `POST /api/v1/auth/verify-password` - Verify current user password.
- `POST /api/v1/auth/change-password` - Change current user password.
- `POST /api/v1/auth/logout` - Logout (token-side behavior handled by backend policy).

## User and Role Endpoints
- `GET /api/v1/users/me` - Get current user profile.
- `GET /api/v1/users` - List users (`admin`).
- `POST /api/v1/users` - Create user (`admin`).
- `GET /api/v1/users/<int:user_id>` - Get user by ID (`admin`).
- `PUT /api/v1/users/<int:user_id>` - Update user (`admin`).
- `DELETE /api/v1/users/<int:user_id>` - Delete user (`admin`).
- `POST /api/v1/users/<int:user_id>/reset-password` - Reset user password (`admin`).
- `GET /api/v1/roles` - List valid roles (`admin`).
- `PUT /api/v1/user/preferences` - Update current user preferences.

## App Settings and Profile Pictures
- `GET /api/v1/app-settings` - Public app settings (company name + logo URL).
- `PUT /api/v1/app-settings` - Update app settings (`admin`).
- `POST /api/v1/app-settings/logo` - Upload logo (`admin`).
- `GET /api/v1/app-settings/logo` - Download current logo.
- `DELETE /api/v1/app-settings/logo` - Delete current logo (`admin`).
- `POST /api/v1/users/<int:user_id>/profile-picture` - Upload profile picture (self or `admin`).
- `GET /api/v1/users/<int:user_id>/profile-picture` - Fetch profile picture.
- `DELETE /api/v1/users/<int:user_id>/profile-picture` - Delete profile picture (self or `admin`).

## Device and Test Orchestration
- `GET /api/v1/ports` - List serial ports.
- `GET /api/v1/devices` - List devices.
- `GET /api/v1/devices/<int:device_id>` - Get device details.
- `PUT /api/v1/devices/<int:device_id>` - Update device (`admin`, `operator`).
- `DELETE /api/v1/devices/<int:device_id>` - Delete disconnected device (`admin`, `operator`).
- `GET /api/v1/devices/by_mac/<mac_address>` - Find device by MAC.
- `GET /api/v1/devices/discover` - Discover valid devices (`admin`, `operator`).
- `POST /api/v1/devices/discover` - Discover single port/device (`admin`, `operator`).
- `POST /api/v1/devices/connect` - Connect device (`admin`, `operator`).
- `POST /api/v1/devices/disconnect/<string:port>` - Disconnect by port (`admin`, `operator`).
- `POST /api/v1/devices/<int:device_id>/disconnect` - Disconnect by device ID (`admin`, `operator`).
- `GET /api/v1/devices/connected` - List connected handlers.

### Sample Endpoints
- `POST /api/v1/samples` - Create sample (JSON or `multipart/form-data`; optional `image` upload, max 2 MB).
- `GET /api/v1/samples` - List substrate samples.
- `GET /api/v1/inoculum` - List inoculum samples.
- `GET /api/v1/samples/<int:sample_id>/image` - Download sample image.
- `PUT /api/v1/samples/<int:sample_id>` - Update sample (JSON or `multipart/form-data`; supports replacing/clearing image).
- `DELETE /api/v1/samples/<int:sample_id>` - Delete sample.

### Test Endpoints
- `POST /api/v1/tests` - Create test.
- `GET /api/v1/tests` - List tests.
- `GET /api/v1/tests/<int:test_id>` - Get test details.
- `PUT /api/v1/tests/<int:test_id>` - Update test.
- `DELETE /api/v1/tests/<int:test_id>` - Delete test.
- `POST /api/v1/tests/<int:test_id>/start` - Start test (starts all associated devices).
- `POST /api/v1/tests/<int:test_id>/stop` - Stop test (stops all associated devices).
- `POST /api/v1/tests/<int:test_id>/configurations` - Create/update BlackBox channel configurations.
- `GET /api/v1/tests/<int:test_id>/chimera-configuration` - Get Chimera config rows for test.
- `POST /api/v1/tests/<int:test_id>/chimera-configuration` - Create Chimera config rows.
- `GET /api/v1/tests/<int:test_id>/blackbox-configuration/<int:device_id>` - Get BlackBox config for device/test.
- `POST /api/v1/tests/upload-csv` - Upload CSV to bulk-create configurations.
- `GET /api/v1/tests/<int:test_id>/download` - Download test data (CSV/ZIP).

## Black Box Endpoints
- `GET /api/v1/black_box/connected` - List connected BlackBox handlers.
- `POST /api/v1/black_box/<int:device_id>/connect` - Connect BlackBox by device ID.
- `POST /api/v1/black_box/<int:device_id>/disconnect` - Disconnect BlackBox.
- `GET /api/v1/black_box/<int:device_id>/info` - Fetch device info.
- `POST /api/v1/black_box/<int:device_id>/start_logging` - Start on-device logging.
- `POST /api/v1/black_box/<int:device_id>/stop_logging` - Stop on-device logging.
- `GET /api/v1/black_box/<int:device_id>/files` - List SD files + memory.
- `POST /api/v1/black_box/<int:device_id>/download` - Download SD file.
- `POST /api/v1/black_box/<int:device_id>/download_from` - Download SD file from byte offset.
- `POST /api/v1/black_box/<int:device_id>/delete_file` - Delete SD file.
- `GET /api/v1/black_box/<int:device_id>/time` - Read RTC time.
- `POST /api/v1/black_box/<int:device_id>/time` - Set RTC time.
- `POST /api/v1/black_box/<int:device_id>/name` - Set device name.
- `GET /api/v1/black_box/<int:device_id>/hourly_tips` - Read hourly tip counters.
- `POST /api/v1/black_box/<int:device_id>/send_command` - Send raw serial command.
- `GET /api/v1/black_box/<int:device_id>/stream` - SSE stream for tip events.

## Chimera Endpoints
- `GET /api/v1/chimera/config/model` - Get global Chimera model config.
- `GET /api/v1/chimera/<int:device_id>/config` - Get per-device Chimera config.
- `POST /api/v1/chimera/<int:device_id>/config/model` - Set device model.
- `GET /api/v1/chimera/connected` - List connected Chimera handlers.
- `POST /api/v1/chimera/<int:device_id>/connect` - Connect Chimera.
- `POST /api/v1/chimera/<int:device_id>/disconnect` - Disconnect Chimera.
- `GET /api/v1/chimera/<int:device_id>/info` - Fetch Chimera info.
- `POST /api/v1/chimera/<int:device_id>/start_logging` - Start Chimera logging.
- `POST /api/v1/chimera/<int:device_id>/stop_logging` - Stop Chimera logging.
- `GET /api/v1/chimera/<int:device_id>/files` - List files + memory.
- `POST /api/v1/chimera/<int:device_id>/download` - Download file.
- `POST /api/v1/chimera/<int:device_id>/delete_file` - Delete file.
- `GET /api/v1/chimera/<int:device_id>/time` - Read RTC time.
- `POST /api/v1/chimera/<int:device_id>/time` - Set RTC time.
- `POST /api/v1/chimera/<int:device_id>/calibrate` - Trigger calibration.
- `GET /api/v1/chimera/<int:device_id>/timing` - Read timing settings.
- `POST /api/v1/chimera/<int:device_id>/timing` - Update timing settings.
- `GET /api/v1/chimera/<int:device_id>/service` - Read service interval.
- `POST /api/v1/chimera/<int:device_id>/service` - Update service interval.
- `GET /api/v1/chimera/<int:device_id>/past_values` - Read past sensor values.
- `GET /api/v1/chimera/<int:device_id>/sensor_info` - Read sensor metadata.
- `POST /api/v1/chimera/<int:device_id>/recirculation/enable` - Enable recirculation.
- `POST /api/v1/chimera/<int:device_id>/recirculation/disable` - Disable recirculation.
- `POST /api/v1/chimera/<int:device_id>/recirculation/delay` - Set recirculation delay.
- `POST /api/v1/chimera/<int:device_id>/recirculation/mode` - Set recirculation mode.
- `POST /api/v1/chimera/<int:device_id>/recirculation/flag` - Set recirculation flag.
- `GET /api/v1/chimera/<int:device_id>/recirculation/info` - Get recirculation status.
- `POST /api/v1/chimera/<int:device_id>/name` - Set device name.
- `POST /api/v1/chimera/<int:device_id>/send_command` - Send raw serial command.
- `GET /api/v1/chimera/<int:device_id>/stream` - SSE stream for processed events.
- `GET /api/v1/chimera/<int:device_id>/data_stream` - Data stream metadata.

## Data and Outlier Endpoints
- `GET /api/v1/tests/<int:test_id>/device/<int:device_id>/data` - Get time-series data.
  - Query params: `type`, `aggregation`, `start_time`, `end_time`, `limit`.
- `GET /api/v1/tests/<int:test_id>/devices` - Get devices/channels associated with a test.
- `GET /api/v1/events/recent` - Get recent events feed.
- `DELETE /api/v1/tests/<int:test_id>/device/<int:device_id>/data` - Delete device data for test.
- `GET /api/v1/tests/<int:test_id>/device/<int:device_id>/outliers` - List outlier labels.
- `POST /api/v1/tests/<int:test_id>/device/<int:device_id>/outliers` - Add outlier labels.
- `DELETE /api/v1/tests/<int:test_id>/device/<int:device_id>/outliers` - Remove outlier labels.

## Wi-Fi Endpoints
- `GET /api/v1/wifi/scan` - Scan available Wi-Fi networks.
- `POST /api/v1/wifi/connect` - Connect host machine to a Wi-Fi SSID.

## System and Audit Endpoints
- `GET /api/v1/system/serial-log` - Download serial log file.
- `DELETE /api/v1/system/serial-log` - Clear serial log (`admin`).
- `GET /api/v1/system/serial-log/info` - Get serial log metadata.
- `GET /api/v1/system/database/download` - Download SQLite DB (`admin`).
- `POST /api/v1/system/database/transfer` - Replace SQLite DB (`admin`).
- `DELETE /api/v1/system/database` - Clear DB while preserving admins (`admin`).
- `POST /api/v1/system/git-pull` - `git pull origin master` on server (`admin`).
- `GET /api/v1/audit-logs` - Query audit logs (`admin`).
  - Query params: `limit`, `offset`, `action`, `target_type`, `user_id`.
- `GET /api/v1/audit-logs/download` - Export audit logs CSV (`admin`).

## Streaming
- `GET /api/v1/black_box/<int:device_id>/stream` - BlackBox event SSE.
- `GET /api/v1/chimera/<int:device_id>/stream` - Chimera event SSE.
- `GET /stream` - Flask-SSE blueprint endpoint (internal event bus transport).

## Notes
- Device/file operations are serial-link dependent and can be slow with large on-device file counts.
- Stopping a test stops logging for all devices associated with that test.
- Most mutable endpoints write audit records for admin visibility.
