import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parseByteRange, streamRouter } from '../server/routes/stream.ts'

describe('HTTP Range Request Parsing [BUG-35]', () => {
  it('parses valid closed byte ranges per RFC 9110', () => {
    const res = parseByteRange('bytes=0-499', 1000)
    assert.strictEqual(res.valid, true)
    if (res.valid) {
      assert.strictEqual(res.range.start, 0)
      assert.strictEqual(res.range.end, 499)
    }

    const mid = parseByteRange('bytes=200-799', 1000)
    assert.strictEqual(mid.valid, true)
    if (mid.valid) {
      assert.strictEqual(mid.range.start, 200)
      assert.strictEqual(mid.range.end, 799)
    }
  })

  it('parses valid open-ended byte ranges per RFC 9110', () => {
    const res = parseByteRange('bytes=500-', 1000)
    assert.strictEqual(res.valid, true)
    if (res.valid) {
      assert.strictEqual(res.range.start, 500)
      assert.strictEqual(res.range.end, 999)
    }

    // When total is unknown (0), end remains undefined for chunked stream
    const unknownTotal = parseByteRange('bytes=500-', 0)
    assert.strictEqual(unknownTotal.valid, true)
    if (unknownTotal.valid) {
      assert.strictEqual(unknownTotal.range.start, 500)
      assert.strictEqual(unknownTotal.range.end, undefined)
    }
  })

  it('parses valid suffix byte ranges and clamps when larger than total', () => {
    const suffix = parseByteRange('bytes=-300', 1000)
    assert.strictEqual(suffix.valid, true)
    if (suffix.valid) {
      assert.strictEqual(suffix.range.start, 700)
      assert.strictEqual(suffix.range.end, 999)
    }

    // Suffix range larger than representation clamps start to 0
    const overSuffix = parseByteRange('bytes=-2000', 1000)
    assert.strictEqual(overSuffix.valid, true)
    if (overSuffix.valid) {
      assert.strictEqual(overSuffix.range.start, 0)
      assert.strictEqual(overSuffix.range.end, 999)
    }

    // Suffix range cannot be evaluated without total bytes
    const noTotal = parseByteRange('bytes=-500', 0)
    assert.strictEqual(noTotal.valid, false)
    if (!noTotal.valid) {
      assert.strictEqual(noTotal.status, 416)
    }
  })

  it('clamps end offset when it exceeds total bytes', () => {
    const res = parseByteRange('bytes=500-1500', 1000)
    assert.strictEqual(res.valid, true)
    if (res.valid) {
      assert.strictEqual(res.range.start, 500)
      assert.strictEqual(res.range.end, 999)
    }
  })

  it('returns 416 for unsatisfiable start offset exceeding or equal to total bytes', () => {
    const exactTotal = parseByteRange('bytes=1000-', 1000)
    assert.strictEqual(exactTotal.valid, false)
    if (!exactTotal.valid) assert.strictEqual(exactTotal.status, 416)

    const overTotal = parseByteRange('bytes=1500-', 1000)
    assert.strictEqual(overTotal.valid, false)
    if (!overTotal.valid) assert.strictEqual(overTotal.status, 416)

    const closedOver = parseByteRange('bytes=1000-1200', 1000)
    assert.strictEqual(closedOver.valid, false)
    if (!closedOver.valid) assert.strictEqual(closedOver.status, 416)
  })

  it('returns 416 for inverted byte ranges (start > end)', () => {
    const inverted = parseByteRange('bytes=500-200', 1000)
    assert.strictEqual(inverted.valid, false)
    if (!inverted.valid) {
      assert.strictEqual(inverted.status, 416)
    }
  })

  it('returns 416 for zero-length suffix ranges', () => {
    const zeroSuffix = parseByteRange('bytes=-0', 1000)
    assert.strictEqual(zeroSuffix.valid, false)
    if (!zeroSuffix.valid) {
      assert.strictEqual(zeroSuffix.status, 416)
    }
  })

  it('returns 416 for multiple ranges (multipart/byteranges not supported)', () => {
    const multi = parseByteRange('bytes=0-10,20-30', 1000)
    assert.strictEqual(multi.valid, false)
    if (!multi.valid) {
      assert.strictEqual(multi.status, 416)
    }

    const multiSpaced = parseByteRange('bytes=0-10, 20-30', 1000)
    assert.strictEqual(multiSpaced.valid, false)
    if (!multiSpaced.valid) {
      assert.strictEqual(multiSpaced.status, 416)
    }
  })

  it('returns 416 for unanchored or malformed range strings', () => {
    const malformed = [
      'prefix bytes=0-100',
      'bytes=0-100 suffix',
      'bytes=abc-def',
      'bytes=10-20-30',
      'bytes=',
      'bytes=-',
      'bytes=--50',
      'items=0-10',
      'notbytes=0-10',
      'bytes=0 - 100',
      'bytes=100\r\nInjected-Header: evil',
    ]

    for (const header of malformed) {
      const res = parseByteRange(header, 1000)
      assert.strictEqual(res.valid, false, `Expected ${header} to be rejected with 416`)
      if (!res.valid) {
        assert.strictEqual(res.status, 416)
      }
    }
  })

  it('stream /proxy endpoint returns 416 for malformed or multiple ranges', async () => {
    const validUrl = 'https://rr1---sn-ab5sznzl.googlevideo.com/videoplayback?id=123'

    // Multiple ranges -> 416
    const multiReq = new Request(
      `http://localhost/proxy?url=${encodeURIComponent(validUrl)}`,
      {
        headers: { Range: 'bytes=0-100,200-300' },
      },
    )
    const multiRes = await streamRouter.fetch(multiReq)
    assert.strictEqual(multiRes.status, 416)
    assert.strictEqual(multiRes.headers.get('Content-Range'), 'bytes */*')
    assert.strictEqual(multiRes.headers.get('Accept-Ranges'), 'bytes')

    // Malformed range -> 416
    const malformedReq = new Request(
      `http://localhost/proxy?url=${encodeURIComponent(validUrl)}`,
      {
        headers: { Range: 'bytes=malformed-range' },
      },
    )
    const malformedRes = await streamRouter.fetch(malformedReq)
    assert.strictEqual(malformedRes.status, 416)
    assert.strictEqual(malformedRes.headers.get('Content-Range'), 'bytes */*')

    // Suffix range with zero length -> 416
    const zeroReq = new Request(
      `http://localhost/proxy?url=${encodeURIComponent(validUrl)}`,
      {
        headers: { Range: 'bytes=-0' },
      },
    )
    const zeroRes = await streamRouter.fetch(zeroReq)
    assert.strictEqual(zeroRes.status, 416)
  })
})
