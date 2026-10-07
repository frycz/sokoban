/**
 * Hardcoded for now. Once this is worth doing properly it moves to
 * levels/*.sok and the host fetches it, with parse() unchanged.
 *
 * Original Sokoban, level 1. Kept as an array of lines so leading
 * whitespace cannot be lost to reformatting.
 */
export const LEVEL = [
  '    #####',
  '    #   #',
  '    #$  #',
  '  ###  $##',
  '  #  $ $ #',
  '### # ## #   ######',
  '#   # ## #####  ..#',
  '# $  $          ..#',
  '##### ### #@##  ..#',
  '    #     #########',
  '    #######',
].join('\n')
