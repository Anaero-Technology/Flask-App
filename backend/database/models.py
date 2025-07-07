from sqlalchemy import Boolean, Column, Integer, String
from app import db


class Device(db.Model):
    __tablename__ = "Devices"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    connected = Column(Boolean, nullable=False)
    