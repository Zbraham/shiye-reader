const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function bmpEntry(image, size) {
  const bitmap = image.toBitmap()
  const expected = size * size * 4
  if (bitmap.length < expected) throw new Error('unexpected bitmap length')
  const maskRow = Math.ceil(size / 32) * 4
  const maskSize = maskRow * size
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(size * size * 4, 20)
  const pixelBytes = Buffer.alloc(size * size * 4)
  const rowBytes = size * 4
  for (let y = 0; y < size; y += 1) {
    bitmap.copy(
      pixelBytes,
      (size - 1 - y) * rowBytes,
      y * rowBytes,
      y * rowBytes + rowBytes
    )
  }
  const mask = Buffer.alloc(maskSize)
  return Buffer.concat([header, pixelBytes, mask])
}

function buildIco(images) {
  const entries = SIZES.map((size, index) => ({
    size,
    data: bmpEntry(images[index], size)
  }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const table = Buffer.alloc(16 * entries.length)
  let offset = 6 + table.length
  entries.forEach((entry, index) => {
    const at = index * 16
    table.writeUInt8(entry.size >= 256 ? 0 : entry.size, at)
    table.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    table.writeUInt8(0, at + 2)
    table.writeUInt8(0, at + 3)
    table.writeUInt16LE(1, at + 4)
    table.writeUInt16LE(32, at + 6)
    table.writeUInt32LE(entry.data.length, at + 8)
    table.writeUInt32LE(offset, at + 12)
    offset += entry.data.length
  })
  return Buffer.concat([header, table, ...entries.map((entry) => entry.data)])
}

app.disableHardwareAcceleration()
app.setPath('userData', path.join(os.tmpdir(), 'shiye-icon-render'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false
    }
  })
  await win.loadFile(path.join(__dirname, 'icon.html'))
  await new Promise((resolve) => setTimeout(resolve, 500))
  const shot = await win.webContents.capturePage()
  const base = shot.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, 'icon.html')) : shot
  fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), base.toPNG())
  const images = SIZES.map((size) =>
    base.resize({ width: size, height: size, quality: 'best' })
  )
  fs.writeFileSync(path.join(__dirname, '..', 'icon.ico'), buildIco(images))
  fs.writeFileSync(
    path.join(__dirname, '..', 'icon-preview.png'),
    images[6].toPNG()
  )
  console.log('wrote icon.ico', fs.statSync(path.join(__dirname, '..', 'icon.ico')).size)
  app.quit()
})
