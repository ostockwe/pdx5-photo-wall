const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage paths - use RAILWAY_VOLUME_MOUNT_PATH if available (persistent storage)
const storageBase = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const uploadsDir = path.join(storageBase, 'uploads');
const dataDir = path.join(storageBase, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dataFile = path.join(dataDir, 'photos.json');
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files (jpg, png, gif, webp) are allowed.'));
  }
});

// Data helpers
function readPhotos() {
  return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
}

function writePhotos(photos) {
  fs.writeFileSync(dataFile, JSON.stringify(photos, null, 2));
}

// Get local network IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ==================== API ROUTES ====================

// Upload a photo
app.post('/api/photos', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const photos = readPhotos();
  const newPhoto = {
    id: uuidv4(),
    filename: req.file.filename,
    originalName: req.file.originalname,
    caption: req.body.caption || '',
    submittedBy: req.body.submittedBy || 'Anonymous',
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  photos.push(newPhoto);
  writePhotos(photos);
  res.status(201).json(newPhoto);
});

// Get photos (optionally filter by status)
app.get('/api/photos', (req, res) => {
  const photos = readPhotos();
  const status = req.query.status;
  if (status) return res.json(photos.filter(p => p.status === status));
  res.json(photos);
});

// Update photo status
app.patch('/api/photos/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
  }

  const photos = readPhotos();
  const photo = photos.find(p => p.id === id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  photo.status = status;
  writePhotos(photos);
  res.json(photo);
});

// Delete a photo
app.delete('/api/photos/:id', (req, res) => {
  const { id } = req.params;
  let photos = readPhotos();
  const photo = photos.find(p => p.id === id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  const filePath = path.join(uploadsDir, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  photos = photos.filter(p => p.id !== id);
  writePhotos(photos);
  res.json({ message: 'Deleted' });
});

// QR code endpoint - uses RAILWAY_PUBLIC_DOMAIN if deployed, otherwise local IP
app.get('/api/qrcode', async (req, res) => {
  let url;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    url = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  } else {
    const ip = getLocalIP();
    url = `http://${ip}:${PORT}`;
  }
  try {
    const qrDataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
    res.json({ url, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Server info
app.get('/api/info', (req, res) => {
  let url;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    url = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  } else {
    const ip = getLocalIP();
    url = `http://${ip}:${PORT}`;
  }
  res.json({ url });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║         📸 Team Photo Wall Running           ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  Local:   http://localhost:${PORT}             ║`);
  console.log(`  ║  Network: http://${ip}:${PORT}    ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║  Pages:                                      ║');
  console.log('  ║    Upload:  /                                ║');
  console.log('  ║    Admin:   /admin.html                      ║');
  console.log('  ║    TV:      /display.html                    ║');
  console.log('  ║    QR Code: /qr.html                         ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('  Share the Network URL with your team!');
  console.log('  Point your TV browser to /display.html');
  console.log('');
});
