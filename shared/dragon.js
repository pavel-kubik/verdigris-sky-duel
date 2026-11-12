/*
 * Verdigris Sky Duel - the dragon, the one model used by every page: solo duel and tutorial (index.html), co-op
 * (mp/), the campaign and the deathmatch. Needs THREE (r128); shared/textures.js (VTex) gives it its skin - without
 * it (or without a DOM, as in the Node tests) the same model is built untextured.
 *
 * A smooth, skinned-looking body lofted from cross-sections (torso, six neck and twelve tail segments that overlap at
 * the joints), a sculpted head (cranium, snout, brow ridges, slit-pupilled eyes, curved horns, cheek spines, teeth,
 * tongue), belly scutes, a row of dorsal spines, muscled legs with toes and claws, and wings with an arm, three
 * fingers and scalloped, billowing membrane panels. Scales, scutes, horn and membrane are procedural textures with
 * normal maps. Geometry is built once and shared by every dragon; a dragon owns only its materials.
 *
 * Exposes window.VDragon:
 *   makeDragon(palette, opts) -> { root, body, neck, tail, jaw, head, mouth, wings, legs, claws, mats, meshes, flash,
 *                                  anim(time, dt, o), dispose() }
 *     palette: { body, dark, belly, wing, horn, eye } (hex colours)
 *     opts.toes (default true): toes and claws on the feet; false leaves plain paws.
 *     dispose(): removes root from its parent and frees the dragon's materials (geometry is shared).
 *   GREEN, CRIMSON palettes; STAND = model units from the root down to the soles of a standing dragon
 * Legs are hip / knee / foot joints: all at 0 = the tucked flight pose. anim(o.ground, o.gait, o.stride, o.fold) poses
 * the standing legs (2-bone IK), the walk cycle and the folded wings (campaign T07).
 */
