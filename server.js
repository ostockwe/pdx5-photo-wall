const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary configuration (set these as environment variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Data storage - use persistent path if available, otherwise local
const storageBase = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dataDir = path.join(storageBase, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dataFile = path.join(dataDir, 'photos.json');
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]');

// Multer - temp storage for upload before sending to Cloudinary
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files (jpg, png, gif, webp) are allowed.'));
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Admin authentication
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Operations';

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Incorrect password' });
  }
});

// ==================== API ROUTES ====================

// Upload a photo
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'pdx5-photo-wall',
      transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
    });

    // Remove temp file
    fs.unlinkSync(req.file.path);

    const photos = readPhotos();
    const newPhoto = {
      id: uuidv4(),
      imageUrl: result.secure_url,
      cloudinaryId: result.public_id,
      caption: req.body.caption || '',
      submittedBy: req.body.submittedBy || 'Anonymous',
      status: 'pending',
      submittedAt: new Date().toISOString()
    };

    photos.push(newPhoto);
    writePhotos(photos);
    res.status(201).json(newPhoto);
  } catch (err) {
    // Clean up temp file on error
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
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
app.delete('/api/photos/:id', async (req, res) => {
  const { id } = req.params;
  let photos = readPhotos();
  const photo = photos.find(p => p.id === id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  // Delete from Cloudinary
  try {
    if (photo.cloudinaryId) {
      await cloudinary.uploader.destroy(photo.cloudinaryId);
    }
  } catch (err) {
    console.error('Cloudinary delete error:', err);
  }

  photos = photos.filter(p => p.id !== id);
  writePhotos(photos);
  res.json({ message: 'Deleted' });
});

// QR code endpoint
app.get('/api/qrcode', async (req, res) => {
  let url;
  if (process.env.RENDER_EXTERNAL_URL) {
    url = process.env.RENDER_EXTERNAL_URL;
  } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
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
  if (process.env.RENDER_EXTERNAL_URL) {
    url = process.env.RENDER_EXTERNAL_URL;
  } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
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
  console.log('  ║         📸 PDX5 Photo Wall Running           ║');
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
});
