// Brushes from other apps (decision 85), read from files made here, byte by byte: GIMP's .gbr and .gih, Krita's .kpp and
// .bundle, Photoshop's .abr with a picture and a worked-out tip. What each one becomes, what a report says was left out,
// the direction of a paper grain, and the errors of files that can't be read
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, PORT, ROOT } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: PORT, strictPort: true },
  logLevel: 'silent',
})
await server.listen()
const browser = await puppeteer.launch(LAUNCH)
const page = await browser.newPage()
const problems = []
const alerts = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
page.on('dialog', d => {
  alerts.push(d.message())
  d.accept()
})
await page.setViewport({ width: 1920, height: 1080 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const near = (a, b, by = 0.001) => Math.abs(a - b) <= by

// ----- Making the files -----
const u32 = value => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value >>> 0)
  return bytes
}
const u16 = value => {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(value & 0xffff)
  return bytes
}
const double = value => {
  const bytes = Buffer.alloc(8)
  bytes.writeDoubleBE(value)
  return bytes
}

// A tip of 16×16: a square of 8×8 in the middle, painting at "paint"
const squarePixels = (paint, stride = 1) => {
  const bytes = Buffer.alloc(16 * 16 * stride)
  for (let y = 4; y < 12; y++) {
    for (let x = 4; x < 12; x++) bytes[(y * 16 + x) * stride + stride - 1] = paint
  }
  return bytes
}

function gbr(name, spacing, pixels, depth) {
  const nameBytes = Buffer.from(`${name}\0`)
  const headerSize = 28 + nameBytes.length
  return Buffer.concat([
    u32(headerSize),
    u32(2),
    u32(16),
    u32(16),
    u32(depth),
    Buffer.from('GIMP'),
    u32(spacing),
    nameBytes,
    pixels,
  ])
}

function chunk(type, data) {
  return Buffer.concat([u32(data.length), Buffer.from(type), data, u32(0)])
}

// A .kpp: an image with the text of its preset, compressed as Krita does. Lydia doesn't look at the sum of a chunk
function kpp(xml) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const text = Buffer.concat([Buffer.from('preset\0\0'), deflateSync(Buffer.from(xml))])
  return Buffer.concat([signature, chunk('zTXt', text), chunk('IEND', Buffer.alloc(0))])
}

// A PNG image of 16×16 made by the browser: a black square on nothing
const pngOf = paint =>
  page.evaluate(async paint => {
    const canvas = new OffscreenCanvas(16, 16)
    const context = canvas.getContext('2d')
    context.fillStyle = paint
    context.fillRect(4, 4, 8, 8)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return [...bytes]
  }, paint)

const param = (name, value) => `<param name="${name}"><![CDATA[${value}]]></param>`
const pressure = '<!DOCTYPE params> <params id="pressure"> <curve>0,0;1,1;</curve> </params>'

// A ZIP file with everything stored as it is
function zip(files) {
  const records = []
  const list = []
  let at = 0
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name)
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0)
    common.writeUInt32LE(data.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(nameBytes.length, 22)
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), common, nameBytes, data])
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    common.copy(entry, 6)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(at, 42)
    list.push(Buffer.concat([entry, nameBytes]))
    records.push(local)
    at += local.length
  }
  const directory = Buffer.concat(list)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(at, 16)
  return Buffer.concat([...records, directory, end])
}

// Photoshop's descriptions
const name4 = text => Buffer.concat([u32(0), Buffer.from(text)])
const unicode = text => {
  const parts = [u32(text.length + 1)]
  for (const char of text) parts.push(u16(char.charCodeAt(0)))
  return Buffer.concat([...parts, u16(0)])
}
const text = value => Buffer.concat([Buffer.from('TEXT'), unicode(value)])
const unitFloat = value => Buffer.concat([Buffer.from('UntF#Prc'), double(value)])
const bool = value => Buffer.concat([Buffer.from('bool'), Buffer.from([value ? 1 : 0])])
const long = value => Buffer.concat([Buffer.from('long'), u32(value)])
const longName = name => Buffer.concat([u32(name.length), Buffer.from(name)])
function objectBody(className, items) {
  const parts = [unicode(''), className.length === 4 ? name4(className) : longName(className), u32(items.length)]
  for (const [key, value] of items) {
    parts.push(key.length === 4 ? name4(key) : longName(key), value)
  }
  return Buffer.concat(parts)
}
const object = (className, items) => Buffer.concat([Buffer.from('Objc'), objectBody(className, items)])

