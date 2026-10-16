import { Request, Response } from 'express';
import { pool } from '../../config/db.js';

// Helper to generate a collision-free 8-character uppercase alphanumeric code
function generatePinCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Ensure unique pin code in transpins
async function getUniquePinCode(): Promise<string> {
  let isUnique = false;
  let code = '';
  while (!isUnique) {
    code = generatePinCode();
    const [existing]: any = await pool.query(
      'SELECT id FROM transpins WHERE pin_code = ? LIMIT 1',
      [code]
    );
    if (!existing || existing.length === 0) {
      isUnique = true;
    }
  }
  return code;
}

/**
 * GET /api/admin/credits/packages
 * Fetch active donation packages for credit generation & transfer modals
 */
export async function getActivePackagesForCredits(req: Request, res: Response): Promise<void> {
  try {
    const [rows]: any = await pool.query(`
      SELECT id, title, price, status
      FROM packages
      WHERE status = 1
      ORDER BY price ASC
    `);

    const packages = rows.map((pkg: any) => {
      const priceNum = Number(pkg.price) || 0;
      const pinValue = Math.round(priceNum * 0.10 * 100) / 100;
      return {
        id: pkg.id,
        title: pkg.title,
        price: priceNum,
        pinValue: pinValue,
      };
    });

    res.json({
      success: true,
      data: packages,
    });
  } catch (error: any) {
    console.error('[CreditController] getActivePackagesForCredits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch packages' });
  }
}

/**
 * GET /api/admin/credits/check-user
 * Live username verification for transfer modal
 */
export async function checkMember(req: Request, res: Response): Promise<void> {
  try {
    const username = String(req.query.username || '').trim();
    if (!username) {
      res.status(400).json({ success: false, message: 'Username is required' });
      return;
    }

    const [rows]: any = await pool.query(
      `SELECT id, username, first_name, last_name, email, status 
       FROM users 
       WHERE username = ? 
       LIMIT 1`,
      [username]
    );

    if (!rows || rows.length === 0) {
      res.json({
        success: false,
        valid: false,
        message: 'Destination member not found. Please enter a valid username.',
      });
      return;
    }

    const user = rows[0];
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
    res.json({
      success: true,
      valid: true,
      data: {
        id: user.id,
        username: user.username,
        name: fullName,
        email: user.email,
        status: user.status === 1 ? 'Active' : 'Inactive',
      },
      message: `Verified: ${fullName} (${user.username})`,
    });
  } catch (error: any) {
    console.error('[CreditController] checkMember error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to verify member' });
  }
}

/**
 * GET /api/admin/credits/unallotted
 * Unallotted Transaction Credits (trans_pin.blade.php)
 * allot_uid = 0 AND status = 0
 */
