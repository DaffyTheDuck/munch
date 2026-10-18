import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

export interface Picked {
  /** base64 data URL sent to the AI (max 1024px wide) */
  dataUrl: string
  /** file URI of the resized image, used for previews and thumbnails */
  uri: string
}

// Opens the camera or photo library, then shrinks the result so uploads stay small and fast.
export async function pickImage(source: 'camera' | 'library'): Promise<Picked | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new Error('Camera permission is needed to take a photo. You can allow it in Settings.')
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
  if (result.canceled || !result.assets[0]) return null

  const ctx = ImageManipulator.manipulate(result.assets[0].uri)
  ctx.resize({ width: 1024 })
  const rendered = await ctx.renderAsync()
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
  return { dataUrl: `data:image/jpeg;base64,${saved.base64}`, uri: saved.uri }
}

// Small stored thumbnail shown next to the entry.
export async function makeThumb(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri)
  ctx.resize({ width: 160 })
  const saved = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true })
  return `data:image/jpeg;base64,${saved.base64}`
}
