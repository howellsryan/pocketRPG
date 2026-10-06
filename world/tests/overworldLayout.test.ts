import { describe, expect, it } from 'vitest'
import * as layout from '../scripts/overworldLayout.mjs'
import worldData from '../../src/data/world.json'

type District = { id: string; tier: string; x: number; z: number }
type Layout = { W: number; H: number; districts: District[] }
type RoadRect = { kind: string; x: number; z: number; w: number; h: number }
const projectPlaces = layout.projectPlaces as (places: unknown[], opts?: unknown) => Layout
const roadSegments = layout.roadSegments as (edges: unknown[], districts: District[], opts?: unknown) => RoadRect[]

const places = Object.values((worldData as { places: Record<string, { id: string; x: number; y: number; tier?: string }> }).places)
const edges = (worldData as unknown as { edges: [string, string, number][] }).edges

describe('projectPlaces', () => {
  it('gives every world.json place a district inside the map bounds', () => {
    const { W, H, districts } = projectPlaces(places)
    expect(districts.length).toBe(places.length)
    for (const d of districts) {
      expect(d.x).toBeGreaterThanOrEqual(0)
      expect(d.z).toBeGreaterThanOrEqual(0)
      expect(d.x).toBeLessThan(W)
      expect(d.z).toBeLessThan(H)
    }
  })

  it('is deterministic — same places in, same layout out (every client agrees)', () => {
    const a = projectPlaces(places)
    const b = projectPlaces(places)
    expect(b).toEqual(a)
  })

  it('preserves relative board layout (west stays west, north stays north)', () => {
    const { districts } = projectPlaces(places)
    const byId = new Map(districts.map((d) => [d.id, d]))
    const board = new Map(places.map((p) => [p.id, p]))
    // Ardounne is west of Brimhollow on the board; Camlann is north of Portsarin.
    expect(byId.get('ardounne')!.x).toBeLessThan(byId.get('brimhollow')!.x)
    expect(byId.get('camlann')!.z).toBeLessThan(byId.get('portsarin')!.z)
    // Ordering is monotonic in the projection, not scrambled.
    expect(board.get('ardounne')!.x).toBeLessThan(board.get('brimhollow')!.x)
  })

  it('never lands two districts on the same tile', () => {
    const { districts } = projectPlaces(places)
    const keys = new Set(districts.map((d) => `${d.x},${d.z}`))
    expect(keys.size).toBe(districts.length)
  })

  it('spreads towns apart — no district centre within 12 tiles of another', () => {
    const { districts } = projectPlaces(places)
    for (let i = 0; i < districts.length; i++) {
      for (let j = i + 1; j < districts.length; j++) {
        const cheb = Math.max(Math.abs(districts[i].x - districts[j].x), Math.abs(districts[i].z - districts[j].z))
        expect(cheb, `${districts[i].id}↔${districts[j].id}`).toBeGreaterThan(12)
      }
    }
  })
})

describe('roadSegments', () => {
  it('emits a road for every travel edge between known districts', () => {
    const { districts } = projectPlaces(places)
    const rects = roadSegments(edges, districts)
    expect(rects.length).toBeGreaterThan(edges.length) // each edge is several stepped rects
    for (const r of rects) expect(r.kind).toBe('path_dirt')
  })

  it('drops edges whose endpoints are not districts (no crash, no phantom road)', () => {
    const { districts } = projectPlaces(places)
    const rects = roadSegments([['lumbright', 'nowhere', 1]], districts)
    expect(rects).toEqual([])
  })
})

describe('semantic gateway roads', () => {
  it('connects every boundary to its destination on painted tiles without cutting back into the region', () => {
    const bounds={x0:146,z0:88,x1:210,z1:152}
    const connections=[
      {point:'west',to:'draynar',x:147,z:122,outward:{x:-1,z:0}},
      {point:'south',to:'draynar',x:178,z:150,outward:{x:0,z:1}},
      {point:'east',to:'alkarid',x:208,z:120,outward:{x:1,z:0}},
      {point:'east',to:'varrick',x:208,z:120,outward:{x:1,z:0}},
    ]
    const {districts}=projectPlaces(places)
    for(const c of connections) {
      const rects=layout.connectionRoadSegments([c],districts,bounds)
      const outside=new Set<string>()
      for(const r of rects)for(let z=r.z;z<r.z+r.h;z++)for(let x=r.x;x<r.x+r.w;x++)
        if(x<bounds.x0||x>=bounds.x1||z<bounds.z0||z>=bounds.z1)outside.add(x+','+z)
      const start=c.outward.x<0?{x:bounds.x0-1,z:c.z}:c.outward.x>0?{x:bounds.x1,z:c.z}:{x:c.x,z:bounds.z1}
      const seen=new Set([start.x+','+start.z]),queue=[start]
      expect(outside.has(start.x+','+start.z)).toBe(true)
      for(let i=0;i<queue.length;i++)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const p={x:queue[i].x+dx,z:queue[i].z+dz},k=p.x+','+p.z
        if(outside.has(k)&&!seen.has(k)){seen.add(k);queue.push(p)}
      }
      const target=districts.find((d)=>d.id===c.to)!
      expect(seen.has(target.x+','+target.z),c.point+'→'+c.to).toBe(true)
    }
  })
})
