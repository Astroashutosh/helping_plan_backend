import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import { getUploadsBaseDir } from '../../config/uploadConfig.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const validTypes = ['testimonial', 'withdrawal_proof'];

const uploadDir = path.join(getUploadsBaseDir(), 'cms', 'proofs');

const allowedMimeTypes: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

async function saveBase64Image(
  base64: unknown,
  mimeType: unknown
): Promise<string | null> {
  if (typeof base64 !== 'string' || !base64) {
    return null;
  }

  if (typeof mimeType !== 'string' || !allowedMimeTypes[mimeType]) {
    throw new Error('Only JPG, PNG and WebP images are allowed');
  }

  // Limit decoded image size to 5 MB.
  const maxBase64Length = Math.ceil((5 * 1024 * 1024 * 4) / 3);

  if (base64.length > maxBase64Length) {
    throw new Error('Image size must not exceed 5 MB');
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new Error('Invalid image data');
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    throw new Error('Image size must not exceed 5 MB');
  }

  // Verify actual file signature, not only the supplied MIME type.
  const signature = buffer.subarray(0, 12);
  let validSignature = false;

  if (mimeType === 'image/jpeg') {
    validSignature =
      signature[0] === 0xff &&
      signature[1] === 0xd8 &&
      signature[2] === 0xff;
  } else if (mimeType === 'image/png') {
    validSignature =
      signature.length >= 8 &&
      signature[0] === 0x89 &&
      signature[1] === 0x50 &&
      signature[2] === 0x4e &&
      signature[3] === 0x47 &&
      signature[4] === 0x0d &&
      signature[5] === 0x0a &&
      signature[6] === 0x1a &&
      signature[7] === 0x0a;
  } else if (mimeType === 'image/webp') {
    validSignature =
      signature.toString('ascii', 0, 4) === 'RIFF' &&
      signature.toString('ascii', 8, 12) === 'WEBP';
  }

  if (!validSignature) {
    throw new Error('Image content does not match its file type');
  }

  await fs.mkdir(uploadDir, { recursive: true });

  const filename = `${crypto.randomUUID()}${allowedMimeTypes[mimeType]}`;
  await fs.writeFile(path.join(uploadDir, filename), buffer, {
    flag: 'wx',
  });

  return `/uploads/cms/proofs/${filename}`;
}

// export async function getPublicCMS(req: Request, res: Response) {
//   try {
//     const [rows] = await pool.query<RowDataPacket[]>(`
//       SELECT id, type, title, member, description,
//              video_url, thumbnail_url, amount, reference,
//              image_url, status, created_at
//       FROM cms_contents
//       WHERE (type = 'testimonial' AND status = 'published')
//          OR (type = 'withdrawal_proof' AND status = 'approved')
//       ORDER BY created_at DESC
//     `);

//     return res.json({ success: true, data: rows });
//   } catch (error) {
//     console.error('[CMS] Public list error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Unable to load CMS content',
//     });
//   }
// }


