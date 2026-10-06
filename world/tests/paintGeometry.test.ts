import {describe,it,expect} from 'vitest'
import {PlaneGeometry} from 'three'
import {paintGeometryData} from '../client/src/paintGeometry'
describe('sparse painted ground',()=>{
  it('removes transparent tiles while matching base height, diagonals, UVs and smooth lighting',()=>{
    const corners=new Float32Array([0,.1,.2,.3,.8,.5,.6,.7,.8])
    const mesh=paintGeometryData(2,2,['','stone','wood',''],{stone:2,wood:6},corners)
    const reference=new PlaneGeometry(2,2,2,2)
    reference.rotateX(-Math.PI/2);reference.translate(1,0,1)
    for(let i=0;i<9;i++)reference.attributes.position.setY(i,corners[i])
    reference.computeVertexNormals()
    expect(mesh.indices).toHaveLength(12);expect(mesh.kinds).toEqual([2,2,2,2,6,6,6,6])
    for(let i=0;i<mesh.positions.length;i+=3){
      const [x,y,z]=mesh.positions.slice(i,i+3),vertex=z*3+x
      expect(y).toBeCloseTo(corners[vertex]+.02)
      expect(mesh.uv[(i/3)*2]).toBe(x/2);expect(mesh.uv[(i/3)*2+1]).toBe(1-z/2)
      for(let j=0;j<3;j++)expect(mesh.normals[i+j]).toBeCloseTo(reference.attributes.normal.array[vertex*3+j],5)
    }
    expect(mesh.indices.slice(0,6)).toEqual([0,2,1,2,3,1])
    reference.dispose()
  })
  it('allocates no overlay triangles for unpainted tiles',()=>{
    expect(paintGeometryData(2,2,['','','',''],{stone:2},null).indices).toEqual([])
  })
})
