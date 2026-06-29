const cloudinary = require('cloudinary').v2;
const QRCode = require('qrcode');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Operations';
const DATA_TAG = 'pdx5-photo-wall-data';
const FOLDER = 'pdx5-photo-wall';

// Helper: Get all photos from Cloudinary by searching our folder
async function getPhotos() {
  try {
    const result = await cloudinary.api.resources_by_tag(DATA_TAG, {
      max_results: 500,
      context: true,
      tags: true
    });
    return (result.resources || []).map(r => {
      const ctx = r.context?.custom || {};
      return {
        id: r.public_id,
        imageUrl: r.secure_url,
        cloudinaryId: r.public_id,
        caption: ctx.caption || '',
        submittedBy: ctx.submittedBy || 'Anonymous',
        status: ctx.status || 'pending',
        submittedAt: ctx.submittedAt || ''
      };
    });
  } catch (err) {
    console.error('Error fetching photos:', err);
    return [];
  }
}

// Helper: Update photo context (metadata) in Cloudinary
async function updatePhotoContext(publicId, context) {
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${v.replace(/[|=]/g, ' ')}`)
    .join('|');
  await cloudinary.uploader.explicit(publicId, {
    type: 'upload',
    context: contextStr
  });
}

// Parse multipart form data manually for serverless
function parseMultipart(event) {
  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  const boundary = contentType.split('boundary=')[1];
  if (!boundary) return null;

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf-8');

  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);

  let start = body.indexOf(boundaryBuffer) + boundaryBuffer.length + 2; // skip \r\n
  while (true) {
    const end = body.indexOf(boundaryBuffer, start);
    if (end === -1) break;
    const part = body.slice(start, end - 2); // remove trailing \r\n
    parts.push(part);
    start = end + boundaryBuffer.length + 2;
  }

  const fields = {};
  let fileBuffer = null;
  let fileName = null;

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString('utf-8');
    const content = part.slice(headerEnd + 4);

    const nameMatch = header.match(/name="([^"]+)"/);
    const fileMatch = header.match(/filename="([^"]+)"/);

    if (nameMatch) {
      if (fileMatch) {
        fileBuffer = content;
        fileName = fileMatch[1];
      } else {
        fields[nameMatch[1]] = content.toString('utf-8');
      }
    }
  }

  return { fields, fileBuffer, fileName };
}

exports.handler = async (event) => {
  const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '') || '/';
  const method = event.httpMethod;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // POST /auth
    if (path === '/auth' && method === 'POST') {
      const body = JSON.parse(event.body);
      if (body.password === ADMIN_PASSWORD) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    // POST /photos - Upload
    if (path === '/photos' && method === 'POST') {
      const parsed = parseMultipart(event);
      if (!parsed || !parsed.fileBuffer) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file uploaded' }) };
      }

      const caption = parsed.fields.caption || '';
      const submittedBy = parsed.fields.submittedBy || 'Anonymous';
      const submittedAt = new Date().toISOString();

      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: FOLDER,
            tags: [DATA_TAG],
            context: `caption=${caption.replace(/[|=]/g, ' ')}|submittedBy=${submittedBy.replace(/[|=]/g, ' ')}|status=pending|submittedAt=${submittedAt}`,
            transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
          },
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
        stream.end(parsed.fileBuffer);
      });

      const photo = {
        id: result.public_id,
        imageUrl: result.secure_url,
        caption,
        submittedBy,
        status: 'pending',
        submittedAt
      };

      return { statusCode: 201, headers, body: JSON.stringify(photo) };
    }

    // GET /photos
    if (path === '/photos' && method === 'GET') {
      const photos = await getPhotos();
      const status = event.queryStringParameters?.status;
      const filtered = status ? photos.filter(p => p.status === status) : photos;
      return { statusCode: 200, headers, body: JSON.stringify(filtered) };
    }

    // PATCH /photos/:id
    const patchMatch = path.match(/^\/photos\/(.+)$/);
    if (patchMatch && method === 'PATCH') {
      const publicId = decodeURIComponent(patchMatch[1]);
      const body = JSON.parse(event.body);
      if (!['approved', 'rejected'].includes(body.status)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) };
      }

      // Get current context
      const resource = await cloudinary.api.resource(publicId, { context: true });
      const ctx = resource.context?.custom || {};
      ctx.status = body.status;
      await updatePhotoContext(publicId, ctx);

      // If approving, check if we exceed 25 approved photos and archive the oldest
      if (body.status === 'approved') {
        const allPhotos = await getPhotos();
        const approved = allPhotos
          .filter(p => p.status === 'approved')
          .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

        if (approved.length > 25) {
          // Delete the oldest approved photos beyond 25
          const toArchive = approved.slice(0, approved.length - 25);
          for (const old of toArchive) {
            try {
              await cloudinary.uploader.destroy(old.cloudinaryId);
            } catch (e) {
              console.error('Failed to archive photo:', old.cloudinaryId, e);
            }
          }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ id: publicId, status: body.status }) };
    }

    // DELETE /photos/:id
    const deleteMatch = path.match(/^\/photos\/(.+)$/);
    if (deleteMatch && method === 'DELETE') {
      const publicId = decodeURIComponent(deleteMatch[1]);
      await cloudinary.uploader.destroy(publicId);
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Deleted' }) };
    }

    // GET /qrcode
    if (path === '/qrcode' && method === 'GET') {
      const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
      const qrDataUrl = await QRCode.toDataURL(siteUrl, { width: 400, margin: 2 });
      return { statusCode: 200, headers, body: JSON.stringify({ url: siteUrl, qrDataUrl }) };
    }

    // GET /info
    if (path === '/info' && method === 'GET') {
      const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
      return { statusCode: 200, headers, body: JSON.stringify({ url: siteUrl }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
