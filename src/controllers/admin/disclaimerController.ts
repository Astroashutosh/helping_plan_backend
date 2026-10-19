// import type { Request, Response } from "express";
// import type { RowDataPacket, ResultSetHeader } from "mysql2";
// import { pool } from "../../config/db.js";

// export async function getPublicDisclaimer(req: Request, res: Response) {
//   try {
//     const [rows] = await pool.query<RowDataPacket[]>(
//       `SELECT id, section_key, title, content, icon, sort_order
//        FROM disclaimer_sections
//        WHERE is_active = 1
//        ORDER BY sort_order ASC, id ASC`
//     );
//     return res.json({ success: true, data: rows });
//   } catch (error) {
//     console.error("[Disclaimer CMS] public list error:", error);
//     return res.status(500).json({ success: false, message: "Unable to load disclaimer content" });
//   }
// }

// export async function listDisclaimerAdmin(req: Request, res: Response) {
//   try {
//     const [rows] = await pool.query<RowDataPacket[]>(
//       `SELECT id, section_key, title, content, icon, sort_order, is_active, created_at, updated_at
//        FROM disclaimer_sections
//        ORDER BY sort_order ASC, id ASC`
//     );
//     return res.json({ success: true, data: rows });
//   } catch (error) {
//     console.error("[Disclaimer CMS] admin list error:", error);
//     return res.status(500).json({ success: false, message: "Unable to load disclaimer sections" });
//   }
// }

// export async function createDisclaimerSection(req: Request, res: Response) {
//   const { section_key, title, content, icon = "FileText", sort_order = 0, is_active = 1 } = req.body ?? {};
//   if (!section_key || !title || !content) {
//     return res.status(400).json({ success: false, message: "section_key, title and content are required" });
//   }
//   try {
//     const [result] = await pool.query<ResultSetHeader>(
//       `INSERT INTO disclaimer_sections (section_key, title, content, icon, sort_order, is_active)
//        VALUES (?, ?, ?, ?, ?, ?)`,
//       [String(section_key).trim(), String(title).trim(), String(content).trim(), String(icon), Number(sort_order) || 0, is_active ? 1 : 0]
//     );
//     return res.status(201).json({ success: true, id: result.insertId, message: "Disclaimer section created" });
//   } catch (error: any) {
//     if (error?.code === "ER_DUP_ENTRY") {
//       return res.status(409).json({ success: false, message: "section_key must be unique" });
//     }
//     console.error("[Disclaimer CMS] create error:", error);
//     return res.status(500).json({ success: false, message: "Unable to create disclaimer section" });
//   }
// }

// export async function updateDisclaimerSection(req: Request, res: Response) {
//   const id = Number(req.params.id);
//   const { section_key, title, content, icon = "FileText", sort_order = 0, is_active = 1 } = req.body ?? {};
//   if (!Number.isInteger(id) || id <= 0 || !section_key || !title || !content) {
//     return res.status(400).json({ success: false, message: "Valid id, section_key, title and content are required" });
//   }
//   try {
//     const [result] = await pool.query<ResultSetHeader>(
//       `UPDATE disclaimer_sections
//        SET section_key = ?, title = ?, content = ?, icon = ?, sort_order = ?, is_active = ?
//        WHERE id = ?`,
//       [String(section_key).trim(), String(title).trim(), String(content).trim(), String(icon), Number(sort_order) || 0, is_active ? 1 : 0, id]
//     );
//     if (!result.affectedRows) return res.status(404).json({ success: false, message: "Section not found" });
//     return res.json({ success: true, message: "Disclaimer section updated" });
//   } catch (error: any) {
//     if (error?.code === "ER_DUP_ENTRY") {
//       return res.status(409).json({ success: false, message: "section_key must be unique" });
//     }
//     console.error("[Disclaimer CMS] update error:", error);
//     return res.status(500).json({ success: false, message: "Unable to update disclaimer section" });
//   }
// }

