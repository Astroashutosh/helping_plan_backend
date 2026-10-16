import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import path from 'path';
import fs from 'fs';
import { getPackageUploadsDir } from '../../config/uploadConfig.js';

// Helper to generate a URL-safe slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Save base64 image strictly to backend/uploads/package directory
function saveBase64Image(base64Data: string): string | null {
  try {
    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    let ext = 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';

    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    // Write strictly to backend uploads directory
    const localPkgDir = getPackageUploadsDir();
    fs.writeFileSync(path.join(localPkgDir, fileName), buffer);

    return fileName;
  } catch (err) {
    console.error('[Package Image Save Error]', err);
    return null;
  }
}

/**
 * GET /api/admin/packages
 * List all packages with calculated 10% credit fee matching business rule
 */
export async function getPackages(req: Request, res: Response): Promise<void> {
  try {
    // 1. Fetch platform symbol and currency from generals
    const [generalRows]: any = await pool.query(
      'SELECT symbol, currency FROM generals LIMIT 1'
    );
    const general = generalRows[0] || {};
    const baseActivationFee = 10.0;
    const currencySymbol = general.symbol || '$';

    // 2. Fetch packages
    const [rows]: any = await pool.query(`
      SELECT 
        p.id,
        p.title,
        p.slug,
        p.price,
        p.image,
        p.package_type,
        p.items,
        p.status,
        p.daily_limit,
        p.created_at,
        p.updated_at,
        (SELECT COUNT(*) FROM lending_logs WHERE package_id = p.id) as donations_count,
        (SELECT COALESCE(SUM(lend_amount), 0) FROM lending_logs WHERE package_id = p.id) as donations_volume
      FROM packages p
      ORDER BY p.price ASC
    `);

    const packages = rows.map((p: any) => {
      const price = parseFloat(p.price || 0);
      // Strictly 10% of package price needed for credit (e.g. $50 -> $5, $100 -> $10, $200 -> $20, $500 -> $50)
      const creditCost = parseFloat((price * 0.10).toFixed(2));
      // Sequential FIFO rule: 2x of package price
      const targetPayout = parseFloat((price * 2).toFixed(2));
      const dailyLimitCount = parseInt(p.daily_limit || 0);

      return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        price,
        image: p.image || null,
        imageUrl: p.image ? `/uploads/package/${p.image}` : null,
        package_type: p.package_type || 'entry',
        items: parseInt(p.items || 0),
        status: p.status === 1 ? 'Active' : 'Disabled',
        statusCode: p.status,
        daily_limit: dailyLimitCount,
        dailyLimitLabel: dailyLimitCount > 0 ? `${dailyLimitCount}x / day` : 'Unlimited',
        creditCost,
        targetPayout,
        donations_count: parseInt(p.donations_count || 0),
        donations_volume: parseFloat(p.donations_volume || 0),
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });

    res.json({
      success: true,
      data: {
        packages,
        meta: {
          total_packages: packages.length,
          active_packages: packages.filter((p: any) => p.statusCode === 1).length,
          disabled_packages: packages.filter((p: any) => p.statusCode === 0).length,
          base_activation_fee: baseActivationFee,
          currency_symbol: currencySymbol,
        },
      },
    });
  } catch (error: any) {
    console.error('[Admin Packages Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch packages.',
    });
  }
}

/**
 * GET /api/admin/packages/:id
 * Retrieve a single package by ID
 */
export async function getPackageById(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string);
    if (!id) {
      res.status(400).json({ success: false, message: 'Invalid package ID.' });
      return;
    }

    const [rows]: any = await pool.query(
      'SELECT * FROM packages WHERE id = ? LIMIT 1',
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ success: false, message: 'Package not found.' });
      return;
    }

    const p = rows[0];
    const price = parseFloat(p.price || 0);
    // Strictly 10% of package price
    const creditCost = parseFloat((price * 0.10).toFixed(2));
    const targetPayout = parseFloat((price * 2).toFixed(2));

    res.json({
      success: true,
      data: {
        id: p.id,
        title: p.title,
        slug: p.slug,
        price,
        image: p.image || null,
        imageUrl: p.image ? `/uploads/package/${p.image}` : null,
        package_type: p.package_type || 'entry',
        items: parseInt(p.items || 0),
        status: p.status === 1 ? 'Active' : 'Disabled',
        statusCode: p.status,
        daily_limit: parseInt(p.daily_limit || 0),
        creditCost,
        targetPayout,
        created_at: p.created_at,
        updated_at: p.updated_at,
      },
    });
  } catch (error: any) {
    console.error('[Admin Get Package Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve package details.',
    });
  }
}

/**
 * POST /api/admin/packages
 * Create a new donation package with optional image badge upload
 */