export async function getUnallottedCredits(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '15'), 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    let countQuery = `
      SELECT COUNT(*) as total 
      FROM transpins t
      LEFT JOIN packages p ON p.id = t.package_id
      WHERE t.allot_uid = 0 AND t.status = 0
    `;
    let dataQuery = `
      SELECT 
        t.id,
        t.pin_code,
        t.package_id,
        t.price,
        t.status,
        t.created_at,
        t.updated_at,
        COALESCE(p.title, 'Standard Credit') as package_title,
        p.price as package_price
      FROM transpins t
      LEFT JOIN packages p ON p.id = t.package_id
      WHERE t.allot_uid = 0 AND t.status = 0
    `;

    const queryParams: any[] = [];
    if (search) {
      const searchClause = ` AND (t.pin_code LIKE ? OR p.title LIKE ?)`;
      countQuery += searchClause;
      dataQuery += searchClause;
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    dataQuery += ` ORDER BY t.id DESC LIMIT ? OFFSET ?`;

    const [countRows]: any = await pool.query(countQuery, queryParams);
    const total = countRows[0]?.total || 0;

    const [rows]: any = await pool.query(dataQuery, [...queryParams, limit, offset]);

    res.json({
      success: true,
      data: rows.map((r: any) => ({
        id: r.id,
        pinCode: r.pin_code,
        packageId: r.package_id,
        packageTitle: r.package_title,
        price: Number(r.price) || 0,
        status: r.status, // 0 = Available, 1 = Used
        createdAt: r.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error('[CreditController] getUnallottedCredits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch unallotted credits' });
  }
}

/**
 * POST /api/admin/credits/generate
 * Mint new unallotted credits based on selected package
 */
export async function generateCredits(req: Request, res: Response): Promise<void> {
  const connection = await pool.getConnection();
  try {
    const { package_id, quantity = 1 } = req.body;
    const pkgId = parseInt(package_id, 10);
    const qty = Math.min(100, Math.max(1, parseInt(quantity, 10) || 1));

    if (!pkgId) {
      res.status(400).json({ success: false, message: 'Please select an entry package tier.' });
      return;
    }

    // Verify package
    const [pkgRows]: any = await connection.query(
      'SELECT id, title, price, status FROM packages WHERE id = ? AND status = 1 LIMIT 1',
      [pkgId]
    );

    if (!pkgRows || pkgRows.length === 0) {
      res.status(400).json({ success: false, message: 'The selected package is invalid or inactive.' });
      return;
    }

    const pkg = pkgRows[0];
    const pinPrice = Math.round(Number(pkg.price) * 0.10 * 100) / 100;
    const adminId = (req as any).admin?.id || 1;

    await connection.beginTransaction();

    const createdCodes: string[] = [];
    const now = new Date();

    for (let i = 0; i < qty; i++) {
      // Generate collision-free code
      let isUnique = false;
      let pinCode = '';
      while (!isUnique) {
        pinCode = generatePinCode();
        const [existing]: any = await connection.query(
          'SELECT id FROM transpins WHERE pin_code = ? LIMIT 1',
          [pinCode]
        );
        if (!existing || existing.length === 0) {
          isUnique = true;
        }
      }

      await connection.query(
        `INSERT INTO transpins (pin_code, uid, allot_uid, package_id, price, status, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, 0, ?, ?)`,
        [pinCode, adminId, pkg.id, pinPrice, now, now]
      );
      createdCodes.push(pinCode);
    }

    await connection.commit();

    res.json({
      success: true,
      message: `Successfully generated ${qty} Credit(s) for tier '${pkg.title}' ($${pinPrice.toFixed(2)} each).`,
      count: qty,
      data: createdCodes,
    });
  } catch (error: any) {
    await connection.rollback();
    console.error('[CreditController] generateCredits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error generating credits' });
  } finally {
    connection.release();
  }
}

/**
 * DELETE /api/admin/credits/:id
 * Remove an unused, unallotted credit
 */
export async function deleteCredit(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      res.status(400).json({ success: false, message: 'Invalid credit ID' });
      return;
    }

    const [result]: any = await pool.query(
      'DELETE FROM transpins WHERE id = ? AND allot_uid = 0 AND status = 0',
      [id]
    );

    if (result.affectedRows === 0) {
      res.status(400).json({
        success: false,
        message: 'Unable to remove credit: credit does not exist or has already been used/allotted.',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Credit removed successfully.',
    });
  } catch (error: any) {
    console.error('[CreditController] deleteCredit error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to remove credit' });
  }
}

/**
 * GET /api/admin/credits/transferred
 * Transferred Credits Audit Log (transferred_pins.blade.php)
 */
