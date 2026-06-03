# 📸 Team Photo Wall

A simple web app for teams to share photos they're proud of. Includes an approval workflow and a TV-ready slideshow display.

## How It Works

1. **Team members** scan a QR code or visit the URL to upload a photo
2. **Managers** review and approve/reject submissions
3. **Approved photos** automatically appear on the TV slideshow

## Setup (One Time)

### 1. Install Node.js

Download and install from: https://nodejs.org/ (LTS version recommended)

### 2. Install dependencies

Open a terminal in this folder and run:

```
npm install
```

### 3. Start the server

```
npm start
```

The server will print your network URL (something like `http://192.168.1.100:3000`).

## Pages

| Page | URL | Purpose |
|------|-----|---------|
| Upload | `/` | Team members upload photos here |
| Manager | `/admin.html` | Approve or reject submitted photos |
| TV Display | `/display.html` | Fullscreen slideshow for a TV |
| QR Code | `/qr.html` | Shows a scannable QR code to share with the team |

## Using with a TV

1. Start the server on a computer that stays on (your work machine, a spare laptop, etc.)
2. On your smart TV's browser, navigate to `http://<your-computer-ip>:3000/display.html`
3. Press F for fullscreen (or use the TV's fullscreen option)
4. The slideshow will auto-rotate through approved photos and pick up new ones automatically

**Tip:** Most smart TVs (Samsung, LG, Fire TV, Roku, etc.) have a built-in web browser app you can use.

## Sharing with Your Team

1. Go to `/qr.html` on your computer
2. Print the QR code or display it on a screen near the TV
3. Team members scan it with their phone camera to go directly to the upload page

## Keyboard Shortcuts (TV Display)

- `→` or `Space` — Next photo
- `←` — Previous photo
- `F` — Toggle fullscreen
- `Esc` — Exit fullscreen

## Configuration

- **Port:** Set the `PORT` environment variable (default: 3000)
- **Slide speed:** Adjustable via the on-screen slider (3–30 seconds)

## Data Storage

- Photos are saved in the `/uploads` folder
- Photo metadata is in `/data/photos.json`
- To reset everything, delete those folders and restart