function abr() {
  const key = '11111111-2222-3333-4444-555555555555'
  // The first line packed: 16 bytes of 0, then the others stored the same way, with a square of paint
  const lines = []
  for (let y = 0; y < 16; y++) {
    lines.push(y >= 4 && y < 12 ? Buffer.from([253, 0, 249, 200, 253, 0]) : Buffer.from([241, 0]))
  }
  const sizes = Buffer.concat(lines.map(line => u16(line.length)))
  const sample = Buffer.alloc(301)
  sample[0] = key.length
  sample.write(key, 1, 'latin1')
  const body = Buffer.concat([sample, u32(0), u32(0), u32(16), u32(16), u16(8), Buffer.from([1]), sizes, ...lines])
  const padded = Buffer.concat([u32(body.length), body, Buffer.alloc((4 - (body.length % 4)) % 4)])
  const samp = Buffer.concat([Buffer.from('8BIMsamp'), u32(padded.length), padded])

  const sampled = object('brushPreset', [
    ['Nm  ', text('Sampled one')],
    [
      'Brsh',
      object('sampledBrush', [
        ['Spcn', unitFloat(30)],
        ['Angl', unitFloat(90)],
        ['Intr', bool(true)],
        ['sampledData', text(key)],
      ]),
    ],
    ['useTipDynamics', bool(true)],
    ['szVr', object('brVr', [['bVTy', long(2)]])],
    ['useScatter', bool(true)],
    ['scatterDynamics', object('brVr', [['jitter', unitFloat(50)]])],
    ['Cnt ', long(2)],
    ['Wtdg', bool(true)],
  ])
  const computed = object('brushPreset', [
    ['Nm  ', text('Worked out')],
    [
      'Brsh',
      object('computedBrush', [
        ['Hrdn', unitFloat(100)],
        ['Rndn', unitFloat(50)],
        ['Spcn', unitFloat(10)],
        ['Intr', bool(true)],
      ]),
    ],
  ])
  const list = Buffer.concat([Buffer.from('VlLs'), u32(2), sampled, computed])
  const description = Buffer.concat([u32(16), objectBody('null', [['Brsh', list]])])
  const desc = Buffer.concat([Buffer.from('8BIMdesc'), u32(description.length), description])
  return Buffer.concat([u16(6), u16(2), samp, desc])
}

// ----- Into the app -----
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('lydia.language', 'en')
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length >= 10,
  { timeout: 90000 },
)
await sleep(500)

const accepted = await page.$eval('.brushes-panel input[type=file]', input => input.accept)
check(
  'Import offers all the formats',
  ['.lydbrush', '.kpp', '.bundle', '.gbr', '.gih', '.abr'].every(each => accepted.includes(each)),
  accepted,
)

const imported = async (name, bytes) => {
  const path = `${OUT}/foreign-${name}`
  writeFileSync(path, bytes)
  const before = await page.$$eval('button.brush', list => list.length)
  alerts.length = 0
  const input = await page.$('.brushes-panel input[type=file]')
  await input.uploadFile(path)
  await sleep(700)
  const report = await page
    .$$eval('dialog.brush-report li', items => items.map(item => item.textContent))
    .catch(() => [])
  if (report.length > 0) {
    await page.click('.brush-report .dialog-actions button')
    await sleep(150)
  }
  return { added: (await page.$$eval('button.brush', list => list.length)) - before, report, alerts: [...alerts] }
}
// A brush as Lydia keeps it, with how much its tip paints at the middle and at a corner
const brushNamed = name =>
  page.evaluate(async name => {
    const { loadBrushes, tipOf } = await import('/src/brushLibrary.ts')
    const brush = (await loadBrushes()).find(each => each.preset.name === name)
    if (!brush) return null
    const tip = await tipOf(brush)
    const { width, height } = tip.image
    const context = tip.image.getContext('2d', { willReadFrequently: true })
    const paintAt = (x, y) => context.getImageData(Math.floor(x * width), Math.floor(y * height), 1, 1).data[3]
    let grain = null
    if (tip.grain) {
      const grainContext = tip.grain.getContext('2d', { willReadFrequently: true })
      grain = [grainContext.getImageData(0, 0, 1, 1).data[0], grainContext.getImageData(8, 8, 1, 1).data[0]]
    }
    const { tip: _, grain: __, ...shape } = brush.preset
    return { shape, width, height, middle: paintAt(0.5, 0.5), corner: paintAt(0.02, 0.02), grain }
  }, name)

