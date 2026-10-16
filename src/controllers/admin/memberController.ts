import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import { hashPassword } from '../../utils/password.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getUserUploadsDir } from '../../config/uploadConfig.js';

/**
 * GET /api/admin/members/countries
 * Fetch list of countries for filter dropdown
 */
export async function getCountries(req: Request, res: Response): Promise<void> {
  try {
    const [rows]: any = await pool.query(
      'SELECT id, name, iso FROM country ORDER BY name ASC'
    );
    res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    console.error('[MemberController] getCountries error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch countries' });
  }
}

/**
 * GET /api/admin/members
 * List members with server-side filtering, search, and pagination
 * (Mirrors Laravel registered_users / inactive_users / blocked_members / ban_users)
 */
export async function getMembers(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.query.type || 'active').toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '15'), 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || req.query.uname || '').trim();
    const country = req.query.country ? String(req.query.country).trim() : '';

    // 1. Calculate overall counts for headers and badges
    const [statsRows]: any = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END) as inactive_count,
        SUM(CASE WHEN is_block = 'yes' OR wallet_blocked = 'yes' THEN 1 ELSE 0 END) as blocked_count,
        SUM(CASE WHEN is_suspend = 'yes' THEN 1 ELSE 0 END) as suspended_count
      FROM users
    `);
    const stats = statsRows[0] || {};
    const counts = {
      all: Number(stats.total_count) || 0,
      active: Number(stats.active_count) || 0,
      inactive: Number(stats.inactive_count) || 0,
      blocked: Number(stats.blocked_count) || 0,
      suspended: Number(stats.suspended_count) || 0,
    };

    // 2. Build filter conditions based on type
    const whereConditions: string[] = [];
    const queryParams: any[] = [];

    if (type === 'active') {
      whereConditions.push('u.status = 1');
    } else if (type === 'inactive') {
      whereConditions.push('u.status != 1');
    } else if (type === 'blocked') {
      whereConditions.push("(u.is_block = 'yes' OR u.wallet_blocked = 'yes')");
    } else if (type === 'suspended' || type === 'banned') {
      whereConditions.push("u.is_suspend = 'yes'");
    }
    // If type === 'all', no status condition

    // Search keyword condition (username, email, phone, name)
    if (search) {
      whereConditions.push(`(
        u.username LIKE ? OR 
        u.email LIKE ? OR 
        u.phone_no LIKE ? OR 
        u.first_name LIKE ? OR 
        u.last_name LIKE ? OR 
        CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      queryParams.push(term, term, term, term, term, term);
    }

    // Country filter
    if (country) {
      whereConditions.push('(u.country = ? OR c.name = ?)');
      queryParams.push(country, country);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 3. Count total records matching filter
    const countQuery = `
      SELECT COUNT(*) as total
      FROM users u
      LEFT JOIN country c ON c.id = u.country
      ${whereClause}
    `;
    const [countRows]: any = await pool.query(countQuery, queryParams);
    const total = countRows[0]?.total || 0;

    // 4. Fetch paginated records with sponsor and package details
    const dataQuery = `
      SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_no,
        u.status,
        u.image,
        u.is_block,
        u.is_suspend,
        u.wallet_blocked,
        u.created_at,
        u.country as country_id,
        u.referral_id,
        sponsor.username as sponsor_username,
        sponsor.first_name as sponsor_first_name,
        sponsor.last_name as sponsor_last_name,
        COALESCE(p.title, '-') as rank_name,
        COALESCE(c.name, '') as country_name,
        COALESCE(uw.balance, 0) as wallet_balance
      FROM users u
      LEFT JOIN users sponsor ON sponsor.id = u.referral_id
      LEFT JOIN packages p ON p.id = u.registration_package_id
      LEFT JOIN country c ON c.id = u.country
      LEFT JOIN user_wallets uw ON uw.user_id = u.id
      ${whereClause}
      ORDER BY u.id DESC
      LIMIT ? OFFSET ?
    `;

    const [rows]: any = await pool.query(dataQuery, [...queryParams, limit, offset]);

    res.json({
      success: true,
      counts,
      data: rows.map((r: any, idx: number) => {
        const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username;
        const sponsorName = [r.sponsor_first_name, r.sponsor_last_name].filter(Boolean).join(' ') || '-';
        return {
          id: r.id,
          srNo: offset + idx + 1,
          image: r.image || 'default.png',
          username: r.username,
          name: fullName,
          firstName: r.first_name || '',
          lastName: r.last_name || '',
          email: r.email,
          phone: r.phone_no || '-',
          sponsorId: r.sponsor_username || '-',
          sponsorName: sponsorName,
          rankName: r.rank_name || '-',
          status: r.status === 1 ? 'Active' : 'Inactive',
          statusCode: r.status,
          isBlocked: r.is_block === 'yes' || r.wallet_blocked === 'yes',
          isSuspended: r.is_suspend === 'yes',
          registerDate: r.created_at,
          country: r.country_name || '-',
          countryId: r.country_id,
          walletBalance: Number(r.wallet_balance) || 0,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error('[MemberController] getMembers error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch members' });
  }
}

/**
 * POST /api/admin/members/status
 * Toggle member status: block/unblock, suspend/unsuspend, activate/deactivate
 * (Matching admin.user.status in Laravel)
 */
export async function updateMemberStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id, action, status } = req.body;
    const userId = parseInt(id, 10);

    if (!userId) {
      res.status(400).json({ success: false, message: 'Invalid member ID' });
      return;
    }

    const [userRows]: any = await pool.query(
      'SELECT id, username, is_block, is_suspend, wallet_blocked, status FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!userRows || userRows.length === 0) {
      res.status(404).json({ success: false, message: 'Member not found' });
      return;
    }

    const user = userRows[0];
    let msg = '';

    // Handle by explicit action string or legacy numeric status
    // status: 2 = block/unblock, status: 3 = suspend/unsuspend
    if (action === 'block' || status == 2) {
      const willBlock = action === 'block' || (action !== 'unblock' && user.is_block !== 'yes');
      const val = willBlock ? 'yes' : 'no';
      await pool.query(
        'UPDATE users SET is_block = ?, wallet_blocked = ? WHERE id = ?',
        [val, val, userId]
      );
      msg = `Account ${user.username} has been ${willBlock ? 'blocked' : 'unblocked'} successfully.`;
    } else if (action === 'unblock') {
      await pool.query(
        "UPDATE users SET is_block = 'no', wallet_blocked = 'no' WHERE id = ?",
        [userId]
      );
      msg = `Account ${user.username} has been unblocked successfully.`;
    } else if (action === 'suspend' || status == 3) {
      const willSuspend = action === 'suspend' || (action !== 'unsuspend' && user.is_suspend !== 'yes');
      const val = willSuspend ? 'yes' : 'no';
      await pool.query('UPDATE users SET is_suspend = ? WHERE id = ?', [val, userId]);
      msg = `Account ${user.username} has been ${willSuspend ? 'suspended' : 'unsuspended'} successfully.`;
    } else if (action === 'unsuspend') {
      await pool.query("UPDATE users SET is_suspend = 'no' WHERE id = ?", [userId]);
      msg = `Account ${user.username} has been unsuspended successfully.`;
    } else if (action === 'toggle_active') {
      const newStatus = user.status === 1 ? 0 : 1;
      await pool.query('UPDATE users SET status = ? WHERE id = ?', [newStatus, userId]);
      msg = `Account ${user.username} status changed to ${newStatus === 1 ? 'Active' : 'Inactive'}.`;
    } else {
      res.status(400).json({ success: false, message: 'Invalid action requested' });
      return;
    }

    res.json({
      success: true,
      valid: 1,
      msg,
      message: msg,
    });
  } catch (error: any) {
    console.error('[MemberController] updateMemberStatus error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update member status' });
  }
}

