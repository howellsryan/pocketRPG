// Sparse quads retain PlaneGeometry's tile diagonal, UVs and terrain normals.
export function paintGeometryData(width: number, height: number, grid: string[], codes: Record<string,number>, corners: Float32Array | null) {
  const positions: number[]=[], uv: number[]=[], kinds: number[]=[], indices: number[]=[], normals: number[]=[]
  const stride=width+1, normalCache=new Map<string,number[]>()
  const point=(x:number,z:number)=>[x,corners?.[z*stride+x]??0,z]
  const normalAt=(x:number,z:number)=>{
    const key=x+','+z,cached=normalCache.get(key)
    if(cached)return cached
    const sum=[0,0,0]
    for(let qz=Math.max(0,z-1);qz<=Math.min(height-1,z);qz++)for(let qx=Math.max(0,x-1);qx<=Math.min(width-1,x);qx++){
      const p=[point(qx,qz),point(qx+1,qz),point(qx,qz+1),point(qx+1,qz+1)]
      for(const ids of [[0,2,1],[2,3,1]]){
        if(!ids.some((i)=>p[i][0]===x&&p[i][2]===z))continue
        const a=p[ids[0]],b=p[ids[1]],c=p[ids[2]],u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i])
        sum[0]+=u[1]*v[2]-u[2]*v[1];sum[1]+=u[2]*v[0]-u[0]*v[2];sum[2]+=u[0]*v[1]-u[1]*v[0]
      }
    }
    const length=Math.hypot(...sum)||1,result=sum.map((v)=>v/length)
    normalCache.set(key,result);return result
  }
  for(let z=0;z<height;z++)for(let x=0;x<width;x++){
    const code=codes[grid[z*width+x]]
    if(!code)continue
    const start=positions.length/3
    for(const [dx,dz] of [[0,0],[1,0],[0,1],[1,1]]){
      const wx=x+dx,wz=z+dz
      positions.push(wx,(corners?.[wz*stride+wx]??0)+.02,wz)
      uv.push(wx/width,1-wz/height);kinds.push(code);normals.push(...normalAt(wx,wz))
    }
    indices.push(start,start+2,start+1,start+2,start+3,start+1)
  }
  return {positions,uv,kinds,indices,normals}
}