(function(root){
"use strict";
if(!root.THREE)return;
const THREE=root.THREE,V3=THREE.Vector3,HOST=root;
/* Ground pose (T07): soles STAND model units under the root (campaign data walk.stand matches it), front legs reach
   FRONT_REACH x further while standing, FOLD = folded wing joint angles. */
const STAND=1.6,FRONT_REACH=1.3,FOLD={arm:1.0,foreZ:-0.15,foreY:1.75,sweep:0.35,tilt:0};
const TAU=Math.PI*2;
const geoCache=new Map();

/* ---------- geometry builder: plain arrays, so the model also builds against the Node test stub ---------- */
function Builder(){this.p=[];this.n=[];this.u=[];this.c=[];this.i=[];this.shade=1;}
Builder.prototype={
  vert(x,y,z,nx,ny,nz,u,v,s){
    const l=Math.hypot(nx,ny,nz)||1,k=s==null?this.shade:s;
    this.p.push(x,y,z);this.n.push(nx/l,ny/l,nz/l);this.u.push(u,v);this.c.push(k,k,k);
    return this.p.length/3-1;
  },
  quad(a,b,c,d){this.i.push(a,b,c,b,d,c);},                       // a b / c d rows: (a, b, c) and (b, d, c)
  /** Tapered tube along a polyline. pts [[x,y,z]], radii [r] or [[ru,rv]], n sides. o: { ref up vector, uRep, vRep, cap0, cap1, shade(i)->k } */
  tube(pts,radii,n,o){
    o=o||{};
    const ref=o.ref||[0,1,0],rows=[];let len=0;
    for(let i=0;i<pts.length;i++){
      const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];
      let tx=b[0]-a[0],ty=b[1]-a[1],tz=b[2]-a[2];const tl=Math.hypot(tx,ty,tz)||1;tx/=tl;ty/=tl;tz/=tl;
      let rx=ref[0],ry=ref[1],rz=ref[2];
      if(Math.abs(tx*rx+ty*ry+tz*rz)>0.95){rx=1;ry=0;rz=0;if(Math.abs(tx)>0.95){rx=0;rz=1;}}
      let ux=ry*tz-rz*ty,uy=rz*tx-rx*tz,uz=rx*ty-ry*tx;const ul=Math.hypot(ux,uy,uz)||1;ux/=ul;uy/=ul;uz/=ul;
      const vx=ty*uz-tz*uy,vy=tz*ux-tx*uz,vz=tx*uy-ty*ux;
      if(i)len+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1],pts[i][2]-pts[i-1][2]);
      const R=radii[i],ru=R.length?R[0]:R,rv=R.length?R[1]:R,row=[],sh=o.shade?o.shade(i):this.shade;
      for(let j=0;j<=n;j++){
        const an=j/n*TAU,ca=Math.cos(an),sa=Math.sin(an);
        row.push(this.vert(pts[i][0]+ux*ca*ru+vx*sa*rv,pts[i][1]+uy*ca*ru+vy*sa*rv,pts[i][2]+uz*ca*ru+vz*sa*rv,
          ux*ca/(ru||1e-3)+vx*sa/(rv||1e-3),uy*ca/(ru||1e-3)+vy*sa/(rv||1e-3),uz*ca/(ru||1e-3)+vz*sa/(rv||1e-3),j/n*(o.uRep||1),len*(o.vRep==null?0.5:o.vRep),sh));
      }
      rows.push({row,t:[tx,ty,tz]});
    }
    for(let i=0;i+1<rows.length;i++)for(let j=0;j<n;j++)this.quad(rows[i].row[j],rows[i].row[j+1],rows[i+1].row[j],rows[i+1].row[j+1]);
    const cap=(k,dir)=>{
      const r=rows[k],c=this.vert(pts[k][0],pts[k][1],pts[k][2],r.t[0]*dir,r.t[1]*dir,r.t[2]*dir,0.5,0.5);
      for(let j=0;j<n;j++){if(dir>0)this.i.push(r.row[j],r.row[j+1],c);else this.i.push(r.row[j+1],r.row[j],c);}
    };
    if(o.cap0)cap(0,-1);
    if(o.cap1)cap(rows.length-1,1);
    return this;
  },
  /** Ellipsoid at c with radii r along the axes ax (default x, y, z). */
  ball(c,r,o){
    o=o||{};
    const A=o.ax||[[1,0,0],[0,1,0],[0,0,1]],nu=o.nu||10,nv=o.nv||7,rows=[];
    for(let j=0;j<=nv;j++){
      const ph=j/nv*Math.PI,sy=Math.cos(ph),sr=Math.sin(ph),row=[];
      for(let i=0;i<=nu;i++){
        const th=i/nu*TAU,lx=Math.cos(th)*sr,ly=sy,lz=Math.sin(th)*sr;
        const px=lx*r[0],py=ly*r[1],pz=lz*r[2],qx=lx/r[0],qy=ly/r[1],qz=lz/r[2];
        row.push(this.vert(c[0]+A[0][0]*px+A[1][0]*py+A[2][0]*pz,c[1]+A[0][1]*px+A[1][1]*py+A[2][1]*pz,c[2]+A[0][2]*px+A[1][2]*py+A[2][2]*pz,
          A[0][0]*qx+A[1][0]*qy+A[2][0]*qz,A[0][1]*qx+A[1][1]*qy+A[2][1]*qz,A[0][2]*qx+A[1][2]*qy+A[2][2]*qz,i/nu*(o.uRep||1),j/nv*(o.vRep||1)));
      }
      rows.push(row);
    }
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++)this.quad(rows[j][i],rows[j][i+1],rows[j+1][i],rows[j+1][i+1]);
    return this;
  },
  /** A domed disc (eye lens) at c facing d, with up vector up; uv 0..1 across. */
  lens(c,d,up,rx,ry,bulge){
    const dl=Math.hypot(d[0],d[1],d[2]),dx=d[0]/dl,dy=d[1]/dl,dz=d[2]/dl;
    let sx=up[1]*dz-up[2]*dy,sy=up[2]*dx-up[0]*dz,sz=up[0]*dy-up[1]*dx;const sl=Math.hypot(sx,sy,sz)||1;sx/=sl;sy/=sl;sz/=sl;
    const ux=dy*sz-dz*sy,uy=dz*sx-dx*sz,uz=dx*sy-dy*sx,n=12;
    const ctr=this.vert(c[0]+dx*bulge,c[1]+dy*bulge,c[2]+dz*bulge,dx,dy,dz,0.5,0.5);
    let prev=-1,first=-1;
    for(let j=0;j<=n;j++){
      const a=j/n*TAU,ca=Math.cos(a),sa=Math.sin(a);
      const v=this.vert(c[0]+sx*ca*rx+ux*sa*ry,c[1]+sy*ca*rx+uy*sa*ry,c[2]+sz*ca*rx+uz*sa*ry,dx+sx*ca*0.6+ux*sa*0.6,dy+sy*ca*0.6+uy*sa*0.6,dz+sz*ca*0.6+uz*sa*0.6,0.5+ca*0.5,0.5+sa*0.5);
      if(prev>=0)this.i.push(ctr,prev,v);else first=v;
      prev=v;
    }
    void first;
    return this;
  },
  /** Membrane fan from apex over an edge polyline; the edge between two spokes sags toward the apex by `sag` and the
      panel billows by `cup` along +cupDir. uv: u across the whole fan, v from the apex to the edge. */
  fan(apex,edge,o){
    o=o||{};
    const S=o.s||4,C=o.c||4,sagO=o.sag==null?0.2:o.sag,cup=o.cup==null?0.1:o.cup,cd=o.cupDir||[0,-1,0],np=edge.length-1;
    for(let pI=0;pI<np;pI++){
      const sag=sagO.length?sagO[pI]:sagO,A=edge[pI],B=edge[pI+1],w=Math.hypot(B[0]-A[0],B[1]-A[1],B[2]-A[2]);
      const M=[(A[0]+B[0])/2,(A[1]+B[1])/2,(A[2]+B[2])/2],Q=[M[0]+(apex[0]-M[0])*sag*2,M[1]+(apex[1]-M[1])*sag*2,M[2]+(apex[2]-M[2])*sag*2];
      const grid=[];
      for(let ci=0;ci<=C;ci++){
        const k=ci/C,a=(1-k)*(1-k),b=2*k*(1-k),c2=k*k;
        const E=[A[0]*a+Q[0]*b+B[0]*c2,A[1]*a+Q[1]*b+B[1]*c2,A[2]*a+Q[2]*b+B[2]*c2],row=[];
        for(let si=0;si<=S;si++){
          const t=si/S,bl=Math.sin(Math.PI*k)*t*cup*w;
          row.push([apex[0]+(E[0]-apex[0])*t+cd[0]*bl,apex[1]+(E[1]-apex[1])*t+cd[1]*bl,apex[2]+(E[2]-apex[2])*t+cd[2]*bl,(pI+k)/np*(o.uRep||1),t*(o.vRep||1),0.82+0.18*Math.sin(Math.PI*k)*(0.5+0.5*t)]);
        }
        grid.push(row);
      }
      const ids=[];
      for(let ci=0;ci<=C;ci++){
        const row=[];
        for(let si=0;si<=S;si++){
          const P=grid[ci][si],R=grid[Math.min(C,ci+1)][si],L=grid[Math.max(0,ci-1)][si],U=grid[ci][Math.min(S,si+1)],D=grid[ci][Math.max(0,si-1)];
          const ax=R[0]-L[0],ay=R[1]-L[1],az=R[2]-L[2],bx=U[0]-D[0],by=U[1]-D[1],bz=U[2]-D[2];
          let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
          if(Math.hypot(nx,ny,nz)<1e-6){nx=0;ny=1;nz=0;}
          row.push(this.vert(P[0],P[1],P[2],nx,ny,nz,P[3],P[4],P[5]));
        }
        ids.push(row);
      }
      for(let ci=0;ci<C;ci++)for(let si=0;si<S;si++)this.quad(ids[ci][si],ids[ci+1][si],ids[ci][si+1],ids[ci+1][si+1]);
    }
    return this;
  },
  build(){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.u,2));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));
    g.setIndex(this.i);
    if(g.computeBoundingSphere)g.computeBoundingSphere();
    return g;
  },
};
/**
 * Body loft along +Z from cross-sections [z, cy, rx, ry, flatBottom?, flatTop?]. The underside (BELLY rad below the
 * horizontal on each side) goes to `belly` (its own uv: u across, v along), the rest to `skin` with a darker stripe
 * down the spine. Both share positions and normals along the seam, so the shading is continuous.
 */
