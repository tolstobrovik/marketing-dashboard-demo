// The masking that runs before any of the people board leaves this server.
// A failure here is a name in somebody else's logs, so it is checked the way
// the router uses it: build a map for a team, mask, and assert nothing
// identifying survives.
import { aliasFor, aliasMap, mask, unmask, leaks } from '../server/anon.js'

let bad = 0
const ok = (name, cond, saw) => {
  if (cond) console.log(`  ok   ${name}`)
  else { console.log(`  FAIL ${name}${saw === undefined ? '' : ` — saw ${JSON.stringify(saw)}`}`); bad++ }
}

console.log('anon: letters')
ok('first is A', aliasFor(0) === 'Person A', aliasFor(0))
ok('26th is Z', aliasFor(25) === 'Person Z', aliasFor(25))
ok('27th is AA', aliasFor(26) === 'Person AA', aliasFor(26))
ok('53rd is BA', aliasFor(52) === 'Person BA', aliasFor(52))

const team = [
  { id: 1, name: 'Ravshan Xolmatov', username: 'ravshan' },
  { id: 2, name: 'Asadbek Urakov', username: 'asadbek' },
  { id: 3, name: 'Аня Петрова', username: 'anya' },
  { id: 4, name: 'Ali', username: 'ali' },
]
const map = aliasMap(team)

console.log('anon: masking')
ok('full name goes', mask('Ravshan Xolmatov was late', map) === 'Person A was late', mask('Ravshan Xolmatov was late', map))
ok('first name alone goes', mask('Ravshan was late', map) === 'Person A was late', mask('Ravshan was late', map))
ok('surname alone goes', mask('Xolmatov was late', map) === 'Person A was late', mask('Xolmatov was late', map))
ok('username goes', mask('ask @ravshan about it', map) === 'ask Person A about it', mask('ask @ravshan about it', map))
ok('cyrillic name goes', mask('Аня сделала план', map) === 'Person C сделала план', mask('Аня сделала план', map))
ok('cyrillic surname goes', mask('Петрова сделала план', map) === 'Person C сделала план', mask('Петрова сделала план', map))
ok('two people, two aliases',
  mask('Ravshan and Asadbek disagreed', map) === 'Person A and Person B disagreed',
  mask('Ravshan and Asadbek disagreed', map))
ok('case is ignored', mask('RAVSHAN was late', map) === 'Person A was late', mask('RAVSHAN was late', map))
ok('possessive survives', mask("Ravshan's plan", map) === "Person A's plan", mask("Ravshan's plan", map))

console.log('anon: what must NOT be touched')
// A name inside a longer word is not that name. "Alister" is not Ali.
ok('no chopping inside words', mask('Alister wrote it', map) === 'Alister wrote it', mask('Alister wrote it', map))
ok('a three-letter name still goes', mask('Ali did well', map) === 'Person D did well', mask('Ali did well', map))
ok('unknown names are left', mask('Dilnoza did well', map) === 'Dilnoza did well', mask('Dilnoza did well', map))
ok('numbers untouched', mask('30 of 50 came', map) === '30 of 50 came', mask('30 of 50 came', map))

console.log('anon: round trip')
const src = 'Ravshan Xolmatov missed September; Аня covered for him.'
const masked = mask(src, map)
ok('nothing identifying survives', leaks(masked, map).length === 0, leaks(masked, map))
ok('names come back', unmask(masked, map).includes('Ravshan Xolmatov'), unmask(masked, map))
ok('the other name comes back', unmask(masked, map).includes('Аня Петрова'), unmask(masked, map))
ok('leaks() catches a miss', leaks('Ravshan was late', map).includes('Ravshan'), leaks('Ravshan was late', map))

console.log('anon: edges')
ok('empty text', mask('', map) === '', mask('', map))
ok('null text', mask(null, map) === '', mask(null, map))
ok('no map', mask('Ravshan', null) === 'Ravshan', mask('Ravshan', null))
ok('regex chars in a name', (() => {
  const m = aliasMap([{ id: 9, name: 'A. (Bek)', username: 'bek' }])
  return mask('A. (Bek) wrote it', m) === 'Person A wrote it'
})(), mask('A. (Bek) wrote it', aliasMap([{ id: 9, name: 'A. (Bek)', username: 'bek' }])))

console.log(bad ? `\nanon: ${bad} FAILED` : '\nanon: all good')
process.exit(bad ? 1 : 0)