// ----- GIMP -----
let result = await imported('gray.gbr', gbr('Gray tip', 40, squarePixels(200), 1))
check('a .gbr is added', result.added === 1, JSON.stringify(result))
check('with nothing to say about it', result.report.length === 0)
let brush = await brushNamed('Gray tip')
check('with its spacing', near(brush?.shape.spacing, 0.4), `${brush?.shape.spacing}`)
check('and its tip, where it paints', brush?.middle === 200 && brush?.corner === 0, `${brush?.middle} ${brush?.corner}`)

const colored = Buffer.alloc(16 * 16 * 4)
for (let i = 0; i < 16 * 16; i++) {
  colored.set([255, 0, 0, i % 16 >= 4 && i % 16 < 12 && i > 64 && i < 192 ? 180 : 0], i * 4)
}
const pipe = Buffer.concat([
  Buffer.from('Two pictures\n2 ncells:2 cellwidth:16 cellheight:16 step:100 dim:1\n'),
  gbr('cell', 20, colored, 4),
  gbr('cell', 20, colored, 4),
])
result = await imported('pipe.gih', pipe)
check('a .gih is added', result.added === 1, JSON.stringify(result))
check(
  'and it says what stayed out',
  result.report[0]?.includes('the other pictures of its tip') && result.report[0]?.includes('the colors of its tip'),
  result.report[0],
)
brush = await brushNamed('Two pictures')
check('its tip is the alpha of the first one', brush?.middle === 180, `${brush?.middle}`)

// ----- Krita -----
const autoBrush = `<Brush type="auto_brush" spacing="0.3" angle="${Math.PI / 2}" useAutoSpacing="0">
  <MaskGenerator type="circle" ratio="1" hfade="0" vfade="0" spikes="2" diameter="50"/></Brush>`
result = await imported(
  'worked-out.kpp',
  kpp(
    `<Preset name="Worked out tip" paintopid="paintbrush">
      ${param('brush_definition', autoBrush)}
      ${param('PressureSize', 'true')}${param('SizeSensor', pressure)}
      ${param('PressureOpacity', 'false')}
      ${param('FlowValue', '0.5')}${param('OpacityValue', '0.5')}
      ${param('PaintOpAction', '2')}
    </Preset>`,
  ),
)
check('a .kpp with a tip of its own making is added', result.added === 1, JSON.stringify(result))
check('with nothing left out', result.report.length === 0, result.report.join())
brush = await brushNamed('Worked out tip')
check('its spacing', near(brush?.shape.spacing, 0.3), `${brush?.shape.spacing}`)
check('its angle, the other way round', near(brush?.shape.angle, 270, 0.01), `${brush?.shape.angle}`)
check('its flow, with the opacity', near(brush?.shape.flow, 0.25), `${brush?.shape.flow}`)
check('it follows the pressure in size only', brush?.shape.pressureSize && !brush?.shape.pressureFlow)
check('and it washes', brush?.shape.wash === true)
check('its tip is round', brush?.middle === 255 && brush?.corner === 0, `${brush?.middle} ${brush?.corner}`)

