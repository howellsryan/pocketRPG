import numpy as np

def surface_distance(points,triangles):
 p=np.asarray(points)[:,None,:];tri=np.asarray(triangles)
 a,b,c=tri[:,0],tri[:,1],tri[:,2]
 ab=b-a;ac=c-a;n=np.cross(ab,ac);n2=np.sum(n*n,axis=-1)
 valid=n2>1e-15;a=a[valid];b=b[valid];c=c[valid];ab=ab[valid];ac=ac[valid];n=n[valid];n2=n2[valid]
 plane=p-n[None,:,:]*(np.sum((p-a)*n,axis=-1)/n2)[:,:,None]
 w=plane-a
 d00=np.sum(ab*ab,axis=-1);d01=np.sum(ab*ac,axis=-1);d11=np.sum(ac*ac,axis=-1)
 d20=np.sum(w*ab,axis=-1);d21=np.sum(w*ac,axis=-1);den=d00*d11-d01*d01
 u=(d11*d20-d01*d21)/den;v=(d00*d21-d01*d20)/den
 inside=(u>=0)&(v>=0)&(u+v<=1)
 distance=np.where(inside,np.sum((p-plane)**2,axis=-1),np.inf)
 for x,y in [(a,b),(b,c),(c,a)]:
  edge=y-x;t=np.clip(np.sum((p-x)*edge,axis=-1)/np.sum(edge*edge,axis=-1),0,1)
  nearest=x+t[:,:,None]*edge
  distance=np.minimum(distance,np.sum((p-nearest)**2,axis=-1))
 return np.sqrt(np.min(distance,axis=1))

def line_points(line,count=121):
 a,b=np.asarray(line);return a+(b-a)*np.linspace(0,1,count)[:,None]
