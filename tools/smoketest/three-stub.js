/**
 * three-stub.js - minimal stand-in for three 0.160, for the Node smoke test.
 *
 * Just enough surface for the layer modules to parse, instantiate and report
 * buffer sizes without a GPU or a DOM. It is NOT a renderer: nothing here
 * draws, and nothing here validates GLSL.
 *
 * smoke.js copies this into <repo>/node_modules/three/ at startup, so a stray
 * `npm install` at the repo root cannot quietly delete it again.
 */
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;this.x/=l;this.y/=l;this.z/=l;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  setScalar(s){this.x=this.y=this.z=s;return this;}
  crossVectors(a,b){const x=a.y*b.z-a.z*b.y,y=a.z*b.x-a.x*b.z,z=a.x*b.y-a.y*b.x;return this.set(x,y,z);}
  cross(v){return this.crossVectors(this.clone(),v);}
  dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;}
  length(){return Math.hypot(this.x,this.y,this.z);}
  angleTo(v){const d=this.clone().normalize().dot(v.clone().normalize());return Math.acos(Math.min(1,Math.max(-1,d)));}
}
class Vector2 { constructor(x=0,y=0){this.x=x;this.y=y;} }
class Color { constructor(r=1,g=1,b=1){this.r=r;this.g=g;this.b=b;} }
class Matrix4 {
  constructor(){this.elements=new Array(16).fill(0);this.elements[0]=this.elements[5]=this.elements[10]=this.elements[15]=1;}
  set(...a){this.elements=a.slice(0,16);return this;}
}
class BufferAttribute {
  constructor(array,itemSize,normalized=false){this.array=array;this.itemSize=itemSize;this.normalized=normalized;this.count=array.length/itemSize;this.needsUpdate=false;}
}
class BufferGeometry {
  constructor(){this.attributes={};this.boundingSphere=null;}
  setAttribute(n,a){this.attributes[n]=a;return this;}
  setFromPoints(p){this.attributes.position=new BufferAttribute(new Float32Array(p.flatMap(v=>[v.x,v.y,v.z])),3);this._points=p;return this;}
  computeBoundingSphere(){this.boundingSphere={radius:1};}
  dispose(){this.disposed=true;}
}
class Object3D {
  constructor(){this.children=[];this.visible=true;this.name='';this.userData={};
    this.position=new Vector3();this.rotation={x:0,y:0,z:0};this.scale=new Vector3(1,1,1);}
  add(...o){for(const c of o)this.children.push(c);return this;}
  remove(o){this.children=this.children.filter(c=>c!==o);return this;}
  applyMatrix4(){return this;}
  getObjectByName(n){if(this.name===n)return this;for(const c of this.children){const r=c.getObjectByName&&c.getObjectByName(n);if(r)return r;}return null;}
  traverse(f){f(this);for(const c of this.children)c.traverse&&c.traverse(f);}
  getWorldPosition(t){return (t||new Vector3()).copy(this.position);}
}
class Group extends Object3D {}
class Scene extends Object3D {}
class Mesh extends Object3D { constructor(g,m){super();this.geometry=g;this.material=m;} }
class Points extends Object3D { constructor(g,m){super();this.geometry=g;this.material=m;this.frustumCulled=true;} }
class Line extends Object3D {
  constructor(g,m){super();this.geometry=g;this.material=m;}
  computeLineDistances(){return this;}
}
class LineSegments extends Line {}
class Material { constructor(p={}){Object.assign(this,p);} dispose(){this.disposed=true;} }
class ShaderMaterial extends Material {}
class LineBasicMaterial extends Material {}
class LineDashedMaterial extends Material {}
class MeshBasicMaterial extends Material {}
class MeshStandardMaterial extends Material {}
class Texture { constructor(src){this.src=src;this.isTexture=true;} dispose(){this.disposed=true;} }
class TextureLoader { load(u){return new Texture(u);} }
const geom = n => class { constructor(...a){this.type=n;this.params=a;} dispose(){} };
const SphereGeometry=geom('Sphere'), OctahedronGeometry=geom('Octahedron'), RingGeometry=geom('Ring');
const CylinderGeometry=geom('Cylinder');
const MathUtils = { degToRad: d => d*Math.PI/180, radToDeg: r => r*180/Math.PI };
const AdditiveBlending=2, BackSide=1, FrontSide=0, DoubleSide=2;
const SRGBColorSpace='srgb', NoColorSpace='', RepeatWrapping=1000, ClampToEdgeWrapping=1001;
export {
  Vector2, Vector3, Color, Matrix4, BufferAttribute, BufferGeometry, Object3D, Group, Scene,
  Mesh, Points, Line, LineSegments, ShaderMaterial, LineBasicMaterial, LineDashedMaterial,
  MeshBasicMaterial, MeshStandardMaterial, Texture, TextureLoader,
  SphereGeometry, OctahedronGeometry, RingGeometry, CylinderGeometry, MathUtils,
  AdditiveBlending, BackSide, FrontSide, DoubleSide,
  SRGBColorSpace, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping,
};