result = await imported(
  'engine.kpp',
  kpp(
    `<Preset name="Other engine" paintopid="colorsmudge">
      ${param('brush_definition', '<Brush type="gbr_brush" filename="absent.gbr" spacing="0.1" angle="0"/>')}
      ${param('PressureSize', 'true')}
      ${param('SizeSensor', '<!DOCTYPE params> <params id="speed"> <curve>0,0;0.5,0.8;1,1;</curve> </params>')}
      ${param('MaskingBrush/Enabled', 'true')}
      ${param('CompositeOp', 'multiply')}
    </Preset>`,
  ),
)
check('a preset of another engine is still added', result.added === 1, JSON.stringify(result))
const named = [
  'its own way of painting',
  'its tip (it is not in the file)',
  'what changes it besides pressure',
  'its own pressure curves',
  'its second tip',
  'its way of mixing or effects',
]
check(
  'and each thing it had is named',
  named.every(each => result.report[0]?.includes(each)),
  result.report[0],
)
brush = await brushNamed('Other engine')
check('with a round tip for the one missing', brush?.middle > 200 && brush?.corner === 0)
check('and no pressure, which it did not have', brush?.shape.pressureSize === false)

const tip = Buffer.from(await pngOf('#000000'))
const pattern = Buffer.from(tip.toString('base64')).toString('base64') // twice, as Krita writes it
const resources = `<resources><resource type="brushes" filename="inside.png" name="inside">${tip.toString('base64')}</resource></resources>`
result = await imported(
  'inside.kpp',
  kpp(
    `<Preset name="Krita 5" paintopid="paintbrush">
      ${resources}
      ${param('brush_definition', '<Brush type="png_brush" filename="inside.png" spacing="0.2" angle="0" scale="1"/>')}
      ${param('Texture/Pattern/Enabled', 'true')}
      ${param('Texture/Pattern/Pattern', pattern)}
      ${param('Texture/Pattern/Scale', '0.5')}
      ${param('Texture/Pattern/Invert', 'false')}
      ${param('Texture/Strength/Value', '0.75')}
    </Preset>`,
  ),
)
check('a preset with its tip inside it is added', result.added === 1, JSON.stringify(result))
brush = await brushNamed('Krita 5')
check('with that tip', brush?.middle === 255 && brush?.corner === 0, `${brush?.middle} ${brush?.corner}`)
check('and its pattern as a grain', near(brush?.shape.grainScale, 0.5) && near(brush?.shape.grainDepth, 0.75))
// The pattern is transparent at its corner, which lets paint through in Krita, and black in the middle, which holds it
check(
  'where it holds the paint back, the paper is low',
  brush?.grain?.[0] === 255 && brush?.grain?.[1] === 0,
  `${brush?.grain}`,
)

// Krita's automatic spacing grows with the square root of the size, so a big brush stays close together
result = await imported(
  'automatic.kpp',
  kpp(
    `<Preset name="Automatic" paintopid="paintbrush">
      ${param(
        'brush_definition',
        `<Brush type="auto_brush" spacing="0.1" angle="0" useAutoSpacing="1" autoSpacingCoeff="1.2">
          <MaskGenerator type="circle" ratio="1" hfade="0" vfade="0" spikes="2"/></Brush>`,
      )}
    </Preset>`,
  ),
)
const distances = await page.evaluate(async () => {
  const { createDabPath } = await import('/src/engine/dabs.ts')
  const { loadBrushes } = await import('/src/brushLibrary.ts')
  const brush = (await loadBrushes()).find(each => each.preset.name === 'Automatic')
  return [25, 100, 400].map(size => {
    const path = createDabPath({ ...brush.preset, pressureSize: false }, size)
    path.start({ x: 0, y: 0, pressure: 1 })
    const dabs = path.moveTo([{ x: 5000, y: 0, pressure: 1 }])
    return dabs[2].x - dabs[1].x
  })
})
check(
  'automatic spacing is the square root of the size, as in Krita',
  [6, 12, 24].every((each, i) => near(distances[i], each, 0.01)),
  distances.join(', '),
)

const presetInBundle = kpp(
  `<Preset name="From the bundle" paintopid="paintbrush">
    ${param('brush_definition', '<Brush type="gbr_brush" filename="tip.gbr" spacing="0.5" angle="0"/>')}
  </Preset>`,
)
result = await imported(
  'set.bundle',
  zip([
    ['mimetype', Buffer.from('application/x-krita-resourcebundle')],
    ['brushes/tip.gbr', gbr('tip', 10, squarePixels(255), 1)],
    ['paintoppresets/one.kpp', presetInBundle],
    ['paintoppresets/broken.kpp', Buffer.from('not an image')],
  ]),
)
check('a bundle brings its presets', result.added === 1, JSON.stringify(result))
brush = await brushNamed('From the bundle')
check('with their tips', brush?.middle === 255 && near(brush?.shape.spacing, 0.5), JSON.stringify(brush?.shape.spacing))
check('and says which one it could not read', result.alerts[0]?.includes('broken.kpp'), result.alerts[0])

