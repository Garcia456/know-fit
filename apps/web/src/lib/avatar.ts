/** 头像：本地读图 → 圆形取景框调整 → 裁成 256px JPEG data URL —— 原图不上传。 */

const EDGE = 256;
const MAX_LENGTH = 200_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface AvatarImage {
  image: HTMLImageElement;
  /** 预览用的 object URL，用完要 revoke */
  url: string;
}

export function loadAvatarImage(file: File): Promise<AvatarImage> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('请选图片文件'));
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error('图片别超过 8MB'));

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读不出来，换一张试试'));
    };
    image.src = url;
  });
}

/** 从原图裁一块正方形（源图坐标），输出 256px JPEG。 */
export function cropAvatar(
  image: HTMLImageElement,
  source: { x: number; y: number; size: number },
): string {
  const canvas = document.createElement('canvas');
  canvas.width = EDGE;
  canvas.height = EDGE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这台设备不支持图片处理');

  ctx.drawImage(image, source.x, source.y, source.size, source.size, 0, 0, EDGE, EDGE);

  let quality = 0.86;
  let data = canvas.toDataURL('image/jpeg', quality);
  while (data.length > MAX_LENGTH && quality > 0.4) {
    quality -= 0.12;
    data = canvas.toDataURL('image/jpeg', quality);
  }
  if (data.length > MAX_LENGTH) throw new Error('图片太大，换一张试试');
  return data;
}
