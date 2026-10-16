import { Request, Response } from 'express';
import { pool } from '../../config/db.js';

/**
 * Public General Settings Controller
 * Returns platform branding, logo, web title, and currency configuration from 'generals' table
 */
export async function getGeneralSettings(req: Request, res: Response) {
  try {
    const [rows]: any = await pool.query('SELECT * FROM generals LIMIT 1');
    const general = rows && rows.length > 0 ? rows[0] : null;

    if (!general) {
      return res.status(200).json({
        success: true,
        data: {
          web_title: 'OpenAid International',
          currency: 'USD',
          symbol: '$',
          logo: '1789125598_logo.png',
          logo_url: '/uploads/logo/1789125598_logo.png',
          favicon: '1789125724_favicon.png',
          favicon_url: '/uploads/logo/1789125724_favicon.png',
          footer_content: 'OpenAid International • Helping Community',
        },
      });
    }

    const logoFile = general.logo || general.logo2 || '1789125598_logo.png';
    const faviconFile = general.icon || '1789125724_favicon.png';

    res.status(200).json({
      success: true,
      data: {
        id: general.id,
        web_title: general.web_title || 'OpenAid International',
        currency: general.currency || 'USD',
        symbol: general.symbol || '$',
        logo: logoFile,
        logo_url: `/uploads/logo/${logoFile}`,
        favicon: faviconFile,
        favicon_url: `/uploads/logo/${faviconFile}`,
        min_withdraw: general.min_withdraw || 10,
        max_withdraw: general.max_withdraw || 10000,
        withdraw_fee: general.withdraw_fee || 5,
        min_deposit: general.min_deposit || 10,
        footer_content: general.footer_content || 'OpenAid International • Helping Community',
        company_usdt_address: general.company_usdt_address || null,
        company_withdraw_usdt_address: general.company_withdraw_usdt_address || null,
      },
    });
  } catch (error: any) {
    console.error('[General Settings Error]', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve general settings.',
    });
  }
}