// ----- Photoshop -----
result = await imported('set.abr', abr())
check('an .abr brings its brushes', result.added === 2, JSON.stringify(result))
brush = await brushNamed('Sampled one')
check('with their tips, unpacked', brush?.middle === 200 && brush?.corner === 0, `${brush?.middle} ${brush?.corner}`)
check(
  'their spacing, shorter for the two dabs of each step',
  near(brush?.shape.spacing, 0.15),
  `${brush?.shape.spacing}`,
)
check('their angle, the other way round', near(brush?.shape.angle, 270), `${brush?.shape.angle}`)
check('their scatter', near(brush?.shape.scatter, 0.5), `${brush?.shape.scatter}`)
check('what follows the pressure', brush?.shape.pressureSize === true)
check('and what stayed out', result.report[0]?.includes('its way of mixing or effects'), result.report.join(' / '))
brush = await brushNamed('Worked out')
check('a tip worked out by Photoshop has its shape', brush?.middle === 255 && near(brush?.height, 256))
check('and a brush with no dynamics has no pressure', brush?.shape.pressureSize === false)

// ----- What can't be read -----
result = await imported('bad.abr', Buffer.concat([u16(99), u16(1)]))
check('a version of Photoshop brushes it does not know', result.alerts[0]?.includes('LYD-219'), result.alerts[0])
result = await imported('bad.gbr', Buffer.from('this is not a brush'))
check('a file that is not what it says', result.alerts[0]?.includes('LYD-218'), result.alerts[0])
result = await imported('bad.bundle', Buffer.from('nor is this'))
check('a bundle that is not one', result.alerts[0]?.includes('LYD-218'), result.alerts[0])
result = await imported('empty.bundle', zip([['mimetype', Buffer.from('x')]]))
check('a bundle with no presets', result.alerts[0]?.includes('LYD-220'), result.alerts[0])
result = await imported('other.txt', Buffer.from('hello'))
check('another kind of file', result.alerts[0]?.includes('LYD-206'), result.alerts[0])
result = await imported('gray.gbr', gbr('Gray tip', 40, squarePixels(200), 1))
check('a brush already there', result.alerts[0]?.includes('LYD-208'), result.alerts[0])

// ----- Painting -----
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button.brush')].find(
    each => each.querySelector('.brush-name').textContent === 'Sampled one',
  )
  button.click()
})
await sleep(400)
const painted = await page.evaluate(async () => {
  const { engine, brush, gpu, projection } = window.lydia
  engine.setBrush({ size: 60, color: '#000000', opacity: 1, tool: 'brush' })
  brush.settings.tool = 'brush'
  brush.startStroke(100, 100, 1)
  brush.continueStroke([{ x: 400, y: 100, pressure: 1 }])
  brush.endStroke()
  while (gpu.hasUnsaved() || projection.isUpdating()) await new Promise(requestAnimationFrame)
  // This brush scatters its dabs, so any one point may have no paint: count them along the whole stroke
  let touched = 0
  for (let x = 100; x <= 400; x += 2) {
    for (let y = 60; y <= 140; y += 4) if (projection.colorAt(x, y) !== '#ffffff') touched++
  }
  return touched
})
check('it paints', painted > 100, `${painted} points`)

// ----- A long name -----
const tooLong = 'A brush with a very long name that does not fit in the list of brushes at all'
await imported('long.gbr', gbr(tooLong, 40, squarePixels(200), 1))
const sideways = await page.$eval('.brushes-list', list => list.scrollWidth - list.clientWidth)
check('a long name does not move the list sideways', sideways <= 0, `${sideways} px`)
const shownName = await page.$eval(`button.brush[title="${tooLong}"]`, button => button.title)
check('and shows whole under the pointer', shownName === tooLong)

