from flask import Flask, request, jsonify, make_response
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import URL
from sqlalchemy.orm import DeclarativeBase
import serial.tools.list_ports
from config import Config


class Base(DeclarativeBase):
  pass

db = SQLAlchemy(model_class=Base)

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = Config.SQLALCHEMY_DATABASE_URI
db.init_app(app)

from database.models import Device

with app.app_context():
    db.create_all()

@app.route("/api/v1/ports")
def list_ports():
    ports = []
    for port in serial.tools.list_ports.comports():
        ports.append({
            "device": port.device,
            "name": port.name,
            "description": port.description
        })
    return jsonify(ports)


@app.route("/api/v1/devices")
def list_devices():
    try:
        devices = db.session.query(Device).all()
        return jsonify([{
            "id": device.id,
            "name": device.name,
            "connected": device.connected
        } for device in devices])
    finally:
        db.session.close()


@app.route("/api/v1/devices", methods=['POST'])
def post_device():
    try:
        data = request.get_json()
        db_device = Device(
            name=data.get('name'),
            connected=data.get('connected', False)
        )
        db.session.add(db_device)
        db.session.commit()
        db.session.refresh(db_device)
        return jsonify({
            "id": db_device.id,
            "name": db_device.name,
            "connected": db_device.connected
        }), 201
    finally:
        db.session.close()