const BELLY=0.62;
function loft(skin,belly,rings,o){
  o=o||{};
  const Nd=o.nd||10,Nb=o.nb||4,angs=[];
  for(let k=0;k<=Nd;k++)angs.push(-BELLY+(Math.PI+2*BELLY)*k/Nd);
  for(let k=1;k<Nb;k++)angs.push(Math.PI+BELLY+(Math.PI-2*BELLY)*k/Nb);
  const N=angs.length,P=[],len=[0];
  const rad=(r,a)=>{const s=Math.sin(a);return [Math.cos(a)*r[2],r[1]+s*r[3]*(s<0?(r[4]==null?1:r[4]):(r[5]==null?1:r[5]))];};
  for(let i=0;i<rings.length;i++){
    if(i)len.push(len[i-1]+Math.abs(rings[i][0]-rings[i-1][0]));
    P.push(angs.map(a=>{const q=rad(rings[i],a);return [q[0],q[1],rings[i][0]];}));
  }
  const nrm=(i,k)=>{
    const R=P[i],a=R[(k+1)%N],b=R[(k+N-1)%N],u=P[Math.min(rings.length-1,i+1)][k],d=P[Math.max(0,i-1)][k];
    const tx=a[0]-b[0],ty=a[1]-b[1],lx=u[0]-d[0],ly=u[1]-d[1],lz=u[2]-d[2];
    return [ty*lz,-tx*lz,tx*ly-ty*lx];                            // tangent around x tangent along
  };
  const band=o.band||(()=>1),uRep=o.uRep||3,vRep=o.vRep==null?0.55:o.vRep,v0=o.v0||0;
  const sIds=[],bIds=[];
  for(let i=0;i<rings.length;i++){
    const sr=[],br=[],bd=band(rings[i][0]);
    for(let k=0;k<=Nd;k++){
      const p=P[i][k],n=nrm(i,k),a=angs[k],da=Math.abs(a-Math.PI/2);
      const sh=bd*(1-0.3*Math.exp(-da*da/0.16))*(0.86+0.14*Math.min(1,(Math.PI/2+BELLY-da)/0.5));
      sr.push(skin.vert(p[0],p[1],p[2],n[0],n[1],n[2],k/Nd*uRep,(v0+len[i])*vRep,sh));
    }
    if(belly)for(let k=0;k<=Nb;k++){
      const kk=(Nd+k)%N,p=P[i][kk],n=nrm(i,kk);
      br.push(belly.vert(p[0],p[1],p[2],n[0],n[1],n[2],k/Nb,(v0+len[i])*(o.bRep||0.9),0.9+0.1*Math.sin(Math.PI*k/Nb)));
    }
    sIds.push(sr);bIds.push(br);
  }
  for(let i=0;i+1<rings.length;i++){
    for(let k=0;k<Nd;k++)skin.quad(sIds[i][k],sIds[i][k+1],sIds[i+1][k],sIds[i+1][k+1]);
    if(belly)for(let k=0;k<Nb;k++)belly.quad(bIds[i][k],bIds[i][k+1],bIds[i+1][k],bIds[i+1][k+1]);
  }
  const cap=(i,dir)=>{                                            // closed ends sit inside the neighbouring segment
    const r=rings[i],c=skin.vert(0,r[1],r[0],0,0,dir,0.5,0.5,0.7),ring=[];
    for(let k=0;k<N;k++){const p=P[i][k];ring.push(skin.vert(p[0],p[1],p[2],0,0,dir,0.5,0.5,0.7));}
    for(let k=0;k<N;k++){const a=ring[k],b=ring[(k+1)%N];if(dir>0)skin.i.push(a,b,c);else skin.i.push(b,a,c);}
  };
  if(o.cap0)cap(0,-1);
  if(o.cap1)cap(rings.length-1,1);
}
/** A swept-back dorsal spine standing on (0, y, z): height h, laterally flattened. */
function spine(B,y,z,h,lean){
  const l=lean==null?0.55:lean,w=h*0.3;
  B.tube([[0,y-h*0.12,z+h*0.1],[0,y+h*0.45,z-h*l*0.35],[0,y+h*0.8,z-h*l*0.8],[0,y+h,z-h*l*1.25]],[[w*0.5,w],[w*0.42,w*0.75],[w*0.26,w*0.42],[0.004,0.004]],6,{ref:[0,0,1],vRep:1.2});
}
/** A curved horn / claw / tooth through pts, tapering from r to a point. */
function horn(B,pts,r,n,flat){
  const m=pts.length,radii=pts.map((_,i)=>{const k=1-i/(m-1),rr=Math.max(0.004,r*Math.pow(k,0.8));return [rr*(flat||1),rr];});
  B.tube(pts,radii,n||6,{vRep:1.4,cap0:true});
}
function cached(key,make){
  let g=geoCache.get(key);
  if(!g){g=make();geoCache.set(key,g);}
  return g;
}

