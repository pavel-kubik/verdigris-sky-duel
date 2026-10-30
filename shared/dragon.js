/*
 * Verdigris Sky Duel - procedural low-poly dragon, the one model used by every page:
 * solo duel and tutorial (index.html), co-op (mp/) and the campaign. Needs THREE (r128)
 * loaded first. Exposes window.VDragon:
 *   makeDragon(palette, opts) -> { root, body, neck, tail, jaw, head, mouth, wings, legs, claws, mats, meshes, flash,
 *                                  anim(time, dt, o), dispose() }
 *     opts.toes (default true): claw cones on the feet. Co-op passes false to keep its lighter model.
 *     dispose(): removes root from its parent and frees its geometries and materials (the shared
 *     segment geometry stays).
 *   GREEN, CRIMSON palettes; STAND = model units from the root down to the soles of a standing dragon
 * Legs are hip / knee / foot joints: all at 0 = the tucked flight pose. anim(o.ground, o.gait, o.stride, o.fold) poses
 * the standing legs (2-bone IK), the walk cycle and the folded wings (campaign T07); without them the flight pose is
 * unchanged, so the duel and co-op look the same.
 */
(function(root){
"use strict";
if(!root.THREE)return;
const THREE=root.THREE,V3=THREE.Vector3;
let segGeo=null;
/* Ground pose (T07): soles STAND model units under the root (campaign data walk.stand matches it), front legs reach
   FRONT_REACH x further while standing, FOLD = folded wing joint angles. */
const STAND=1.6,FRONT_REACH=1.3,FOLD={arm:1.0,foreZ:-0.15,foreY:1.75,sweep:0.35,tilt:0};
function bone(a,b,r0,r1,mat){
  const d=new V3().subVectors(b,a),len=d.length();
  const g=new THREE.CylinderGeometry(r1,r0,len,5);g.translate(0,len/2,0);
  const m=new THREE.Mesh(g,mat);m.position.copy(a);m.quaternion.setFromUnitVectors(new V3(0,1,0),d.normalize());return m;
}
function membrane(tris,mat){
  const arr=[];tris.forEach(t=>t.forEach(p=>arr.push(p.x,p.y,p.z)));
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));g.computeVertexNormals();
  return new THREE.Mesh(g,mat);
}
function spike(parent,x,y,z,s,mat,tilt){
  const m=new THREE.Mesh(new THREE.ConeGeometry(s*0.45,s,4),mat);m.position.set(x,y,z);m.rotation.x=tilt==null?-0.55:tilt;parent.add(m);return m;
}
function makeDragon(c,opts){
  const toes=!opts||opts.toes!==false;
  if(!segGeo)segGeo=new THREE.IcosahedronGeometry(1,1);
  const M=(col,o)=>new THREE.MeshStandardMaterial(Object.assign({color:col,flatShading:true,roughness:.55,metalness:.12},o||{}));
  const mBody=M(c.body),mDark=M(c.dark),mBelly=M(c.belly,{roughness:.8}),mWing=M(c.wing,{side:THREE.DoubleSide,roughness:.85,metalness:0}),mHorn=M(c.horn,{roughness:.35}),mEye=new THREE.MeshBasicMaterial({color:c.eye});
  const mats=[mBody,mDark,mBelly,mWing,mHorn];
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);

  const torso=new THREE.Mesh(segGeo,mBody);torso.scale.set(1.15,1,2.05);body.add(torso);
  const belly=new THREE.Mesh(segGeo,mBelly);belly.scale.set(0.92,0.72,1.85);belly.position.set(0,-0.36,0.05);body.add(belly);
  for(let i=0;i<6;i++)spike(body,0,0.92-Math.abs(i-2.5)*0.04,1.3-i*0.52,0.55,mHorn);

  // neck chain
  const neck=[];let j=new THREE.Group();j.position.set(0,0.35,1.65);j.rotation.x=j.userData.bx=-0.32;body.add(j);
  for(let i=0;i<6;i++){
    const r=0.7-i*0.055;const s=new THREE.Mesh(segGeo,i%2?mDark:mBody);s.scale.set(r,r*0.95,r*1.15);s.position.z=0.27;j.add(s);
    const sb=new THREE.Mesh(segGeo,mBelly);sb.scale.set(r*0.75,r*0.6,r);sb.position.set(0,-r*0.35,0.27);j.add(sb);
    spike(j,0,r*0.92,0.2,0.4-i*0.03,mHorn);
    neck.push(j);const n=new THREE.Group();n.position.z=0.55;n.rotation.x=n.userData.bx=-0.13;j.add(n);j=n;
  }
  // head
  const head=new THREE.Group();head.rotation.x=0.85;j.add(head);
  const skull=new THREE.Mesh(segGeo,mBody);skull.scale.set(0.56,0.46,0.72);skull.position.set(0,0.12,0.2);head.add(skull);
  const snout=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.38,1.05,6),mBody);snout.rotation.x=Math.PI/2;snout.position.set(0,0.05,0.95);head.add(snout);
  const brow=new THREE.Mesh(new THREE.BoxGeometry(0.85,0.12,0.35),mDark);brow.position.set(0,0.36,0.5);brow.rotation.x=0.25;head.add(brow);
  const jaw=new THREE.Group();jaw.position.set(0,-0.14,0.3);head.add(jaw);
  const jm=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.3,0.95,6),mBelly);jm.rotation.x=Math.PI/2;jm.position.set(0,-0.08,0.5);jaw.add(jm);
  const toothM=M(0xf2ead8,{roughness:.3});
  [[-0.17,0.85],[0.17,0.85],[-0.22,0.55],[0.22,0.55]].forEach(t=>{const tt=new THREE.Mesh(new THREE.ConeGeometry(0.04,0.16,4),toothM);tt.position.set(t[0],0.02,t[1]);jaw.add(tt);});
  [[-0.15,1.25],[0.15,1.25],[-0.25,0.95],[0.25,0.95]].forEach(t=>{const tt=new THREE.Mesh(new THREE.ConeGeometry(0.04,0.16,4),toothM);tt.rotation.x=Math.PI;tt.position.set(t[0],-0.12,t[1]);head.add(tt);});
  [-1,1].forEach(s=>{
    const e=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6),mEye);e.position.set(s*0.3,0.27,0.55);e.scale.set(1,0.7,1.3);head.add(e);
    const h1=new THREE.Mesh(new THREE.ConeGeometry(0.13,1.15,5),mHorn);h1.position.set(s*0.26,0.42,-0.15);h1.rotation.set(-1.05,0,-s*0.22);head.add(h1);
    const h2=new THREE.Mesh(new THREE.ConeGeometry(0.08,0.6,5),mHorn);h2.position.set(s*0.42,0.18,-0.2);h2.rotation.set(-1.25,0,-s*0.6);head.add(h2);
    const frill=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.45,4),mDark);frill.position.set(s*0.42,-0.05,0.05);frill.rotation.set(-1.4,0,-s*0.9);head.add(frill);
  });
  const mouth=new THREE.Object3D();mouth.position.set(0,-0.05,1.55);head.add(mouth);

  // tail chain
  const tail=[];let t=new THREE.Group();t.position.set(0,0.1,-1.75);body.add(t);t.userData.bx=0;
  for(let i=0;i<12;i++){
    const r=0.68*(1-i/13)+0.07;const s=new THREE.Mesh(segGeo,i%2?mDark:mBody);s.scale.set(r,r*0.9,0.5);s.position.z=-0.3;t.add(s);
    if(i<10)spike(t,0,r*0.9,-0.3,0.42-i*0.03,mHorn);
    tail.push(t);const n=new THREE.Group();n.position.z=-0.6;n.rotation.x=n.userData.bx=(i<4?0.02:-0.035);t.add(n);t=n;
  }
  const spade=new THREE.Mesh(new THREE.OctahedronGeometry(0.55),mHorn);spade.scale.set(0.95,0.12,1.2);spade.position.z=-0.45;t.add(spade);

  // legs: hip -> knee -> foot joint groups. All joint rotations 0 = the tucked flight pose (same geometry as before
  // T07); anim(o.ground) bends them into a standing / walking pose with a 2-bone IK in the side (y, z) plane.
  const legs=[];
  function leg(s,front,A,K,F,r,mat,toeR,toeL,toeY,toeDX){
    const hip=new THREE.Group();hip.position.copy(A);body.add(hip);
    hip.add(bone(new V3(),new V3().subVectors(K,A),r[0],r[1],mat));
    const knee=new THREE.Group();knee.position.subVectors(K,A);hip.add(knee);
    knee.add(bone(new V3(),new V3().subVectors(F,K),r[2],r[3],mDark));
    const foot=new THREE.Group();foot.position.subVectors(F,K);knee.add(foot);
    if(toes)for(let k=-1;k<=1;k++){const cl=new THREE.Mesh(new THREE.ConeGeometry(toeR,toeL,4),mHorn);cl.position.set(k*toeDX,toeY,-0.1);cl.rotation.x=-1.9;foot.add(cl);}
    const a2=(v)=>Math.atan2(v.y,v.z);
    const u=new V3().subVectors(K,A),l=new V3().subVectors(F,K);
    legs.push({s,front,hip,knee,foot,H:A.clone(),L1:Math.hypot(u.y,u.z),L2:Math.hypot(l.y,l.z),u0:a2(u),l0:a2(l),t0:Math.atan2(Math.cos(1.9),-Math.sin(1.9))});   // rest angles atan2(y, z) of thigh, shin, toes
  }
  [-1,1].forEach(s=>{
    const thigh=new THREE.Mesh(segGeo,mBody);thigh.scale.set(0.42,0.58,0.62);thigh.position.set(s*0.72,-0.38,-0.95);body.add(thigh);
    leg(s,false,new V3(s*0.82,-0.75,-1.05),new V3(s*0.78,-1.15,-1.75),new V3(s*0.75,-1.05,-2.25),[0.17,0.12,0.11,0.08],mDark,0.05,0.28,-0.03,0.09);
    leg(s,true,new V3(s*0.6,-0.45,1.15),new V3(s*0.7,-0.98,1.3),new V3(s*0.66,-1.05,0.85),[0.13,0.09,0.09,0.07],mBody,0.04,0.2,-0.02,0.07);
  });

  // wings
  const wings=[];
  [-1,1].forEach(s=>{
    const wr=new THREE.Group();wr.position.set(s*0.72,0.62,0.65);body.add(wr);
    const w=new THREE.Group();w.scale.x=s;wr.add(w);
    const arm=new THREE.Group();w.add(arm);
    const E=new V3(3,0,0);
    arm.add(bone(new V3(0,0,0),E,0.2,0.13,mBody));
    const sh=new THREE.Mesh(segGeo,mBody);sh.scale.setScalar(0.3);arm.add(sh);
    arm.add(membrane([[new V3(0,0,0),new V3(3,0,0),new V3(3,0,-2.4)],[new V3(0,0,0),new V3(3,0,-2.4),new V3(1.5,0,-1.85)],[new V3(0,0,0),new V3(1.5,0,-1.85),new V3(-0.6,0,-2.1)]],mWing));
    const fore=new THREE.Group();fore.position.copy(E);arm.add(fore);
    const W=new V3(2.6,0.45,0.4),F1=new V3(5.5,0.35,-0.25),F2=new V3(4.7,0.05,-2.5),F3=new V3(3.0,-0.05,-3.5),B=new V3(0,0,-2.4);
    const el=new THREE.Mesh(segGeo,mBody);el.scale.setScalar(0.17);fore.add(el);
    fore.add(bone(new V3(),W,0.13,0.1,mBody));
    fore.add(bone(W,F1,0.08,0.03,mDark));fore.add(bone(W,F2,0.07,0.03,mDark));fore.add(bone(W,F3,0.06,0.03,mDark));
    const thumb=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.4,4),mHorn);thumb.position.copy(W).add(new V3(0,0.15,0.15));thumb.rotation.x=0.6;fore.add(thumb);
    const notch=(a,b,k)=>a.clone().add(b).multiplyScalar(0.5).lerp(W,k);
    const m12=notch(F1,F2,0.28),m23=notch(F2,F3,0.25),m3B=notch(F3,B,0.2);
    fore.add(membrane([[W,F1,m12],[W,m12,F2],[W,F2,m23],[W,m23,F3],[W,F3,m3B],[W,m3B,B],[W,B,new V3()]],mWing));
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
   * Without ground / fold the flight pose is exactly the pre-T07 one.
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
  };
  d.dispose=function(){
    if(root.parent)root.parent.remove(root);
    const ms=new Set();
    root.traverse(o=>{if(o.isMesh){if(o.geometry!==segGeo)o.geometry.dispose();ms.add(o.material);}});
    ms.forEach(m=>m.dispose());
  };
  return d;
}
const GREEN={body:0x2f7f50,dark:0x1f5c3c,belly:0xc9bf7c,wing:0x3f936a,horn:0xe7dcc1,eye:0xffd23a};
const CRIMSON={body:0x8c2026,dark:0x5a1218,belly:0x3d1717,wing:0x6d1a28,horn:0x2a2121,eye:0x8ff7ff};
root.VDragon={makeDragon,GREEN,CRIMSON,STAND};
})(typeof self!=='undefined'?self:this);
