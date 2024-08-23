const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the Device schema
const DeviceSchema = new Schema({
  ip: {
    type: String,
    required: true,
    unique: true,
  },
  hostname: {
    type: String,
    required: true,
  },
  device: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    required: true,
  },
  seen: {
    type: Date,
    default: Date.now,
  },
  statusHistory: [
    {
      status: String,
      timestamp: Date,
    }
  ]
});

// Create the Device model
const Device = mongoose.model('Device', DeviceSchema);

module.exports = Device;
