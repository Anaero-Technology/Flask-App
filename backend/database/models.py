from sqlalchemy import Boolean, Column, Integer, String, Float, DateTime, ForeignKey
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
            'language': self.language
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

