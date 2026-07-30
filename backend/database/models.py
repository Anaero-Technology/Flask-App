from sqlalchemy import Boolean, Column, Integer, String, Float, DateTime, ForeignKey, LargeBinary
from sqlalchemy.orm import DeclarativeBase
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

class Base(DeclarativeBase):
  pass

db = SQLAlchemy(model_class=Base)


class User(db.Model):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    email = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(20), nullable=False, default='viewer')  # admin, operator, technician, viewer
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    csv_delimiter = Column(String(1), nullable=False, default=',')  # CSV delimiter preference: ',', ';', '\t'
    language = Column(String(5), nullable=False, default='en')  # Language preference: 'en', 'es', 'fr', 'de', 'zh'
    time_display = Column(String(5), nullable=False, default='local')  # Timestamp display preference: 'local' or 'utc'
    export_header_language = Column(String(5), nullable=False, default='en')  # Language for downloaded CSV column headers: 'en', 'es', 'fr', 'de', 'zh'
    profile_picture_filename = Column(String(255), nullable=True)  # Profile picture filename

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'role': self.role,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'created_by': self.created_by,
            'csv_delimiter': self.csv_delimiter,
            'language': self.language,
            'time_display': self.time_display,
            'export_header_language': self.export_header_language,
            'profile_picture_url': f'/api/v1/users/{self.id}/profile-picture' if self.profile_picture_filename else None
        }


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    action = Column(String(50))  # 'start_test', 'delete_sample', 'create_user', etc.
    target_type = Column(String(50))  # 'test', 'sample', 'device', 'user'
    target_id = Column(Integer)
    details = Column(String(500))
    timestamp = Column(DateTime, default=datetime.utcnow)

class Device(db.Model):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    device_type = Column(String(50), nullable=False)  # 'black_box' or 'chimera'
    serial_port = Column(String(50), nullable=False)
    mac_address = Column(String(50), nullable=True, unique=True)  # Unique identifier
    connected = Column(Boolean, nullable=False, default=False)
    logging = Column(Boolean, nullable=False, default=False)
    active_test_id = Column(Integer, ForeignKey('tests.id'), nullable=True)


class BlackboxRawData(db.Model):
   __tablename__ = "blackboxRawData"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   tip_number = Column(Integer, nullable=False)
   channel_number = Column(Integer, nullable=False)

   timestamp = Column(Integer)
   seconds_elapsed = Column(Integer)
   temperature = Column(Float, nullable=True)
   pressure = Column(Float, nullable=True)


class ChimeraRawData(db.Model):
   __tablename__ = "chimeraRawData"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   channel_number = Column(Integer, nullable=False)

   timestamp = Column(Integer)
   seconds_elapsed = Column(Integer)
   sensor_number = Column(Integer, nullable=False)
   gas_name = Column(String(50), nullable=True)
   peak_value = Column(Float, nullable=True)
   peak_parts = Column(String(500), nullable=True)  # JSON string of peak parts array
   

class BlackBoxEventLogData(db.Model):
   __tablename__ = "blackboxEventLogData"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   channel_number = Column(Integer, nullable=False)

   channel_name = Column(String, nullable=True)
   timestamp = Column(Integer, nullable=False)
   days = Column(Integer, nullable=False)
   hours = Column(Integer, nullable=False)
   minutes = Column(Integer, nullable=False)

   tumbler_volume = Column(Float, nullable=False)
   temperature = Column(Float, nullable=True)
   pressure = Column(Float, nullable=False)

   cumulative_tips = Column(Integer, nullable=False)
   volume_this_tip_stp = Column(Float, nullable=False)
   total_volume_stp = Column(Float, nullable=False)

   tips_this_day = Column(Integer, nullable=False)
   volume_this_day_stp = Column(Float, nullable=False)
   tips_this_hour = Column(Integer, nullable=False)
   volume_this_hour_stp = Column(Float, nullable=False)

   net_volume_per_gram = Column(Float, nullable=False)


