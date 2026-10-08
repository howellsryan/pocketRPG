import { describe, expect, it } from 'vitest'
import { describeLocation } from '../client/src/worldMap'

const towns = [{x:178,z:120,label:'Lumbright'},{x:219,z:141,label:'Al-Karid'}]
const entrances = [{x:182,z:155,label:'Lumbright Cow Pasture'}]
describe('location guidance at authored entrances', () => {
  it('names the Cow Pasture entrance even when another city centre is closer', () => {
    expect(describeLocation({x:182,z:158},towns,entrances)).toBe('Entrance: Lumbright Cow Pasture')
  })
  it('retains ordinary city guidance outside an entrance approach', () => {
    expect(describeLocation({x:219,z:141},towns,entrances)).toBe('Al-Karid')
  })
  it('does not name an entrance outside its four-tile approach', () => {
    expect(describeLocation({x:187,z:158},towns,entrances)).toBe('Near Al-Karid')
  })
  it('supports an empty world and entrances without city landmarks', () => {
    expect(describeLocation({x:0,z:0},[])).toBe('Exploring Eldermoor')
    expect(describeLocation({x:182,z:158},[],entrances)).toBe('Entrance: Lumbright Cow Pasture')
  })
  it('prefers the closest entrance when approach radii overlap', () => {
    expect(describeLocation({x:182,z:158},towns,[...entrances,{x:182,z:159,label:'Nearby cave'}])).toBe('Entrance: Nearby cave')
  })
})