/* ---------- anatomy ---------- */
const NECK_R=i=>0.7-i*0.055,TAIL_R=i=>0.68*(1-i/13)+0.07;
const TORSO=[[-2.3,0.1,0.58,0.56],[-1.95,0.06,0.8,0.74],[-1.45,0.0,0.99,0.92],[-0.85,-0.04,1.07,0.98],[-0.25,-0.06,1.13,1.03],[0.35,-0.06,1.19,1.09],[0.9,0.0,1.16,1.07],[1.35,0.12,1.0,0.95],[1.75,0.26,0.83,0.8],[2.08,0.37,0.7,0.68]];
const HEAD=[[-0.46,0.12,0.26,0.26],[-0.25,0.16,0.46,0.42],[0.05,0.19,0.56,0.5,0.75],[0.36,0.2,0.52,0.44,0.55],[0.66,0.13,0.4,0.3,0.5],[0.96,0.08,0.31,0.22,0.5],[1.22,0.07,0.28,0.2,0.5],[1.42,0.08,0.26,0.2,0.55],[1.54,0.07,0.19,0.15,0.7],[1.6,0.06,0.09,0.07,0.8]];
const JAW=[[-0.22,-0.06,0.34,0.2,1,0.3],[0.12,-0.1,0.42,0.25,1,0.25],[0.5,-0.09,0.35,0.2,1,0.25],[0.86,-0.07,0.27,0.15,1,0.28],[1.1,-0.06,0.21,0.11,1,0.35],[1.24,-0.05,0.11,0.06,1,0.6]];