class Sample(db.Model):
   __tablename__ = "samples"

   id = Column(Integer, primary_key=True)
   date_created = Column(DateTime)
   sample_name = Column(String(255), nullable=False)
   substrate_source = Column(String, nullable=False) # Potentially have substrate source as a separate more detailed table
   description = Column(String)
   substrate_type = Column(String)
   substrate_subtype = Column(String)
   ash_content  = Column(Float)
   c_content = Column(Float)
   n_content = Column(Float)
   substrate_percent_ts = Column(Float)
   substrate_percent_vs = Column(Float)
   author = Column(String)
   is_inoculum = Column(Boolean, default=False)  # True if this sample can be used as an inoculum (bacteria source)
   sample_image_data = Column(LargeBinary)
   sample_image_mime_type = Column(String(100))
   sample_image_filename = Column(String(255))

class Test(db.Model):
   __tablename__ = "tests"

   id = Column(Integer, primary_key=True)
   name = Column(String(255), nullable=False)
   description = Column(String)
   date_created = Column(DateTime)
   date_started = Column(DateTime)
   date_ended = Column(DateTime)
   created_by = Column(String)
   status = Column(String, default="setup")  # setup, running, completed


class ChannelConfiguration(db.Model):
   __tablename__ = "channel_configurations"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   channel_number = Column(Integer, nullable=False)  # 1-15
   in_service = Column(Boolean, nullable=False, default=True)
   
   
   inoculum_sample_id = Column(Integer, ForeignKey('samples.id'), nullable=True)
   inoculum_weight_grams = Column(Float, nullable=False)
   substrate_sample_id = Column(Integer, ForeignKey('samples.id'), nullable=True)
   substrate_weight_grams = Column(Float, nullable=False, default=0)  # 0 for controls
   tumbler_volume = Column(Float, nullable=False)  # Volume of gas required for a tip

   tip_count = Column(Integer, nullable=False, default=0) #Number of tips that have occurred
   total_stp_volume = Column(Float, nullable=False, default=0.0)
   total_net_volume = Column(Float, nullable=False, default=0.0)

   hourly_tips = Column(Integer, nullable=False, default=0)
   daily_tips = Column(Integer, nullable=False, default=0)
   last_tip_time = Column(String, nullable=True)
   hourly_volume = Column(Float, nullable=False, default=0.0)
   daily_volume = Column(Float, nullable=False, default=0.0)


   chimera_channel = Column(Integer, nullable=True)  # Optional chimera channel (1-15) linked to this BlackBox channel

   notes = Column(String)
   
   # Ensure unique channel per test
   __table_args__ = (
       db.UniqueConstraint('test_id', 'device_id', 'channel_number', name='unique_test_device_channel'),
   )


class ChimeraConfiguration(db.Model):
   """Global Chimera settings per test/device"""
   __tablename__ = "chimera_configurations"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)  # The chimera device

   # Global timing settings
   flush_time_seconds = Column(Float, nullable=False, default=30.0)

   # Recirculation settings - mode can be 'off', 'volume', or 'periodic'
   recirculation_mode = Column(String, nullable=False, default='off')
   recirculation_delay_seconds = Column(Integer, nullable=True)  # Seconds between periodic recirculation runs (required for periodic mode)
   recirculation_duration_seconds = Column(Integer, nullable=True)  # Length of each periodic recirculation run (required for periodic mode)

   # Service sequence - which channels are in service (15 chars, '1' or '0')
   service_sequence = Column(String(15), nullable=False, default='111111111111111')

   __table_args__ = (
       db.UniqueConstraint('test_id', 'device_id', name='unique_test_chimera_device'),
   )


class ChimeraChannelConfiguration(db.Model):
   """Per-channel settings for Chimera"""
   __tablename__ = "chimera_channel_configurations"

   id = Column(Integer, primary_key=True)
   chimera_config_id = Column(Integer, ForeignKey('chimera_configurations.id'), nullable=False)
   channel_number = Column(Integer, nullable=False)  # 1-15

   open_time_seconds = Column(Float, nullable=False, default=600.0)
   volume_threshold_ml = Column(Float, nullable=True)  # For volume mode
   volume_since_last_recirculation = Column(Float, nullable=False, default=0.0)  # Tracking for volume triggers

   __table_args__ = (
       db.UniqueConstraint('chimera_config_id', 'channel_number', name='unique_chimera_config_channel'),
   )


