const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const ping = require('ping');
const WebSocket = require('ws');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('./models/user'); // Import the User model
const Device = require('./models/device'); // Import the Device model

const app = express();
const port = 5000;
const wss = new WebSocket.Server({ port: 5001 }); // WebSocket server

app.use(cors());
app.use(bodyParser.json());

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost/your-db');
    console.log('MongoDB connected');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    process.exit(1);
  }
};

connectDB();

const users = []; // In-memory user storage

// Function to initialize admin user
const initializeAdminUser = async () => {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    users.push({
      username: 'admin',
      password: hashedPassword,
      email: 'admin@gmail.com'
    });
    console.log('Admin user initialized');
  } catch (error) {
    console.error('Error initializing admin user:', error);
  }
};

// Broadcast function to notify all WebSocket clients
const broadcastDevices = async () => {
  try {
    const devices = await Device.find(); // Fetch devices from MongoDB
    console.log('Broadcasting devices:', devices); // Log broadcast data
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(devices));
      }
    });
  } catch (error) {
    console.error('Error broadcasting devices:', error);
  }
};

// Function to ping all devices and update their status
const pingDevices = async () => {
  try {
    const devices = await Device.find(); // Fetch devices from MongoDB
    for (let device of devices) {
      const { alive } = await ping.promise.probe(device.ip);
      const status = alive ? 'up' : 'down';

      // Update status if it has changed
      if (device.status !== status) {
        console.log(`Status changed for ${device.ip}: ${device.status} -> ${status}`);
        device.statusHistory.push({
          status,
          timestamp: new Date().toLocaleString(),
        });
        device.status = status;
        device.seen = new Date().toLocaleString();
        await device.save(); // Save the updated device status to MongoDB
      }
    }

    broadcastDevices(); // Notify all WebSocket clients of the updated device statuses
  } catch (error) {
    console.error('Error pinging devices:', error);
  }
};

// Call pingDevices every 10 seconds
setInterval(pingDevices, 10000);

// Add new IP address endpoint
app.post('/add-ip', async (req, res) => {
  const { ipAddress, hostname, device } = req.body;

  if (!ipAddress || !hostname || !device) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const { alive } = await ping.promise.probe(ipAddress);
    const status = alive ? 'up' : 'down';

    let deviceEntry = await Device.findOne({ ip: ipAddress });
    if (deviceEntry) {
      // Check if the status has changed
      if (deviceEntry.status !== status) {
        console.log(`Status changed for ${ipAddress}: ${deviceEntry.status} -> ${status}`);
        // Add status change to history
        deviceEntry.statusHistory.push({
          status,
          timestamp: new Date().toLocaleString()
        });
        deviceEntry.status = status;
        deviceEntry.hostname = hostname;
        deviceEntry.device = device;
        deviceEntry.seen = new Date().toLocaleString();
        await deviceEntry.save(); // Save the updated device
      }
    } else {
      deviceEntry = new Device({
        ip: ipAddress,
        hostname,
        device,
        status,
        seen: new Date().toLocaleString(),
        statusHistory: [{ status, timestamp: new Date().toLocaleString() }]
      });
      await deviceEntry.save(); // Save the new device
      console.log(`New device added: ${ipAddress} with status ${status}`);
    }

    broadcastDevices(); // Notify all WebSocket clients
    res.status(200).json(deviceEntry); // Ensure success response
  } catch (error) {
    console.error('Error checking IP address:', error);
    res.status(500).json({ error: 'Error checking IP address' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = users.find(user => user.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (match) {
    res.status(200).json({ message: 'Login successful' });
  } else {
    res.status(401).json({ error: 'Invalid username or password' });
  }
});

// Get device statuses
app.get('/devices', async (req, res) => {
  try {
    const devices = await Device.find(); // Fetch devices from MongoDB
    res.status(200).json(devices); // Ensure success response
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Error fetching devices' });
  }
});

// Add new user endpoint
app.post('/add-user', async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Check if the user already exists
  const existingUser = users.find(user => user.username === username);
  if (existingUser) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  users.push({
    username,
    email,
    password: hashedPassword,
  });

  res.status(201).json({ message: 'User added successfully' });
});

// Get users endpoint
app.get('/users', (req, res) => {
  res.status(200).json(users);
});

// Remove user endpoint
app.delete('/remove-user/:username', (req, res) => {
  const { username } = req.params;
  const index = users.findIndex(user => user.username === username);

  if (index === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  users.splice(index, 1);
  res.status(200).json({ message: 'User removed successfully' });
});

// Initialize the admin user and start the server
const startServer = async () => {
  await initializeAdminUser();
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
};

startServer();

wss.on('connection', async ws => {
  console.log('WebSocket client connected');

  try {
    // Send the current devices to the newly connected client
    const devices = await Device.find();
    ws.send(JSON.stringify(devices));
  } catch (error) {
    console.error('Error sending devices to WebSocket client:', error);
  }

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});