function torsoGeo(){
  const s=new Builder(),b=new Builder(),h=new Builder();
  loft(s,b,TORSO,{nd:12,nb:5,uRep:8,vRep:0.95,cap0:true,cap1:true});
  [-1,1].forEach(sd=>{                                           // haunches and shoulders
    s.shade=0.96;s.ball([sd*0.78,-0.3,-0.98],[0.4,0.58,0.66],{uRep:3,vRep:2});
    s.ball([sd*0.7,-0.02,1.1],[0.32,0.42,0.48],{uRep:3,vRep:2});
    s.ball([sd*0.7,0.56,0.66],[0.34,0.3,0.44],{uRep:1.5,vRep:1});
  });
  const top=z=>{for(let i=0;i+1<TORSO.length;i++){const a=TORSO[i],b=TORSO[i+1];if(z<=b[0]){const k=Math.max(0,(z-a[0])/(b[0]-a[0]));return a[1]+a[3]+(b[1]+b[3]-a[1]-a[3])*k;}}return 1;};
  for(let i=0;i<8;i++){const z=1.5-i*0.48,k=Math.abs(i-3.5)/3.5;spine(h,top(z)-0.06,z,0.62-k*0.2);}
  return {skin:s.build(),belly:b.build(),horn:h.build()};
}
function neckGeo(i){
  const s=new Builder(),b=new Builder(),h=new Builder(),r0=NECK_R(i),r1=NECK_R(i+1),rm=(r0+r1)/2*1.03;
  loft(s,b,[[-0.14,0,r0*0.97,r0*0.93],[0.1,0,r0,r0*0.96],[0.3,0,rm,rm*0.96],[0.5,0,r1*1.01,r1*0.97],[0.7,0,r1*0.96,r1*0.92]],{nd:10,nb:4,uRep:5,vRep:0.95,v0:i*0.55,cap0:true,cap1:true,band:()=>(i%2?0.9:1)});
  spine(h,r0*0.9,0.3,0.46-i*0.03);
  return {skin:s.build(),belly:b.build(),horn:h.build()};
}
function tailGeo(i){
  const s=new Builder(),b=new Builder(),h=new Builder(),r0=TAIL_R(i),r1=TAIL_R(i+1),rm=(r0+r1)/2*1.02;
  const nd=i<6?10:8,nb=i<6?4:3;
  loft(s,i<9?b:null,[[-0.74,0,r1*0.95,r1*0.86],[-0.55,0,r1,r1*0.9],[-0.3,0,rm,rm*0.9],[-0.05,0,r0,r0*0.9],[0.14,0,r0*0.95,r0*0.86]],{nd,nb,uRep:i<4?5:i<8?4:3,vRep:0.95,v0:i*0.6,cap0:true,cap1:true,band:()=>(i%2?0.88:1)});
  if(i<11)spine(h,r0*0.86,-0.22,0.44-i*0.028);
  if(i===11){                                                    // the tail blade
    h.tube([[0,0,-0.5],[0,0,-0.8],[0,0,-1.2],[0,0,-1.6],[0,0,-2.0]],[[0.1,0.09],[0.34,0.08],[0.44,0.06],[0.26,0.04],[0.004,0.004]],8,{ref:[0,1,0],vRep:1,cap0:true});
    h.tube([[0,0.02,-0.6],[0,0.06,-1.2],[0,0.02,-1.9]],[[0.05,0.07],[0.05,0.08],[0.004,0.004]],5,{ref:[0,1,0],vRep:1});
  }
  return {skin:s.build(),belly:i<9?b.build():null,horn:h.p.length?h.build():null};
}
function headGeo(){
  const s=new Builder(),m=new Builder(),h=new Builder(),t=new Builder(),e=new Builder();
  loft(s,m,HEAD,{nd:12,nb:4,uRep:5,vRep:1.3,cap0:true,cap1:true});
  [-1,1].forEach(sd=>{
    s.shade=0.8;                                                 // brow ridge and cheek
    s.tube([[sd*0.14,0.36,0.9],[sd*0.33,0.5,0.62],[sd*0.43,0.56,0.34],[sd*0.46,0.5,0.04]],[[0.04,0.03],[0.09,0.06],[0.1,0.07],[0.05,0.04]],6,{vRep:1,cap0:true,cap1:true});
    s.shade=0.95;s.ball([sd*0.38,0.0,-0.02],[0.14,0.19,0.27],{uRep:1.5,vRep:1});
    s.shade=0.92;s.ball([sd*0.13,0.2,1.4],[0.09,0.075,0.13],{uRep:1,vRep:1});      // nostril swell
    m.shade=0.2;m.ball([sd*0.17,0.24,1.49],[0.035,0.03,0.045],{nu:6,nv:4});          // nostril
    e.lens([sd*0.44,0.31,0.5],[sd*0.86,0.22,0.46],[0,1,0],0.13,0.1,0.045);
    horn(h,[[sd*0.27,0.38,-0.08],[sd*0.34,0.66,-0.42],[sd*0.42,0.9,-0.9],[sd*0.44,1.0,-1.42],[sd*0.4,0.96,-1.9]],0.17,7);
    horn(h,[[sd*0.44,0.2,-0.14],[sd*0.6,0.3,-0.46],[sd*0.7,0.36,-0.86],[sd*0.72,0.34,-1.2]],0.1,6);
    horn(h,[[sd*0.5,-0.02,0.02],[sd*0.68,-0.06,-0.22],[sd*0.78,-0.06,-0.52]],0.07,5);
    horn(h,[[sd*0.46,0.1,-0.2],[sd*0.62,0.1,-0.42],[sd*0.72,0.12,-0.7]],0.06,5);
    for(let k=0;k<7;k++){                                        // upper teeth along the lip, a fang near the front
      const z=0.52+k*0.14,x=sd*(0.36-k*0.027),big=k===5?1.9:1,l=0.12*big;
      horn(t,[[x,-0.02,z],[x*0.98,-0.02-l*0.6,z+0.01],[x*0.96,-0.02-l,z+0.02]],0.035*big,5);
    }
  });
  horn(h,[[0,0.26,1.2],[0,0.4,1.16],[0,0.5,1.06]],0.07,6);                       // nose horn
  for(let k=0;k<3;k++)spine(h,0.5-k*0.02,0.1-k*0.24,0.3-k*0.04);
  return {skin:s.build(),mouth:m.build(),horn:h.build(),teeth:t.build(),eye:e.build()};
}
function jawGeo(){
  const s=new Builder(),b=new Builder(),m=new Builder(),h=new Builder(),t=new Builder();
  loft(s,b,JAW,{nd:8,nb:4,uRep:4,vRep:1.3,cap0:true,cap1:true});
  m.shade=0.9;m.ball([0,0.02,0.5],[0.17,0.035,0.52],{nu:8,nv:5});                // tongue
  [-1,1].forEach(sd=>{
    for(let k=0;k<6;k++){const z=0.3+k*0.15,x=sd*(0.33-k*0.035),big=k===4?1.7:1,l=0.11*big;horn(t,[[x,0,z],[x*0.98,l*0.6,z+0.01],[x*0.96,l,z+0.02]],0.032*big,5);}
    horn(h,[[sd*0.2,-0.2,0.3],[sd*0.24,-0.34,0.2],[sd*0.26,-0.44,0.04]],0.05,5);  // chin barbs
    horn(h,[[sd*0.32,-0.14,-0.02],[sd*0.4,-0.24,-0.16],[sd*0.44,-0.3,-0.36]],0.05,5);
  });
  return {skin:s.build(),belly:b.build(),mouth:m.build(),horn:h.build(),teeth:t.build()};
}
/* Legs: A hip, K knee, F foot (body space, tucked flight pose). */
const LEGS=[
  {front:false,A:[0.82,-0.75,-1.05],K:[0.78,-1.15,-1.75],F:[0.75,-1.05,-2.25],r:[0.36,0.22,0.19,0.12],toe:[0.4,0.14,0.075]},
  {front:true,A:[0.6,-0.45,1.15],K:[0.7,-0.98,1.3],F:[0.66,-1.05,0.85],r:[0.27,0.17,0.15,0.1],toe:[0.32,0.11,0.062]},
];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
function legGeo(L,s,part,toes){
  const sk=new Builder(),h=new Builder(),A=[L.A[0]*s,L.A[1],L.A[2]],K=[L.K[0]*s,L.K[1],L.K[2]],F=[L.F[0]*s,L.F[1],L.F[2]];
  if(part==='hip'){
    const d=sub(K,A),mid=[d[0]*0.45,d[1]*0.45,d[2]*0.45];
    sk.tube([[0,0,0],[mid[0],mid[1]+0.04,mid[2]],d],[L.r[0],L.r[0]*0.95,L.r[1]],8,{vRep:1.2,uRep:2,cap0:true});
    sk.shade=0.92;sk.ball(d,[L.r[1]*1.08,L.r[1]*1.08,L.r[1]*1.08],{nu:8,nv:5});   // knee
  }else if(part==='knee'){
    const d=sub(F,K);
    sk.shade=0.86;sk.tube([[0,0,0],[d[0]*0.5,d[1]*0.5,d[2]*0.5],d],[L.r[2],L.r[2]*0.85,L.r[3]],7,{vRep:1.2,uRep:2});
    sk.ball(d,[L.r[3]*1.1,L.r[3]*1.1,L.r[3]*1.1],{nu:8,nv:5});                     // ankle
  }else{
    // toes point along the rest direction the standing IK expects: cone axis +Y turned -1.9 rad about X
    const dy=Math.cos(1.9),dz=-Math.sin(1.9),ny=-dz,nz=dy,[tl,dx,tr]=L.toe;
    sk.shade=0.86;sk.ball([0,dy*tl*0.25,dz*tl*0.25],[dx*1.5,L.r[3]*1.05,tl*0.52],{nu:8,nv:5,ax:[[1,0,0],[0,-ny,-nz],[0,dy,dz]]});
    if(toes){
      for(let k=-1;k<=1;k++){
        const sp=k*0.22,bx=k*dx,e=[bx+sp*tl,dy*tl,dz*tl],e2=[bx+sp*tl*1.5,dy*tl*1.55-ny*tl*0.05,dz*tl*1.55-nz*tl*0.05];
        sk.tube([[bx*0.6,0,0],e,e2],[tr*1.1,tr,tr*0.8],6,{vRep:1.5});
        horn(h,[e2,[e2[0]+sp*0.06,e2[1]+dy*tl*0.4-ny*tl*0.12,e2[2]+dz*tl*0.4-nz*tl*0.12],[e2[0]+sp*0.08,e2[1]+dy*tl*0.62-ny*tl*0.36,e2[2]+dz*tl*0.62-nz*tl*0.36]],tr*0.82,5);
      }
      horn(h,[[0,-dy*tl*0.2,-dz*tl*0.2],[0,-dy*tl*0.5-ny*tl*0.1,-dz*tl*0.5-nz*tl*0.1],[0,-dy*tl*0.62-ny*tl*0.3,-dz*tl*0.62-nz*tl*0.3]],tr*0.7,5);   // dewclaw
    }
  }
  return {skin:sk.build(),horn:h.p.length?h.build():null};
}
/* Wings (built for the +X side in the mirrored wing group): arm from the shoulder to the elbow E, fingers from the wrist W. */
const WING={E:[3,0,0],W:[2.6,0.45,0.4],F1:[5.5,0.35,-0.25],F2:[4.7,0.05,-2.5],F3:[3.0,-0.05,-3.5],B:[0,0,-2.4]};
function wingGeo(part){
  const s=new Builder(),w=new Builder(),h=new Builder(),G=WING;
  if(part==='arm'){
    s.tube([[0,0,0],[1.4,0.1,0.06],G.E],[0.26,0.2,0.15],8,{vRep:0.8,uRep:2,cap0:true});
    s.ball([0,0,0],[0.34,0.32,0.36],{nu:8,nv:6});
    s.shade=0.9;s.ball(G.E,[0.19,0.19,0.19],{nu:8,nv:5});
    w.fan([0,0,0],[G.E,[3,0,-2.4],[1.5,0,-1.85],[-0.6,0,-2.1]],{s:4,c:4,sag:[0,0.12,0.14],cup:0.07,uRep:1.5,vRep:1.4});
  }else{
    const W=G.W,mid=(a,b,k,up)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k+up,a[2]+(b[2]-a[2])*k];
    s.tube([[0,0,0],mid([0,0,0],W,0.5,0.05),W],[0.15,0.13,0.11],7,{vRep:0.8,uRep:2});
    s.ball(W,[0.14,0.14,0.14],{nu:8,nv:5});
    s.shade=0.8;
    [[G.F1,0.09],[G.F2,0.08],[G.F3,0.07]].forEach(([F,r])=>{
      s.tube([W,mid(W,F,0.4,0.1),mid(W,F,0.75,0.07),F],[r,r*0.8,r*0.55,0.012],6,{vRep:0.8,uRep:1});
      s.ball(mid(W,F,0.4,0.1),[r*1.05,r*1.05,r*1.05],{nu:6,nv:4});
    });
    horn(h,[[W[0],W[1]+0.06,W[2]+0.08],[W[0]+0.08,W[1]+0.3,W[2]+0.34],[W[0]+0.2,W[1]+0.36,W[2]+0.66]],0.09,6);   // thumb claw
    w.fan(W,[G.F1,G.F2,G.F3,G.B,[0,0,0]],{s:5,c:5,sag:[0.22,0.24,0.2,0],cup:0.1,uRep:3,vRep:2});
  }
  return {skin:s.build(),wing:w.build(),horn:h.p.length?h.build():null};
}