/**
 * POST /api/admin/members/password
 * Update login password or transaction password
 * (Matching updatePassForm in Laravel)
 */
export async function updateMemberPassword(req: Request, res: Response): Promise<void> {
  try {
    const { user_id, password_type = 'password', new_password, new_pass } = req.body;
    const userId = parseInt(user_id, 10);
    const pass = String(new_password || new_pass || '').trim();

    if (!userId) {
      res.status(400).json({ success: false, message: 'Invalid member ID' });
      return;
    }

    if (!pass || pass.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
      return;
    }

    const [userRows]: any = await pool.query(
      'SELECT id, username FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!userRows || userRows.length === 0) {
      res.status(404).json({ success: false, message: 'Member not found' });
      return;
    }

    const user = userRows[0];
    const hashedPassword = await hashPassword(pass);

    const column = password_type === 'transaction_password' ? 'transaction_password' : 'password';
    await pool.query(`UPDATE users SET ${column} = ? WHERE id = ?`, [hashedPassword, userId]);

    const typeLabel = password_type === 'transaction_password' ? 'Transaction password' : 'Login password';
    res.json({
      success: true,
      message: `${typeLabel} updated successfully for ${user.username}.`,
    });
  } catch (error: any) {
    console.error('[MemberController] updateMemberPassword error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update password' });
  }
}

/**
 * POST /api/admin/members/impersonate
 * Admin login as member (session creation)
 */