// ----- The outline of a tip of small marks -----
const outlines = await page.evaluate(async () => {
  const { tipOutline } = await import('/src/engine/brushOutline.ts')
  const tipOf = draw => {
    const image = document.createElement('canvas')
    image.width = image.height = 256
    draw(image.getContext('2d'))
    return { image, reach: 1, grain: null }
  }
  const spread = loops => {
    const points = loops.flat()
    const xs = points.map(point => point.x)
    return { loops: loops.length, width: Math.max(...xs) - Math.min(...xs) }
  }
  return {
    specks: spread(
      tipOutline(
        tipOf(context => {
          for (let i = 0; i < 40; i++) {
            const angle = i * 2.4
            const far = 20 + (i * 100) / 40
            context.fillRect(128 + Math.cos(angle) * far, 128 + Math.sin(angle) * far, 2, 2)
          }
        }),
      ),
    ),
    round: spread(
      tipOutline(
        tipOf(context => {
          context.arc(128, 128, 100, 0, Math.PI * 2)
          context.fill()
        }),
      ),
    ),
    parts: spread(
      tipOutline(
        tipOf(context => {
          context.fillRect(10, 100, 100, 56)
          context.fillRect(146, 100, 100, 56)
        }),
      ),
    ),
  }
})
check('a tip of small marks shows one line around them', outlines.specks.loops === 1, JSON.stringify(outlines.specks))
check('as wide as they spread', outlines.specks.width > 0.7, `${outlines.specks.width}`)
check('a solid tip keeps its own outline', outlines.round.loops === 1 && near(outlines.round.width, 0.78, 0.04))
check('and a tip in parts keeps one for each', outlines.parts.loops === 2, JSON.stringify(outlines.parts))

// ----- The spacing, for now -----
const choose = name =>
  page.evaluate(name => {
    const list = [...document.querySelectorAll('button.brush')]
    list.find(each => each.querySelector('.brush-name').textContent === name).click()
  }, name)
const spacingShown = () =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.advanced-panel label')].find(each =>
      each.textContent.startsWith('Spacing'),
    )
    return row ? Number(row.querySelector('input').value) : null
  })
const setSpacing = value =>
  page.evaluate(value => {
    const row = [...document.querySelectorAll('.advanced-panel label')].find(each =>
      each.textContent.startsWith('Spacing'),
    )
    const input = row.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
const strokeCovers = () =>
  page.evaluate(async () => {
    const { engine, brush, gpu, projection } = window.lydia
    engine.clearLayer()
    engine.setBrush({ size: 60, color: '#000000', opacity: 1, tool: 'brush' })
    brush.settings.tool = 'brush'
    brush.startStroke(100, 300, 1)
    brush.continueStroke([{ x: 500, y: 300, pressure: 1 }])
    brush.endStroke()
    await new Promise(requestAnimationFrame)
    while (gpu.hasUnsaved() || projection.isUpdating()) await new Promise(requestAnimationFrame)
    let covered = 0
    for (let x = 120; x < 480; x++) if (projection.colorAt(x, 300) !== '#ffffff') covered++
    return covered / 360
  })

await choose('Gray tip')
await sleep(400)
await page.click('.advanced-menu > button')
await sleep(150)
check('Advanced shows the spacing of the brush', (await spacingShown()) === 40, `${await spacingShown()}`)
await setSpacing(100)
await sleep(150)
const apart = await strokeCovers()
await setSpacing(5)
await sleep(150)
const together = await strokeCovers()
check('its copies are apart at first', apart < 0.8, `${apart.toFixed(2)} of the stroke`)
check('and closer together with a smaller spacing', together > 0.99, `${together.toFixed(2)} of the stroke`)
await choose('Automatic')
await sleep(300)
check('another brush shows its own', (await spacingShown()) !== 5, `${await spacingShown()}`)
await choose('Gray tip')
await sleep(300)
check('and going back keeps what was chosen', (await spacingShown()) === 5, `${await spacingShown()}`)
const kept = await page.evaluate(async () => {
  const { loadBrushes } = await import('/src/brushLibrary.ts')
  return (await loadBrushes()).find(each => each.preset.name === 'Gray tip').preset.spacing
})
check('the brush keeps its own spacing', near(kept, 0.4), `${kept}`)
await page.click('.advanced-menu > button')

// Only what is meant: the errors above were shown on purpose, as messages
check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