export async function getTransferredCredits(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '15'), 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    let countQuery = `
      SELECT COUNT(*) as total
      FROM transfer_pins tp
      JOIN transpins t ON t.id = tp.pin_id
      LEFT JOIN packages p ON p.id = t.package_id
      LEFT JOIN users u_sender ON u_sender.id = tp.allot_by AND tp.allot_by_type = 'user'
      LEFT JOIN users u_receiver ON u_receiver.id = tp.allot_to
    `;

    let dataQuery = `
      SELECT 
        tp.id,
        tp.pin_id,
        tp.allot_by,
        tp.allot_by_type,
        tp.allot_to,
        tp.created_at as transfer_date,
        t.pin_code,
        t.price,
        t.package_id,
        COALESCE(p.title, 'Standard Pack') as package_name,
        t.status as pin_status,
        CASE 
          WHEN tp.allot_by_type = 'user' THEN u_sender.username 
          ELSE COALESCE(a_sender.username, 'admin') 
        END as sender_username,
        CASE 
          WHEN tp.allot_by_type = 'user' THEN CONCAT(u_sender.first_name, ' ', COALESCE(u_sender.last_name, ''))
          ELSE COALESCE(a_sender.first_name, 'Administrator') 
        END as sender_name,
        u_receiver.username as receiver_username,
        u_receiver.first_name as receiver_first_name,
        u_receiver.last_name as receiver_last_name
      FROM transfer_pins tp
      JOIN transpins t ON t.id = tp.pin_id
      LEFT JOIN packages p ON p.id = t.package_id
      LEFT JOIN admins a_sender ON a_sender.id = tp.allot_by AND (tp.allot_by_type = 'admin' OR tp.allot_by_type IS NULL)
      LEFT JOIN users u_sender ON u_sender.id = tp.allot_by AND tp.allot_by_type = 'user'
      LEFT JOIN users u_receiver ON u_receiver.id = tp.allot_to
    `;

    const queryParams: any[] = [];
    if (search) {
      const searchClause = ` WHERE (t.pin_code LIKE ? OR u_receiver.username LIKE ? OR p.title LIKE ? OR u_sender.username LIKE ?)`;
      countQuery += searchClause;
      dataQuery += searchClause;
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    dataQuery += ` ORDER BY tp.id DESC LIMIT ? OFFSET ?`;

    const [countRows]: any = await pool.query(countQuery, queryParams);
    const total = countRows[0]?.total || 0;

    const [rows]: any = await pool.query(dataQuery, [...queryParams, limit, offset]);

    res.json({
      success: true,
      data: rows.map((r: any) => ({
        id: r.id,
        pinId: r.pin_id,
        pinCode: r.pin_code,
        packageTitle: r.package_name,
        price: Number(r.price) || 0,
        allotByType: r.allot_by_type || 'admin',
        transferredBy: r.sender_username || 'admin',
        transferredByName: r.sender_name || 'Administrator',
        transferredTo: r.receiver_username || `User #${r.allot_to}`,
        transferredToName: [r.receiver_first_name, r.receiver_last_name].filter(Boolean).join(' ') || r.receiver_username,
        transferDate: r.transfer_date,
        pinStatus: r.pin_status, // 0 = Active / Available, 1 = Used
        statusText: r.pin_status === 1 ? 'Used' : 'Active / Available',
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error('[CreditController] getTransferredCredits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch transferred credits' });
  }
}

/**
 * POST /api/admin/credits/transfer
 * Transfer/mint and allot credits directly to a member (transferpin in Laravel)
 */
export async function transferCredits(req: Request, res: Response): Promise<void> {
  const connection = await pool.getConnection();
  try {
    const { username, package_id, quantity = 1 } = req.body;
    const targetUsername = String(username || '').trim();
    const pkgId = parseInt(package_id, 10);
    const qty = Math.min(100, Math.max(1, parseInt(quantity, 10) || 1));

    if (!targetUsername) {
      res.status(400).json({ success: false, message: 'Please enter destination member username or User ID.' });
      return;
    }

    if (!pkgId) {
      res.status(400).json({ success: false, message: 'Please select an entry package tier.' });
      return;
    }

    // 1. Verify user
    const [userRows]: any = await connection.query(
      'SELECT id, username, first_name, last_name, status FROM users WHERE username = ? LIMIT 1',
      [targetUsername]
    );

    if (!userRows || userRows.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Destination member not found. Please enter a valid username.',
      });
      return;
    }

    const member = userRows[0];

    // 2. Verify package
    const [pkgRows]: any = await connection.query(
      'SELECT id, title, price, status FROM packages WHERE id = ? AND status = 1 LIMIT 1',
      [pkgId]
    );

    if (!pkgRows || pkgRows.length === 0) {
      res.status(400).json({ success: false, message: 'The selected package is invalid or inactive.' });
      return;
    }

    const pkg = pkgRows[0];
    const pinPrice = Math.round(Number(pkg.price) * 0.10 * 100) / 100;
    const adminId = (req as any).admin?.id || 1;
    const now = new Date();

    await connection.beginTransaction();

    const createdPins: string[] = [];
    for (let i = 0; i < qty; i++) {
      // Unique pin code
      let isUnique = false;
      let pinCode = '';
      while (!isUnique) {
        pinCode = generatePinCode();
        const [existing]: any = await connection.query(
          'SELECT id FROM transpins WHERE pin_code = ? LIMIT 1',
          [pinCode]
        );
        if (!existing || existing.length === 0) {
          isUnique = true;
        }
      }

      // Insert transpin
      const [insertPinResult]: any = await connection.query(
        `INSERT INTO transpins (pin_code, uid, allot_uid, package_id, price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [pinCode, adminId, member.id, pkg.id, pinPrice, now, now]
      );

      const pinId = insertPinResult.insertId;

      // Insert transfer_pins log
      await connection.query(
        `INSERT INTO transfer_pins (pin_id, allot_by, allot_by_type, allot_to, created_at, updated_at)
         VALUES (?, ?, 'admin', ?, ?, ?)`,
        [pinId, adminId, member.id, now, now]
      );

      createdPins.push(pinCode);
    }

    await connection.commit();

    const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.username;
    res.json({
      success: true,
      message: `Successfully transferred ${qty} Credit(s) for tier '${pkg.title}' ($${pinPrice.toFixed(2)} each) to member ${member.username} (${memberName}).`,
      count: qty,
      data: createdPins,
    });
  } catch (error: any) {
    await connection.rollback();
    console.error('[CreditController] transferCredits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error transferring credits' });
  } finally {
    connection.release();
  }
}

/**
 * GET /api/admin/credits/used
 * Used / Consumed Credits Log (used_pin.blade.php)
 * transpins.status = 1
 */
export async function getUsedCredits(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '15'), 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    let countQuery = `
      SELECT COUNT(*) as total 
      FROM transpins t
      LEFT JOIN packages p ON p.id = t.package_id
      LEFT JOIN users u ON u.id = t.allot_uid
      WHERE t.status = 1
    `;

    let dataQuery = `
      SELECT 
        t.id,
        t.pin_code,
        t.price,
        t.status,
        t.allot_uid,
        t.created_at,
        t.updated_at,
        COALESCE(p.title, 'Standard Credit') as package_title,
        u.username,
        u.first_name,
        u.last_name
      FROM transpins t
      LEFT JOIN packages p ON p.id = t.package_id
      LEFT JOIN users u ON u.id = t.allot_uid
      WHERE t.status = 1
    `;

    const queryParams: any[] = [];
    if (search) {
      const searchClause = ` AND (t.pin_code LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
      countQuery += searchClause;
      dataQuery += searchClause;
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    dataQuery += ` ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`;

    const [countRows]: any = await pool.query(countQuery, queryParams);
    const total = countRows[0]?.total || 0;

    const [rows]: any = await pool.query(dataQuery, [...queryParams, limit, offset]);

    res.json({
      success: true,
      data: rows.map((r: any) => ({
        id: r.id,
        pinCode: r.pin_code,
        price: Number(r.price) || 0,
        consumedByUsername: r.username || (r.allot_uid ? `User #${r.allot_uid}` : 'System / Admin'),
        consumedByFullName: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.username ? r.username : 'System / Admin'),
        status: 'Consumed',
        updatedAt: r.updated_at || r.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error('[CreditController] getUsedCredits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch used credits' });
  }
}
