from sqlalchemy import Boolean, Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase
from flask_sqlalchemy import SQLAlchemy

class Base(DeclarativeBase):
  pass

db = SQLAlchemy(model_class=Base)

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
  

