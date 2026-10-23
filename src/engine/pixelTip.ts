// Pixel brushes paint whole pixels of the paper, with hard edges and nothing in between, as pixel art needs. The tip
// of the Pixel brush is round, and worked out for each size, so that a small brush paints the pixels a pixel artist
// would draw by hand:
//
//   1   #      2   ##     3   .#.     4   .##.     5   .###.
//                  ##         ###         ####         #####
//                             .#.         ####         #####
//                                         .##.         #####
//                                                      .###.
//
// The pixels painted are those whose centers are within half the size from the tip's center. At size 3 that would
// be a full square, so there the tip is a plus instead

// How many pixels each row of the round tip of this size paints, from the top. Each row is centered
export function roundTipRows(size: number): number[] {
  if (size === 3) return [1, 3, 1]
  const radius = size / 2
  const rows: number[] = []
  for (let row = 0; row < size; row++) {
    const y = row + 0.5 - radius
    let count = 0
    for (let column = 0; column < size; column++) {
      const x = column + 0.5 - radius
      if (x * x + y * y <= radius * radius) count++
    }
    rows.push(count)
  }
  return rows
}