export async function impersonateMember(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.body;
    const userId = parseInt(id, 10);

    if (!userId) {
      res.status(400).json({ success: false, message: 'Invalid member ID' });
      return;
    }

    const [userRows]: any = await pool.query(
      'SELECT id, username, first_name, last_name, email, status, is_block, is_suspend FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!userRows || userRows.length === 0) {
      res.status(404).json({ success: false, message: 'Member not found' });
      return;
    }

    const user = userRows[0];
    const secret = process.env.USER_JWT_SECRET || process.env.JWT_SECRET || 'openaid_super_secret_jwt_key_2026_secure';

    const userToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        type: 'user',
        impersonatedByAdmin: true,
      },
      secret,
      { expiresIn: '2h' }
    );

    res.json({
      success: true,
      message: `Impersonation session created for ${user.username}`,
      token: userToken,
      user: {
        id: user.id,
        username: user.username,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
        email: user.email,
      },
      redirectUrl: '/user/dashboard',
    });
  } catch (error: any) {
    console.error('[MemberController] impersonateMember error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to impersonate member' });
  }
}

// Helper to save base64 user avatar to backend/uploads/user/
function saveBase64UserAvatar(base64Data: string): string | null {
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
    const userDir = getUserUploadsDir();
    fs.writeFileSync(path.join(userDir, fileName), buffer);
    return fileName;
  } catch (err) {
    console.error('[User Avatar Save Error]', err);
    return null;
  }
}

/**
 * GET /api/admin/members/:id/profile
 * Fetch comprehensive profile details for a member (Mirrors Laravel profile.blade.php & update_profile.blade.php)
 */