// export async function deleteDisclaimerSection(req: Request, res: Response) {
//   const id = Number(req.params.id);
//   if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "Invalid section id" });
//   try {
//     const [result] = await pool.query<ResultSetHeader>(
//       `DELETE FROM disclaimer_sections WHERE id = ?`,
//       [id]
//     );
//     if (!result.affectedRows) return res.status(404).json({ success: false, message: "Section not found" });
//     return res.json({ success: true, message: "Disclaimer section deleted" });
//   } catch (error) {
//     console.error("[Disclaimer CMS] delete error:", error);
//     return res.status(500).json({ success: false, message: "Unable to delete disclaimer section" });
//   }
// }











import type { Request, Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "../../config/db.js";

const VALID_SECTION_KEYS = ["notice", "description"] as const;

function validSectionKey(value: unknown): value is "notice" | "description" {
  return typeof value === "string" &&
    VALID_SECTION_KEYS.includes(value as "notice" | "description");
}

// PUBLIC: GET /api/disclaimer
export async function getPublicDisclaimer(_req: Request, res: Response) {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, section_key, label, title, content, icon
       FROM disclaimer_sections
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[Disclaimer CMS] Public list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load disclaimer content",
    });
  }
}

// ADMIN: GET /api/admin/disclaimer
export async function listDisclaimerAdmin(_req: Request, res: Response) {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, section_key, label, title, content, icon,
              sort_order, is_active, created_at, updated_at
       FROM disclaimer_sections
       ORDER BY sort_order ASC, id ASC`
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("[Disclaimer CMS] Admin list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load disclaimer sections",
    });
  }
}

// ADMIN: POST /api/admin/disclaimer
export async function createDisclaimerSection(req: Request, res: Response) {
  const {
    section_key,
    label = "",
    title,
    content,
    icon = "FileText",
  } = req.body ?? {};

  if (
    !validSectionKey(section_key) ||
    typeof label !== "string" ||
    typeof title !== "string" || !title.trim() ||
    typeof content !== "string" || !content.trim() ||
    typeof icon !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Choose Notice or Description and provide valid title and content",
    });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO disclaimer_sections
         (section_key, label, title, content, icon, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, 0, 1)`,
      [
        section_key,
        label.trim(),
        title.trim(),
        content.trim(),
        icon.trim() || "FileText",
      ]
    );

    return res.status(201).json({
      success: true,
      id: result.insertId,
      message: "Disclaimer section created successfully",
    });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "This section type already exists because section_key has a unique database constraint. Remove that constraint if multiple sections of the same type are required.",
      });
    }

    console.error("[Disclaimer CMS] Create error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create disclaimer section",
    });
  }
}

// ADMIN: PUT /api/admin/disclaimer/:id
export async function updateDisclaimerSection(req: Request, res: Response) {
  const id = Number(req.params.id);
  const {
    section_key,
    label = "",
    title,
    content,
    icon = "FileText",
  } = req.body ?? {};

  if (
    !Number.isInteger(id) || id <= 0 ||
    !validSectionKey(section_key) ||
    typeof label !== "string" ||
    typeof title !== "string" || !title.trim() ||
    typeof content !== "string" || !content.trim() ||
    typeof icon !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Valid id, section type, title and content are required",
    });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE disclaimer_sections
       SET section_key = ?, label = ?, title = ?, content = ?, icon = ?
       WHERE id = ?`,
      [
        section_key,
        label.trim(),
        title.trim(),
        content.trim(),
        icon.trim() || "FileText",
        id,
      ]
    );

    if (result.affectedRows === 0) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM disclaimer_sections WHERE id = ?",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Disclaimer section not found",
        });
      }
    }

    return res.json({
      success: true,
      message: "Disclaimer section updated successfully",
    });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This section type conflicts with a unique database constraint.",
      });
    }

    console.error("[Disclaimer CMS] Update error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update disclaimer section",
    });
  }
}

// ADMIN: DELETE /api/admin/disclaimer/:id
export async function deleteDisclaimerSection(req: Request, res: Response) {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid disclaimer section id",
    });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM disclaimer_sections WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Disclaimer section not found",
      });
    }

    return res.json({
      success: true,
      message: "Disclaimer section deleted successfully",
    });
  } catch (error) {
    console.error("[Disclaimer CMS] Delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete disclaimer section",
    });
  }
}
