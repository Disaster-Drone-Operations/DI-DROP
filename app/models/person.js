import Record from '/lib/record.js'

// A person of the drone unit. Roles (crew of a mission, flights, assignments) refer to people.
// Never deleted – "inactive" keeps them in the history and out of new selections.
//
//   const people = await Person.roster()   // all, sorted by name, each with .short (unique initials)
export default class Person extends Record {
  static tableName = 'people'

  static attributes = {
    name: 'string',
    initials: 'string', // own short form – empty = automatic
    active: 'boolean',
  }

  static defaults() {
    return { active: true }
  }

  // All people with their shown initials (.short), sorted by name
  static async roster() {
    const people = await this.all({ order: 'id ASC' })
    assignShorts(people)
    return people.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }

  static async activeRoster() {
    return (await this.roster()).filter((p) => p.active)
  }

  validate() {
    this.validatesPresenceOf('name')
    if (this.name) this.name = this.name.replace(/\s+/g, ' ')
    if (this.initials) this.initials = this.initials.replace(/\s+/g, '').slice(0, 6)
  }

  // Name and own initials must be unique (initials: compared with what the others show)
  async save() {
    if (!this.isValid) return false
    const others = (await Person.roster()).filter((p) => p.id !== this.id)
    const same = (a, b) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de')
    const namesake = others.find((p) => same(p.name, this.name))
    if (namesake) this.addError('name', 'gibt es schon')
    const twin = this.initials && others.find((p) => same(p.short, this.initials))
    if (twin) this.addError('initials', `hat schon ${twin.name}`)
    if (Object.keys(this.errors).length) return false
    return super.save()
  }
}

// "Max Mustermann" → "MM"; with taken initials longer variants ("MMu", "MaM") or a number
export function initialsCandidates(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['?']
  const first = words[0]
  const last = words.length > 1 ? words.at(-1) : ''
  const up = (s) => s.charAt(0).toLocaleUpperCase('de')
  const base = up(first) + up(last)
  const candidates = [base]
  if (last.length > 1) candidates.push(base + last.charAt(1).toLocaleLowerCase('de'))
  if (first.length > 1) candidates.push(up(first) + first.charAt(1).toLocaleLowerCase('de') + up(last))
  for (let i = 2; i < 100; i++) candidates.push(`${base}${i}`)
  return candidates
}

// .short for everyone: own initials, otherwise the first free candidate – the older person
// (smaller id) keeps "MM", the newer one gets "MMu"
function assignShorts(people) {
  const taken = new Set(people.filter((p) => p.initials).map((p) => p.initials.toLocaleLowerCase('de')))
  for (const p of people) {
    if (p.initials) {
      p.short = p.initials
      continue
    }
    p.short = initialsCandidates(p.name).find((c) => !taken.has(c.toLocaleLowerCase('de')))
    taken.add(p.short.toLocaleLowerCase('de'))
  }
}
