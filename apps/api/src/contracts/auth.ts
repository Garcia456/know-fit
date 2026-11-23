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

/** 注册验证码 —— 6 位数字，先发到邮箱再随注册提交 */
export const RegistrationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, '验证码是 6 位数字');

/** 注册页「获取验证码」：邮箱决定验证码发给谁 */
export const RegisterCodeSchema = z.object({
  email: EmailSchema,
});

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  nickname: NicknameSchema,
  /** 没有邮箱验证码就不能完成注册 */
  code: RegistrationCodeSchema,
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
  /** 是否已用邀请码解锁知识库 —— 设置页据此显示锁定 / 已开启 */
  invite_unlocked: z.boolean(),
  /** 邮箱是否验证通过 —— 免费额度只在验证后发放 */
  email_verified: z.boolean(),
  /** 已验证账号已用掉的免费对话次数；与 limit 一起给设置页展示 */
  free_turns_used: z.number().int().nonnegative(),
  /** 服务端配置的免费次数上限 —— 展示用，不参与客户端判定 */
  free_turns_limit: z.number().int().positive(),
  created_at: z.string(),
});

/** 设置页填邀请码解锁知识库 */
export const KnowledgeAccessInputSchema = z.object({
  invite_code: z.string().trim().min(1, '需要邀请码').max(128),
});

/** 邮件里的验证链接带回的一次性令牌 */
export const VerifyEmailSchema = z.object({
  token: z.string().trim().min(1, '需要验证令牌').max(256),
});

/** 保存自带 Key —— 模型必须在服务端白名单内；Key 只进请求，绝不回显 */
export const AiKeyInputSchema = z.object({
  api_key: z.string().trim().min(8, 'API Key 太短').max(200, 'API Key 太长'),
  model: z.string().trim().min(1, '需要模型名').max(64),
});

/** 已保存 Key 的展示信息 —— 只有末 4 位，够确认「填的是哪一把」 */
export const AiKeySummarySchema = z.object({
  configured: z.boolean(),
  model: z.string(),
  hint: z.string(),
  updated_at: z.string(),
});

/** 设置页「AI 模型」分区一次取全：资格 + 额度 + Key 状态 + 可选模型 */
export const AccountAiSchema = z.object({
  email_verified: z.boolean(),
  invite_unlocked: z.boolean(),
  quota: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
  }),
  key: AiKeySummarySchema.nullable(),
  models: z.array(z.string()),
});

export const UserResponseSchema = z.object({
  user: UserSchema,
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type RegisterCodeInput = z.infer<typeof RegisterCodeSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type AccountInput = z.infer<typeof AccountInputSchema>;
export type KnowledgeAccessInput = z.infer<typeof KnowledgeAccessInputSchema>;
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
export type AiKeyInput = z.infer<typeof AiKeyInputSchema>;
export type AiKeySummary = z.infer<typeof AiKeySummarySchema>;
export type AccountAi = z.infer<typeof AccountAiSchema>;
export type User = z.infer<typeof UserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;