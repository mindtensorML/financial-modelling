const MAX_EDGE = 2400
const KEEP_AS_IS_BYTES = 2.5 * 1024 * 1024

async function decode(file: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } catch {
    return null
  } finally {
    // The decoded image stays usable after its URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * Shrinks a photo before upload and re-encodes it as JPEG. Drawing it applies the camera's
 * rotation and drops its metadata (including location). Screenshots that are already small
 * PNG or WebP are left alone, because their sharp text reads better unconverted. A format the
 * browser cannot decode (HEIC outside Safari, say) goes up unchanged and the server explains.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const img = await decode(file)
  if (!img) return file
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const lossless = file.type === 'image/png' || file.type === 'image/webp'
  if (lossless && longest <= MAX_EDGE && file.size <= KEEP_AS_IS_BYTES) return file
  const scale = Math.min(1, MAX_EDGE / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
  if (!blob) return file
  const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
}
