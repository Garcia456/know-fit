/** 头像先裁成正方形、缩到 256px，再压成 data URL —— 原图不上传。 */

const EDGE = 256;
const MAX_LENGTH = 200_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读不出来，换一张试试'));
    };
    image.src = url;
  });
}

export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选图片文件');
  if (file.size > MAX_FILE_BYTES) throw new Error('图片别超过 8MB');

  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = EDGE;
  canvas.height = EDGE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这台设备不支持图片处理');

  // 居中裁正方形，避免头像被拉变形
  const side = Math.min(image.width, image.height);
  ctx.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    EDGE,
    EDGE,
  );

  let quality = 0.86;
  let data = canvas.toDataURL('image/jpeg', quality);
  while (data.length > MAX_LENGTH && quality > 0.4) {
    quality -= 0.12;
    data = canvas.toDataURL('image/jpeg', quality);
  }
  if (data.length > MAX_LENGTH) throw new Error('图片太大，换一张试试');
  return data;
}