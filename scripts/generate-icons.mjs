import sharp from 'sharp'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = await readFile(`${root}resources/app-icon.svg`)
await mkdir(`${root}src/renderer/src/assets`, { recursive: true })
await copyFile(`${root}resources/app-icon.svg`, `${root}src/renderer/src/assets/app-icon.svg`)
await sharp(source).resize(512, 512).png().toFile(`${root}resources/app-icon.png`)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()))
const directory = Buffer.alloc(6 + 16 * sizes.length)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(sizes.length, 4)
let offset = directory.length
images.forEach((image, i) => {
  const index = 6 + i * 16
  directory.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], index)
  directory.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], index + 1)
  directory.writeUInt16LE(1, index + 4)
  directory.writeUInt16LE(32, index + 6)
  directory.writeUInt32LE(image.length, index + 8)
  directory.writeUInt32LE(offset, index + 12)
  offset += image.length
})
await writeFile(`${root}resources/app-icon.ico`, Buffer.concat([directory, ...images]))
console.log('Custom SVG, PNG and Windows ICO generated.')
