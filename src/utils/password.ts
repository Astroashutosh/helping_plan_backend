import bcrypt from 'bcryptjs';

/**
 * Compare plain text password against bcrypt hash.
 * Automatically normalizes PHP/Laravel's $2y$ prefix to $2a$ for bcryptjs compatibility.
 */
export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  const normalizedHash = hash.replace(/^\$2y\$/, '$2a$');
  return bcrypt.compare(plain, normalizedHash);
}

/**
 * Hash a plain text password using bcrypt.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}