export async function createPackage(req: Request, res: Response): Promise<void> {
  try {
    const { title, price, daily_limit, status, imageBase64, package_type } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ success: false, message: 'Package title is required.' });
      return;
    }

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 1) {
      res.status(400).json({ success: false, message: 'Valid donation price (minimum 1.00) is required.' });
      return;
    }

    const numDailyLimit = Math.max(0, parseInt(daily_limit || 0));
    const numStatus = status === 0 || status === 'Disabled' || status === '0' ? 0 : 1;
    const pkgType = package_type || 'entry';

    // Unique slug generation matching Laravel PackageService
    const baseSlug = generateSlug(title);
    let finalSlug = baseSlug;
    const [existingSlugs]: any = await pool.query(
      "SELECT slug FROM packages WHERE slug = ? OR slug LIKE ?",
      [baseSlug, `${baseSlug}-%`]
    );
    if (existingSlugs.length > 0) {
      finalSlug = `${baseSlug}-${existingSlugs.length + 1}`;
    }

    // Save image if uploaded
    let imageName: string | null = null;
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
      imageName = saveBase64Image(imageBase64);
    }

    const now = new Date();
    const [result]: any = await pool.query(
      `INSERT INTO packages (title, slug, price, image, package_type, items, status, daily_limit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [title.trim(), finalSlug, numPrice, imageName, pkgType, numStatus, numDailyLimit, now, now]
    );

    res.status(201).json({
      success: true,
      message: 'Donation package created successfully.',
      data: {
        id: result.insertId,
        title: title.trim(),
        slug: finalSlug,
        price: numPrice,
        image: imageName,
        imageUrl: imageName ? `/uploads/package/${imageName}` : null,
        status: numStatus === 1 ? 'Active' : 'Disabled',
        statusCode: numStatus,
        daily_limit: numDailyLimit,
      },
    });
  } catch (error: any) {
    console.error('[Admin Create Package Error]', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create package.',
    });
  }
}

/**
 * PUT /api/admin/packages/:id
 * Update an existing package with optional image badge update
 */
export async function updatePackage(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string);
    if (!id) {
      res.status(400).json({ success: false, message: 'Invalid package ID.' });
      return;
    }

    const [existing]: any = await pool.query('SELECT * FROM packages WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, message: 'Package not found.' });
      return;
    }

    const currentPkg = existing[0];
    const { title, price, daily_limit, status, imageBase64, package_type } = req.body;

    const newTitle = title ? title.trim() : currentPkg.title;
    const newPrice = price !== undefined ? parseFloat(price) : currentPkg.price;
    const newDailyLimit = daily_limit !== undefined ? Math.max(0, parseInt(daily_limit)) : currentPkg.daily_limit;
    const newStatus = status !== undefined
      ? (status === 0 || status === 'Disabled' || status === '0' ? 0 : 1)
      : currentPkg.status;
    const newPkgType = package_type || currentPkg.package_type || 'entry';

    // Update slug if title changed
    let finalSlug = currentPkg.slug;
    if (title && title.trim() !== currentPkg.title) {
      const baseSlug = generateSlug(title);
      finalSlug = baseSlug;
      const [existingSlugs]: any = await pool.query(
        "SELECT slug FROM packages WHERE id != ? AND (slug = ? OR slug LIKE ?)",
        [id, baseSlug, `${baseSlug}-%`]
      );
      if (existingSlugs.length > 0) {
        finalSlug = `${baseSlug}-${existingSlugs.length + 1}`;
      }
    }

    // Process new image if uploaded
    let imageName = currentPkg.image;
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
      const savedName = saveBase64Image(imageBase64);
      if (savedName) {
        imageName = savedName;
      }
    }

    const now = new Date();
    await pool.query(
      `UPDATE packages 
       SET title = ?, slug = ?, price = ?, image = ?, package_type = ?, status = ?, daily_limit = ?, updated_at = ?
       WHERE id = ?`,
      [newTitle, finalSlug, newPrice, imageName, newPkgType, newStatus, newDailyLimit, now, id]
    );

    res.json({
      success: true,
      message: `Package "${newTitle}" updated successfully.`,
      data: {
        id,
        title: newTitle,
        slug: finalSlug,
        price: newPrice,
        image: imageName,
        imageUrl: imageName ? `/uploads/package/${imageName}` : null,
        status: newStatus === 1 ? 'Active' : 'Disabled',
        statusCode: newStatus,
        daily_limit: newDailyLimit,
      },
    });
  } catch (error: any) {
    console.error('[Admin Update Package Error]', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update package.',
    });
  }
}

/**
 * PATCH /api/admin/packages/:id/status
 * Quick toggle package status between Active (1) and Disabled (0)
 */
export async function togglePackageStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string);
    if (!id) {
      res.status(400).json({ success: false, message: 'Invalid package ID.' });
      return;
    }

    const [existing]: any = await pool.query('SELECT id, title, status FROM packages WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, message: 'Package not found.' });
      return;
    }

    const current = existing[0];
    const newStatus = current.status === 1 ? 0 : 1;
    const now = new Date();

    await pool.query(
      'UPDATE packages SET status = ?, updated_at = ? WHERE id = ?',
      [newStatus, now, id]
    );

    res.json({
      success: true,
      message: `Package "${current.title}" is now ${newStatus === 1 ? 'Active' : 'Disabled'}.`,
      data: {
        id,
        status: newStatus === 1 ? 'Active' : 'Disabled',
        statusCode: newStatus,
      },
    });
  } catch (error: any) {
    console.error('[Admin Toggle Package Status Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle package status.',
    });
  }
}

/**
 * DELETE /api/admin/packages/:id
 * Delete a donation package
 */
export async function deletePackage(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string);
    if (!id) {
      res.status(400).json({ success: false, message: 'Invalid package ID.' });
      return;
    }

    const [existing]: any = await pool.query('SELECT * FROM packages WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, message: 'Package not found.' });
      return;
    }

    const currentPkg = existing[0];

    // Check if there are active lending logs associated with this package
    const [lendingRows]: any = await pool.query(
      "SELECT COUNT(*) as count FROM lending_logs WHERE package_id = ? AND status = 'active'",
      [id]
    );
    if (lendingRows[0]?.count > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot delete package "${currentPkg.title}" because there are ${lendingRows[0].count} active donation cycle(s) running on it. You can disable it instead.`,
      });
      return;
    }

    await pool.query('DELETE FROM packages WHERE id = ?', [id]);

    res.json({
      success: true,
      message: `Package "${currentPkg.title}" deleted successfully.`,
    });
  } catch (error: any) {
    console.error('[Admin Delete Package Error]', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete package.',
    });
  }
}