class Outlier(db.Model):
   """Tracks data points that have been labeled as outliers"""
   __tablename__ = "outliers"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   data_point_id = Column(Integer, nullable=False)  # ID of the data point in the source table
   data_type = Column(String(20), nullable=False)  # 'raw' or 'processed' - indicates which table the data point is in
   labeled_by = Column(Integer, ForeignKey('users.id'), nullable=False)
   labeled_at = Column(DateTime, default=datetime.utcnow)

   __table_args__ = (
       db.UniqueConstraint('test_id', 'device_id', 'data_point_id', 'data_type', name='unique_outlier'),
   )


class PlcProfile(db.Model):
   """A saved, reusable PLC configuration.

   Holds a machine type plus every unit setting as the same command script the
   PLC itself saves, so applying a profile is a replay rather than a translation.
   Not tied to a test or a device - it is a template an operator can reuse.
   """
   __tablename__ = "plc_profiles"

   id = Column(Integer, primary_key=True)
   name = Column(String(120), nullable=False, unique=True)
   machine_type = Column(String(32), nullable=False)      # firmware personality token
   model_id = Column(String(32), nullable=True)           # product build, e.g. "ray-i"
   settings = Column(String, nullable=False)              # JSON: heaters/mixers/feeders/agitators
   description = Column(String, nullable=True)
   created_by = Column(String, nullable=True)
   created_at = Column(DateTime, default=datetime.utcnow)
   updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PlcConfiguration(db.Model):
   """One entry in a test's PLC configuration timeline.

   A test starts with the configuration applied at start, and gains another row
   every time the settings are changed while it runs. Rows are snapshots, never
   updated, so the record of what the machine was doing at any point cannot be
   rewritten later. Exported with the test's data.
   """
   __tablename__ = "plc_configurations"

   id = Column(Integer, primary_key=True)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=False)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)

   sequence = Column(Integer, nullable=False, default=1)    # 1 = applied at start
   machine_type = Column(String(32), nullable=False)
   model_id = Column(String(32), nullable=True)
   settings = Column(String, nullable=False)                # JSON, same shape as PlcProfile
   profile_name = Column(String(120), nullable=True)        # profile it came from, if any
   change_note = Column(String, nullable=True)              # what changed, for the timeline
   recorded_at = Column(DateTime, default=datetime.utcnow)


class AutomationRule(db.Model):
   """A closed-loop control rule: watch measurements, drive a PLC output.

   Turns a manual observe-then-adjust workflow into an automated dynamic
   experiment, e.g. "while methane on chimera channel 3 is above 55% AND the
   reactor is at temperature, increase feeder 1's feed time by 5 seconds, but
   never beyond 60". A rule is:

   - conditions: one or more measurements with a comparison each, held in
     AutomationCondition rows and combined with condition_logic
   - action: which PLC unit parameter to change and by how much, bounded by
     hard min/max clamps so a runaway loop can never drive the machine
     outside the range the operator signed off on

   Rules act on the machine whenever they are enabled, independent of tests
   (machine control and test recording are separate lifecycles); a change
   made while the target PLC is attached to a running test is appended to
   that test's configuration timeline like any hand edit.
   """
   __tablename__ = "automation_rules"

   id = Column(Integer, primary_key=True)
   name = Column(String(120), nullable=False)
   enabled = Column(Boolean, nullable=False, default=True)

   # How the conditions combine: 'all' = AND, 'any' = OR
   condition_logic = Column(String(3), nullable=False, default='all')

   # Action on a PLC unit
   target_device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   unit_type = Column(String(10), nullable=False)     # 'heater', 'mixer', 'feeder', 'agitator'
   unit_number = Column(Integer, nullable=False)
   parameter = Column(String(20), nullable=False)     # 'target', 'on_for', 'off_for', 'off_for_minutes', 'pre_feed'
   action_type = Column(String(10), nullable=False)   # 'increase', 'decrease', 'set'
   amount = Column(Float, nullable=False)
   min_value = Column(Float, nullable=False)          # hard clamps the action can never leave
   max_value = Column(Float, nullable=False)

   # One adjustment, then hands off for this long - the process needs time to
   # respond before the measurement is worth acting on again.
   cooldown_seconds = Column(Integer, nullable=False, default=3600)
   last_triggered_at = Column(DateTime, nullable=True)

   created_by = Column(String, nullable=True)
   created_at = Column(DateTime, default=datetime.utcnow)
   updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

   conditions = db.relationship(
       'AutomationCondition', backref='rule', order_by='AutomationCondition.position',
       cascade='all, delete-orphan', lazy='selectin')