function makeDragon(c,opts){
  const toes=!opts||opts.toes!==false,TX=HOST.VTex||null;
  const tex=n=>(TX?(n==='eye'?TX.get(n):TX.albedo(n)):null),nrm=(n,k)=>(TX?TX.normal(n,k):null);
  const M=(col,o)=>{
    const p={color:col,roughness:.55,metalness:.1},ns=o&&o.ns;
    for(const k in o||{})if(k!=='ns'&&o[k]!=null)p[k]=o[k];
    const m=new THREE.MeshStandardMaterial(p);
    if(ns&&m.normalMap&&m.normalScale&&m.normalScale.set)m.normalScale.set(ns,ns);
    return m;
  };
  const scaleMap=tex('scales'),plateMap=tex('plates'),memMap=tex('membrane'),hornMap=tex('horn');
  /* the albedo textures are light relief (VTex.albedo): lift the palette colour a little so the lit skin keeps its tone */
  const lift=(hex,k)=>{const m=Math.max((hex>>16)&255,(hex>>8)&255,hex&255,1);k=Math.min(k,255/m);return (Math.round(((hex>>16)&255)*k)<<16)|(Math.round(((hex>>8)&255)*k)<<8)|Math.round((hex&255)*k);};
  const mBody=M(scaleMap?lift(c.body,1.2):c.body,{vertexColors:true,map:scaleMap,normalMap:nrm('scales',2.4),ns:0.85,roughness:.5,metalness:.16});
  const mBelly=M(plateMap?lift(c.belly,1.2):c.belly,{vertexColors:true,map:plateMap,normalMap:nrm('plates',2.2),ns:1,roughness:.7,metalness:.05});
  const mWing=M(memMap?lift(c.wing,1.2):c.wing,{vertexColors:true,side:THREE.DoubleSide,map:memMap,normalMap:nrm('membrane',1.2),ns:0.6,roughness:.75,metalness:0});
  const mHorn=M(hornMap?lift(c.horn,1.2):c.horn,{vertexColors:true,map:hornMap,normalMap:nrm('horn',1.6),ns:0.8,roughness:.3,metalness:.05});
  const mMouth=M(0x7a2a2e,{vertexColors:true,roughness:.6,metalness:0});
  const mTooth=M(0xf2ead8,{vertexColors:true,roughness:.3,metalness:0});
  const mEye=new THREE.MeshBasicMaterial({color:c.eye,map:tex('eye')});
  const mats=[mBody,mBelly,mWing,mHorn,mMouth,mTooth];
  const wingGlow=[((c.wing>>16)&255)/255*0.2,((c.wing>>8)&255)/255*0.2,(c.wing&255)/255*0.2];
  const matOf={skin:mBody,belly:mBelly,wing:mWing,horn:mHorn,mouth:mMouth,teeth:mTooth,eye:mEye};
  const put=(parent,key,make)=>{
    const G=cached(key,make);
    for(const k in G)if(G[k]){const m=new THREE.Mesh(G[k],matOf[k]);parent.add(m);}
  };
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);
  put(body,'torso',torsoGeo);

  // neck chain
  const neck=[];let j=new THREE.Group();j.position.set(0,0.35,1.65);j.rotation.x=j.userData.bx=-0.32;body.add(j);
  for(let i=0;i<6;i++){
    put(j,'neck'+i,()=>neckGeo(i));
    neck.push(j);const n=new THREE.Group();n.position.z=0.55;n.rotation.x=n.userData.bx=-0.13;j.add(n);j=n;
  }
  // head
  const head=new THREE.Group();head.rotation.x=0.85;j.add(head);
  put(head,'head',headGeo);
  const jaw=new THREE.Group();jaw.position.set(0,-0.14,0.3);head.add(jaw);
  put(jaw,'jaw',jawGeo);
  const mouth=new THREE.Object3D();mouth.position.set(0,-0.05,1.55);head.add(mouth);

  // tail chain
  const tail=[];let t=new THREE.Group();t.position.set(0,0.1,-1.75);body.add(t);t.userData.bx=0;
  for(let i=0;i<12;i++){
    put(t,'tail'+i,()=>tailGeo(i));
    tail.push(t);const n=new THREE.Group();n.position.z=-0.6;n.rotation.x=n.userData.bx=(i<4?0.02:-0.035);t.add(n);t=n;
  }

  // legs: hip -> knee -> foot joint groups. All joint rotations 0 = the tucked flight pose; anim(o.ground) bends them
  // into a standing / walking pose with a 2-bone IK in the side (y, z) plane.
  const legs=[];
  const a2=(y,z)=>Math.atan2(y,z);
  [-1,1].forEach(s=>LEGS.forEach(L=>{
    const A=new V3(L.A[0]*s,L.A[1],L.A[2]),K=new V3(L.K[0]*s,L.K[1],L.K[2]),F=new V3(L.F[0]*s,L.F[1],L.F[2]),tag=(L.front?'f':'h')+(s<0?'l':'r');
    const hip=new THREE.Group();hip.position.copy(A);body.add(hip);
    put(hip,'hip'+tag,()=>legGeo(L,s,'hip'));
    const knee=new THREE.Group();knee.position.subVectors(K,A);hip.add(knee);
    put(knee,'knee'+tag,()=>legGeo(L,s,'knee'));
    const foot=new THREE.Group();foot.position.subVectors(F,K);knee.add(foot);
    put(foot,'foot'+tag+(toes?'t':''),()=>legGeo(L,s,'foot',toes));
    const uy=K.y-A.y,uz=K.z-A.z,ly=F.y-K.y,lz=F.z-K.z;
    legs.push({s,front:L.front,hip,knee,foot,H:A.clone(),L1:Math.hypot(uy,uz),L2:Math.hypot(ly,lz),u0:a2(uy,uz),l0:a2(ly,lz),t0:Math.atan2(Math.cos(1.9),-Math.sin(1.9))});   // rest angles atan2(y, z) of thigh, shin, toes
  }));

  // wings
  const wings=[];
  [-1,1].forEach(s=>{
    const wr=new THREE.Group();wr.position.set(s*0.72,0.62,0.65);body.add(wr);
    const w=new THREE.Group();w.scale.x=s;wr.add(w);
    const arm=new THREE.Group();w.add(arm);
    put(arm,'wingArm',()=>wingGeo('arm'));
    const fore=new THREE.Group();fore.position.set(WING.E[0],WING.E[1],WING.E[2]);arm.add(fore);
    put(fore,'wingFore',()=>wingGeo('fore'));
    wings.push({wr,arm,fore,s});
  });

  const claws=new THREE.Object3D();claws.position.set(0,-1.35,-0.9);body.add(claws);

  let meshes=0;root.traverse(o=>{if(o.isMesh)meshes++;});
  const d={root,body,neck,tail,jaw,head,mouth,wings,legs,claws,mats,meshes,flash:0};
  const wrapA=x=>{x=(x+Math.PI)%(2*Math.PI);if(x<0)x+=2*Math.PI;return x-Math.PI;};
  /* One leg: foot target in body space (side plane), 2-bone IK, rotations blended in by g (0 = tucked). */
  function poseLeg(L,g,gait,stride,bob){
    const sc=L.front?1+(FRONT_REACH-1)*g:1;L.hip.scale.setScalar(sc);
    if(g<=0){L.hip.rotation.x=L.knee.rotation.x=L.foot.rotation.x=0;return;}
    const L1=L.L1*sc,L2=L.L2*sc,H=L.H;
    const ph=gait+((L.front===(L.s<0))?0:Math.PI);          // trot: front left with hind right, then the other pair
    const tz=H.z+(L.front?0.12:0.08)-Math.cos(ph)*0.55*stride; // the foot swings forward while lifted (sin > 0)
    const ty=-STAND+0.1+Math.max(0,Math.sin(ph))*0.38*stride-bob;
    let dz=tz-H.z,dy=ty-H.y,dd=Math.hypot(dz,dy);
    dd=Math.min(Math.max(dd,Math.abs(L1-L2)+1e-3),(L1+L2)*0.999);
    const be=Math.atan2(dy,dz),ga=Math.acos(Math.max(-1,Math.min(1,(L1*L1+dd*dd-L2*L2)/(2*L1*dd))));
    const a1=L.front?be-ga:be+ga;                              // hind knee points forward, front elbow back
    const ky=H.y+L1*Math.sin(a1),kz=H.z+L1*Math.cos(a1),a2=Math.atan2(ty-ky,tz-kz);
    const th=wrapA(L.u0-a1),tk=wrapA(L.l0-th-a2),tf=wrapA(L.t0-th-tk+0.08);   // toes forward, flat on the ground
    L.hip.rotation.x=th*g;L.knee.rotation.x=tk*g;L.foot.rotation.x=tf*g;
  }
  /*
   * o: { phase, amp (wing beat), mouth, turn, look,
   *      ground (0..1: tucked flight legs -> standing legs, wings folded), gait (walk cycle phase, rad),
   *      stride (0..1 step size, from the ground speed), fold (wing fold 0..1, default = ground) }
   */
  d.anim=function(time,dt,o){
    const ph=o.phase,a=Math.sin(ph),amp=o.amp,g=Math.max(0,Math.min(1,o.ground||0)),fold=o.fold==null?g:Math.max(0,Math.min(1,o.fold));
    const stride=g*(o.stride||0),gait=o.gait||0;
    wings.forEach(w=>{
      w.arm.rotation.z=a*0.8*amp+0.12;w.fore.rotation.z=Math.sin(ph-0.9)*0.5*amp-0.06+(1-amp)*0.1;w.wr.rotation.y=-w.s*(0.08+Math.cos(ph)*0.08*amp);
      if(fold>0){                                              // folded along the back: arm swept back and up, forearm folded onto it
        const sway=Math.sin(gait*2)*0.04*stride;
        w.arm.rotation.z+=(FOLD.arm+sway-w.arm.rotation.z)*fold;
        w.fore.rotation.z+=(FOLD.foreZ-w.fore.rotation.z)*fold;
        w.fore.rotation.y=FOLD.foreY*fold;
        w.wr.rotation.y+=(w.s*FOLD.sweep-w.wr.rotation.y)*fold;
        w.wr.rotation.x=FOLD.tilt*fold;
      }else{w.fore.rotation.y=0;w.wr.rotation.x=0;}
    });
    const bob=Math.abs(Math.sin(gait))*0.07*stride;
    body.position.y=-a*0.2*amp*(1-g)+bob*g;
    legs.forEach(L=>poseLeg(L,g,gait,stride,bob));
    neck.forEach((jj,i)=>{jj.rotation.x=jj.userData.bx+Math.sin(ph-i*0.4)*0.03*amp+(o.look||0)*0.04;jj.rotation.y=Math.sin(time*0.9-i*0.3)*0.05;});
    tail.forEach((jj,i)=>{jj.rotation.y=Math.sin(time*1.8-i*0.45)*0.09+(o.turn||0)*0.05;jj.rotation.x=jj.userData.bx+Math.sin(ph-i*0.5)*0.035;});
    jaw.rotation.x+=((o.mouth?0.65:0.04)-jaw.rotation.x)*Math.min(1,dt*12);
    if(d.flash>0){d.flash=Math.max(0,d.flash-dt*4);}
    const f=d.flash;mats.forEach(m=>m.emissive.setRGB(f*0.9,f*0.45,f*0.15));
    if(f<=0)mWing.emissive.setRGB(wingGlow[0],wingGlow[1],wingGlow[2]);   // light through the membrane
  };
  d.dispose=function(){
    if(root.parent)root.parent.remove(root);
    mats.forEach(m=>m.dispose());mEye.dispose();
  };
  return d;
}
const GREEN={body:0x2f7f50,dark:0x1f5c3c,belly:0xc9bf7c,wing:0x3f936a,horn:0xe7dcc1,eye:0xffd23a};
const CRIMSON={body:0x8c2026,dark:0x5a1218,belly:0x3d1717,wing:0x6d1a28,horn:0x2a2121,eye:0x8ff7ff};
root.VDragon={makeDragon,GREEN,CRIMSON,STAND};
})(typeof self!=='undefined'?self:this);
