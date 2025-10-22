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
   sensor_number = Column(Integer, nullable=False)
   gas_name = Column(String(50), nullable=True)
   peak_value = Column(Float, nullable=True)
   peak_parts = Column(String(500), nullable=True)  # JSON string of peak parts array
   

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
   other = Column(String)
   reactor  = Column(String)
   temperature = Column(Float)

class BlackBoxSettings(db.Model):
   __tablename__ = "blackboxSettings"

   id = Column(Integer, primary_key=True)

  
class InoculumSample(db.Model):
   __tablename__ = "inoculum"

   id = Column(Integer, primary_key=True)
   date_created = Column(DateTime)
   inoculum_source = Column(String)
   inoculum_percent_ts = Column(Float)
   inoculum_percent_vs = Column(Float)


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
   
   inoculum_sample_id = Column(Integer, ForeignKey('inoculum.id'), nullable=False)
   inoculum_weight_grams = Column(Float, nullable=False)
   substrate_sample_id = Column(Integer, ForeignKey('samples.id'), nullable=True)
   substrate_weight_grams = Column(Float, nullable=False, default=0)  # 0 for controls
   tumbler_volume = Column(Float, nullable=False)  # Volume of gas required for a tip

   tip_count = Column(Integer, nullable=False, default=0) #Number of tips that have occurred
   total_stp_volume = Column(Float, nullable=False, default=0.0)
   total_net_volume = Column(Float, nullable=False, defualt=0.0)
   
   notes = Column(String)
   
   # Ensure unique channel per test
   __table_args__ = (
       db.UniqueConstraint('test_id', 'device_id', 'channel_number', name='unique_test_device_channel'),
   )
  