class AutomationCondition(db.Model):
   """One measurement test inside a rule.

   Split from the rule so a rule can watch several things at once - gas level
   and temperature, or two channels - combined with the rule's AND/OR logic.
   Rows are replaced wholesale when a rule is saved, so position is just the
   order the operator wrote them in.
   """
   __tablename__ = "automation_conditions"

   id = Column(Integer, primary_key=True)
   rule_id = Column(Integer, ForeignKey('automation_rules.id'), nullable=False)
   position = Column(Integer, nullable=False, default=0)

   source_type = Column(String(20), nullable=False)   # 'chimera_gas', 'blackbox_volume', 'plc_temperature'
   source_device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   source_channel = Column(Integer, nullable=False)   # chimera/blackbox channel, or PLC heater number
   gas_name = Column(String(50), nullable=True)       # chimera_gas only, e.g. 'CH4'
   window_minutes = Column(Integer, nullable=False, default=0)  # 0 = latest reading; else average (gas) / sum (volume)

   operator = Column(String(3), nullable=False)       # 'gt', 'lt', 'gte', 'lte'
   threshold = Column(Float, nullable=False)


class AutomationEvent(db.Model):
   """Append-only record of everything a rule did (or could not do).

   One row per triggered evaluation: what was measured, what the rule decided,
   and what actually happened to the machine. Never rewritten, so an exported
   experiment can show exactly when and why the automation intervened.
   """
   __tablename__ = "automation_events"

   id = Column(Integer, primary_key=True)
   rule_id = Column(Integer, ForeignKey('automation_rules.id'), nullable=False)
   test_id = Column(Integer, ForeignKey('tests.id'), nullable=True)  # test running on the target PLC, if any

   # JSON list, one entry per condition: value, whether it was met, and the
   # description it was read under - so an event explains itself even after
   # the rule that produced it has been edited.
   observed_values = Column(String, nullable=True)
   outcome = Column(String(10), nullable=False)       # 'fired', 'clamped', 'failed'
   old_value = Column(Float, nullable=True)           # parameter before / after, for 'fired'
   new_value = Column(Float, nullable=True)
   message = Column(String(500), nullable=True)
   created_at = Column(DateTime, default=datetime.utcnow)


class PlcCalibration(db.Model):
   """A per-heater temperature offset for a PLC.

   The firmware reports the sensor's raw reading. A user checks the true
   temperature with an external thermometer and the difference is stored here;
   the backend adds it so the reading the app shows and logs matches reality.
   Kept per physical device, independent of machine type or test.
   """
   __tablename__ = "plc_calibrations"

   id = Column(Integer, primary_key=True)
   device_id = Column(Integer, ForeignKey('devices.id'), nullable=False)
   heater_number = Column(Integer, nullable=False)      # 1-based reactor/heater
   offset = Column(Float, nullable=False, default=0.0)   # degrees C added to the raw reading
   updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

   __table_args__ = (
       db.UniqueConstraint('device_id', 'heater_number', name='unique_device_heater_cal'),
   )
