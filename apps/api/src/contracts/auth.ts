import { z } from 'zod';

/**
 * 认证与账号资料的对外契约。
 * 🔴 响应里没有 password_hash / token —— 这两个字段只进库。
 */

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '生日需为 YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), '生日不是有效日期');

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '邮箱格式不对');

export const PasswordSchema = z.string().min(8, '密码至少 8 位').max(128);

export const NicknameSchema = z.string().trim().min(1, '昵称不能为空').max(20, '昵称最多 20 字');

export const GenderSchema = z.enum(['男', '女', '其他']).nullable();

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  nickname: NicknameSchema,
});

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

/** 头像只收压缩后的图片 data URL —— 不接受外链与任意字符串 */
export const AvatarSchema = z
  .string()
  .max(200_000, '头像太大')
  .regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, '头像需要是图片 data URL')
  .nullable();

/** 账号资料可改的只有这几个；邮箱注册后不可改。 */
export const AccountInputSchema = z.object({
  nickname: NicknameSchema,
  birthday: DateSchema.nullable(),
  gender: GenderSchema,
  bio: z.string().trim().max(80, '个性签名最多 80 字').nullable(),
  /** 不传 = 不改头像（老客户端兼容） */
  avatar: AvatarSchema.optional(),
});

/** 生日不存年龄：读时按自然年算。 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  nickname: z.string(),
  birthday: DateSchema.nullable(),
  gender: GenderSchema,
  bio: z.string().nullable(),
  avatar: z.string().nullable(),
  age: z.number().int().min(0).max(150).nullable(),
  created_at: z.string(),
});

export const UserResponseSchema = z.object({
  user: UserSchema,
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type AccountInput = z.infer<typeof AccountInputSchema>;
export type User = z.infer<typeof UserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;