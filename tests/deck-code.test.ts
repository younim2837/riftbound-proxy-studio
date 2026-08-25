import { describe, expect, it } from 'vitest'
import { RiftboundDeckImporter } from '../src/main/services/deck-importer.js'

describe('Riftbound deck codes', () => {
  it('decodes the Piltover reference deck code', () => {
    const code = 'CIAAAAAAAAAQCAAAA4AACAIAABMQAAILAAAAICIMDMOVOX3AM5UHIAIDAAACO6XYAEAQKAAABX3QDGACUABKIAQAAEBQAAAWDBOQCAQAABMHE'
    const result = new RiftboundDeckImporter().importDeckCode(code)
    expect(result.lines.length).toBeGreaterThan(20)
    expect(result.lines.some((line) => line.section === 'sideboard')).toBe(true)
    expect(result.lines.every((line) => line.requestedCode?.includes('-'))).toBe(true)
  })

  it('rejects non-base32 input', () => {
    expect(() => new RiftboundDeckImporter().importDeckCode('not-valid-!')).toThrow(/Base32/)
  })
})