export async function getPublicCMS(req: Request, res: Response) {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT
        id,
        type,
        title,
        member,
        description,
        video_url,
        thumbnail_url,
        amount,
        reference,
        image_url,
        status,
        created_at,
        updated_at
      FROM cms_contents
      ORDER BY created_at DESC
    `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("[CMS] Public list error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load CMS content",
    });
  }
}

export async function manageCMS(req: Request, res: Response) {
  let savedImagePath: string | null = null;

  try {
    const {
      action, type, id, title, member, description,
      videoUrl, thumbnailUrl, amount, reference,
      image, imageMimeType, status,
    } = req.body;

    if (action === 'public_list') {
      return getPublicCMS(req, res);
    }

    if (action === 'list') {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM cms_contents ORDER BY created_at DESC'
      );

      return res.json({ success: true, data: rows });
    }

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type',
      });
    }

    if (action === 'create') {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Title is required',
        });
      }

      if (type === 'testimonial' &&
          (typeof videoUrl !== 'string' || !videoUrl.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Video URL is required',
        });
      }

      if (type === 'withdrawal_proof' && !image) {
        return res.status(400).json({
          success: false,
          message: 'Please select a proof image',
        });
      }

      if (
        type === 'withdrawal_proof' &&
        amount !== undefined &&
        amount !== null &&
        amount !== '' &&
        (!Number.isFinite(Number(amount)) || Number(amount) < 0)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid amount',
        });
      }

      if (type === 'withdrawal_proof') {
        savedImagePath = await saveBase64Image(image, imageMimeType);
      }

      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO cms_contents
          (type, title, member, description, video_url,
           thumbnail_url, amount, reference, image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          type,
          title.trim(),
          type === 'testimonial' ? member || null : null,
          type === 'testimonial' ? description || null : null,
          type === 'testimonial' ? videoUrl.trim() : null,
          type === 'testimonial' ? thumbnailUrl || null : null,
          type === 'withdrawal_proof' && amount !== '' ? amount || null : null,
          type === 'withdrawal_proof' ? reference || null : null,
          savedImagePath,
          type === 'testimonial' ? 'draft' : 'pending',
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Content added successfully',
        id: result.insertId,
      });
    }

    if (!['update', 'delete', 'status'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action',
      });
    }

    const contentId = Number(id);

    if (!Number.isSafeInteger(contentId) || contentId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid ID is required',
      });
    }

    const [existingRows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM cms_contents WHERE id = ? AND type = ?',
      [contentId, type]
    );

    const existing = existingRows[0];

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
      });
    }

    if (action === 'delete') {
      await pool.execute(
        'DELETE FROM cms_contents WHERE id = ? AND type = ?',
        [contentId, type]
      );

      // Remove the stored image only if it is inside the CMS proof folder.
      if (existing.image_url) {
        const oldPath = path.resolve(
          getUploadsBaseDir(),
          `.${existing.image_url}`
        );
        const allowedDir = path.resolve(uploadDir);

        if (oldPath.startsWith(allowedDir + path.sep)) {
          await fs.unlink(oldPath).catch(() => undefined);
        }
      }

      return res.json({
        success: true,
        message: 'Content deleted successfully',
      });
    }

    if (action === 'status') {
      const allowedStatuses =
        type === 'testimonial'
          ? ['draft', 'published']
          : ['pending', 'approved', 'rejected'];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status',
        });
      }

      await pool.execute(
        'UPDATE cms_contents SET status = ? WHERE id = ? AND type = ?',
        [status, contentId, type]
      );

      return res.json({
        success: true,
        message: 'Status updated successfully',
      });
    }

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required',
      });
    }

    if (type === 'testimonial' &&
        (typeof videoUrl !== 'string' || !videoUrl.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Video URL is required',
      });
    }

    if (
      type === 'withdrawal_proof' &&
      amount !== undefined &&
      amount !== null &&
      amount !== '' &&
      (!Number.isFinite(Number(amount)) || Number(amount) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
    }

    if (type === 'withdrawal_proof' && image) {
      savedImagePath = await saveBase64Image(image, imageMimeType);
    }

    const finalImageUrl =
      type === 'withdrawal_proof'
        ? savedImagePath || existing.image_url
        : null;

    await pool.execute(
      `UPDATE cms_contents SET
        title = ?, member = ?, description = ?,
        video_url = ?, thumbnail_url = ?, amount = ?,
        reference = ?, image_url = ?
       WHERE id = ? AND type = ?`,
      [
        title.trim(),
        type === 'testimonial' ? member || null : null,
        type === 'testimonial' ? description || null : null,
        type === 'testimonial' ? videoUrl.trim() : null,
        type === 'testimonial' ? thumbnailUrl || null : null,
        type === 'withdrawal_proof' && amount !== '' ? amount || null : null,
        type === 'withdrawal_proof' ? reference || null : null,
        finalImageUrl,
        contentId,
        type,
      ]
    );

    // Remove replaced image after successful database update.
    if (savedImagePath && existing.image_url) {
      const oldPath = path.resolve(
        getUploadsBaseDir(),
        `.${existing.image_url}`
      );
      const allowedDir = path.resolve(uploadDir);

      if (oldPath.startsWith(allowedDir + path.sep)) {
        await fs.unlink(oldPath).catch(() => undefined);
      }
    }

    return res.json({
      success: true,
      message: 'Content updated successfully',
    });
  } catch (error) {
    // Remove a newly uploaded image if the database operation failed.
    if (savedImagePath) {
      const newPath = path.resolve(
        getUploadsBaseDir(),
        `.${savedImagePath}`
      );
      const allowedDir = path.resolve(uploadDir);

      if (newPath.startsWith(allowedDir + path.sep)) {
        await fs.unlink(newPath).catch(() => undefined);
      }
    }

    if (error instanceof Error &&
        (error.message.startsWith('Only ') ||
         error.message.startsWith('Image ') ||
         error.message.startsWith('Invalid image'))) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    console.error('[CMS] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'CMS request failed',
    });
  }
}