export async function getMemberProfile(req: Request, res: Response): Promise<void> {
  try {
    const userId = parseInt(String(req.params.id), 10);
    if (!userId) {
      res.status(400).json({ success: false, message: 'Invalid member ID' });
      return;
    }

    const [userRows]: any = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_no,
        u.country as country_id,
        u.image,
        u.status,
        u.is_block,
        u.is_suspend,
        u.wallet_blocked,
        u.is_kyc,
        u.created_at,
        c.name as country_name,
        c.iso as country_iso,
        p.title as rank_name,
        p.price as package_price,
        sponsor.id as sponsor_id,
        sponsor.username as sponsor_username,
        sponsor.first_name as sponsor_first_name,
        sponsor.last_name as sponsor_last_name,
        upd.address,
        upd.city,
        upd.state,
        upd.district,
        upd.nric_number,
        upd.nric_image,
        upd.bank_name,
        upd.bank_branch,
        upd.account_no,
        upd.account_holder_name,
        upd.account_type,
        upd.bank_code,
        COALESCE(uw.balance, 0) as wallet_balance
      FROM users u
      LEFT JOIN country c ON c.id = u.country
      LEFT JOIN packages p ON p.id = u.registration_package_id
      LEFT JOIN users sponsor ON sponsor.id = u.referral_id
      LEFT JOIN user_personal_details upd ON upd.user_id = u.id
      LEFT JOIN user_wallets uw ON uw.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `, [userId]);

    if (!userRows || userRows.length === 0) {
      res.status(404).json({ success: false, message: 'Member not found' });
      return;
    }

    const u = userRows[0];

    // Count direct referrals
    const [refRows]: any = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE referral_id = ?',
      [userId]
    );
    const directReferrals = Number(refRows[0]?.count) || 0;

    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;
    const sponsorName = [u.sponsor_first_name, u.sponsor_last_name].filter(Boolean).join(' ') || '-';

    res.json({
      success: true,
      data: {
        id: u.id,
        username: u.username,
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        name: fullName,
        email: u.email,
        phone: u.phone_no || '',
        countryId: u.country_id,
        countryName: u.country_name || '-',
        countryIso: u.country_iso || '',
        image: u.image || 'default.png',
        imageUrl: u.image ? (u.image.startsWith('http') ? u.image : `/uploads/user/${u.image}`) : null,
        status: u.status === 1 ? 'Active' : 'Inactive',
        statusCode: u.status,
        isBlocked: u.is_block === 'yes' || u.wallet_blocked === 'yes',
        isSuspended: u.is_suspend === 'yes',
        isKyc: u.is_kyc,
        createdAt: u.created_at,
        rankName: u.rank_name || 'Member',
        packagePrice: u.package_price,
        walletBalance: Number(u.wallet_balance) || 0,
        directReferrals,
        sponsorId: u.sponsor_username || '-',
        sponsorName: sponsorName,
        // KYC / Personal
        address: u.address || '',
        city: u.city || '',
        state: u.state || '',
        district: u.district || '',
        nricNumber: u.nric_number || '',
        nricImage: u.nric_image ? `/uploads/kyc_doc/${u.nric_image}` : null,
        // Bank details
        bankName: u.bank_name || '',
        bankBranch: u.bank_branch || '',
        accountNo: u.account_no || '',
        accountHolderName: u.account_holder_name || '',
        accountType: u.account_type || '',
        bankCode: u.bank_code || '',
      },
    });
  } catch (error: any) {
    console.error('[MemberController] getMemberProfile error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch member profile' });
  }
}

/**
 * PUT /api/admin/members/:id/profile
 * Update member personal and bank details (Mirrors Laravel profile_update)
 */
export async function updateMemberProfile(req: Request, res: Response): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const userId = parseInt(String(req.params.id), 10);
    if (!userId) {
      res.status(400).json({ success: false, message: 'Invalid member ID' });
      return;
    }

    const {
      first_name,
      last_name,
      email,
      phone_no,
      country,
      address,
      image, // base64 string or filename
      city,
      state,
      district,
      bank_name,
      bank_branch,
      account_no,
      account_holder_name,
      account_type,
      bank_code,
      nric_number,
    } = req.body;

    if (!first_name || !String(first_name).trim()) {
      res.status(400).json({ success: false, message: 'First name is required.' });
      return;
    }
    if (!email || !String(email).trim()) {
      res.status(400).json({ success: false, message: 'Email address is required.' });
      return;
    }

    // Check email uniqueness among other users
    const [existingUsers]: any = await conn.query(
      'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
      [String(email).trim(), userId]
    );
    if (existingUsers && existingUsers.length > 0) {
      res.status(400).json({ success: false, message: 'Email address is already in use by another account.' });
      return;
    }

    // Process image if base64 provided
    let savedImageFileName: string | null = null;
    if (image && typeof image === 'string' && image.startsWith('data:image')) {
      savedImageFileName = saveBase64UserAvatar(image);
    }

    await conn.beginTransaction();

    // 1. Update users table
    const updateUserFields: string[] = [
      'first_name = ?',
      'last_name = ?',
      'email = ?',
      'phone_no = ?',
    ];
    const updateUserParams: any[] = [
      String(first_name).trim(),
      last_name ? String(last_name).trim() : null,
      String(email).trim(),
      phone_no ? String(phone_no).trim() : null,
    ];

    if (country) {
      updateUserFields.push('country = ?');
      updateUserParams.push(country);
    }

    if (savedImageFileName) {
      updateUserFields.push('image = ?');
      updateUserParams.push(savedImageFileName);
    }

    updateUserParams.push(userId);
    await conn.query(
      `UPDATE users SET ${updateUserFields.join(', ')} WHERE id = ?`,
      updateUserParams
    );

    // 2. Update or insert into user_personal_details
    const [existingDetails]: any = await conn.query(
      'SELECT id FROM user_personal_details WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (existingDetails && existingDetails.length > 0) {
      await conn.query(`
        UPDATE user_personal_details SET
          address = COALESCE(?, address),
          country = COALESCE(?, country),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          district = COALESCE(?, district),
          bank_name = COALESCE(?, bank_name),
          bank_branch = COALESCE(?, bank_branch),
          account_no = COALESCE(?, account_no),
          account_holder_name = COALESCE(?, account_holder_name),
          account_type = COALESCE(?, account_type),
          bank_code = COALESCE(?, bank_code),
          nric_number = COALESCE(?, nric_number),
          updated_at = NOW()
        WHERE user_id = ?
      `, [
        address ?? null,
        country ?? null,
        city ?? null,
        state ?? null,
        district ?? null,
        bank_name ?? null,
        bank_branch ?? null,
        account_no ?? null,
        account_holder_name ?? null,
        account_type ?? null,
        bank_code ?? null,
        nric_number ?? null,
        userId,
      ]);
    } else {
      await conn.query(`
        INSERT INTO user_personal_details (
          user_id, address, country, city, state, district,
          bank_name, bank_branch, account_no, account_holder_name, account_type, bank_code, nric_number,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [
        userId,
        address ?? null,
        country ?? null,
        city ?? null,
        state ?? null,
        district ?? null,
        bank_name ?? null,
        bank_branch ?? null,
        account_no ?? null,
        account_holder_name ?? null,
        account_type ?? null,
        bank_code ?? null,
        nric_number ?? null,
      ]);
    }

    await conn.commit();

    res.json({
      success: true,
      valid: true,
      message: 'Profile updated successfully',
      msg: 'Profile updated successfully',
      image: savedImageFileName,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error('[MemberController] updateMemberProfile error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update profile' });
  } finally {
    conn.release();
  }
}

