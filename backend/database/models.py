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


class BlackboxRawData(db.Model):
   __tablename__ = "blackboxRawData"

   id = Column(Integer, primary_key=True)
   sample_id = Column(Integer, ForeignKey('samples.id'))

   timestamp = Column(Integer)
   seconds_elapsed = Column(Integer)
   channel_number = Column (Integer)
   temperature = Column(Float)
   pressure = Column(Float)

class Sample(db.Model):
   __tablename__ = "samples"

   id = Column(Integer, primary_key=True)
   inoculum_id = Column(Integer, ForeignKey("inoculum.id"))
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
  
class InoculumSample(db.Model):
   __tablename__ = "inoculum"

   id = Column(Integer, primary_key=True)
   inoculum_source = Column(String)
   inoculum_percent_ts = Column(Float)
   inoculum_percent_vs = Column(Float)
  

